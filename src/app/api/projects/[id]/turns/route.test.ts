// @vitest-environment node
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type Db } from "@/server/db/client";
import { balances, projects, turnJobs, usageEvents, users } from "@/server/db/schema";

let db: Db;
let session: { user: { id: string; wallet: string } } | null = null;
vi.mock("@/server/db/client", async (original) => ({ ...(await original<typeof import("@/server/db/client")>()), getDb: async () => db }));
vi.mock("@/server/jobs", () => ({ kickWorker: () => undefined }));
vi.mock("@/server/auth/http", async (original) => {
  const real = await original<typeof import("@/server/auth/http")>();
  const { AuthError } = await import("@/server/auth/errors");
  return {
    ...real,
    requireSession: async () => {
      if (!session) throw new AuthError("unauthenticated");
      return session;
    },
  };
});

import { CAP_MESSAGE } from "@/server/credits/cap";
import { postLedgerEntry } from "@/server/credits/ledger";
import { POST } from "./route";

const send = (id: string, body: object) => POST(new Request(`http://localhost:3000/api/projects/${id}/turns`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) } as never);

describe("POST turns", () => {
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const wallet = `0x${randomUUID().replaceAll("-", "")}`;
    const [u] = await db.insert(users).values({ wallet }).returning({ id: users.id });
    userId = u.id;
    session = { user: { id: userId, wallet } };
    const [p] = await db.insert(projects).values({ ownerId: userId, name: "P", chainId: 11142220, currentVersion: 1 }).returning({ id: projects.id });
    projectId = p.id;
  });

  const useUpFree = () => db.insert(usageEvents).values({ userId, callId: randomUUID(), model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: 0, chargedMicro: 200_000, markupBps: 2500 });

  it("queues a free build as before", async () => {
    const res = await send(projectId, { prompt: "Build it" });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ status: "queued" });
    const [job] = await db.select().from(turnJobs).where(eq(turnJobs.id, body.jobId));
    expect([job.funding, job.holdMicro]).toEqual(["free", 0]);
  });

  it("refuses at the free limit with the same 402 as before, and queues nothing", async () => {
    await useUpFree();
    const res = await send(projectId, { prompt: "Build it" });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "free_limit", message: CAP_MESSAGE });
    expect(await db.select().from(turnJobs)).toEqual([]);
  });

  it("with credit, the same request queues a paid build and sets aside part of the balance", async () => {
    await useUpFree();
    await postLedgerEntry(db, { userId, kind: "deposit", amountMicro: 5_000_000, idempotencyKey: "topup:1" });
    const res = await send(projectId, { prompt: "Build it" });
    expect(res.status).toBe(202);
    const [job] = await db.select().from(turnJobs);
    expect([job.funding, job.holdMicro]).toEqual(["paid", 1_000_000]);
    const [b] = await db.select().from(balances).where(eq(balances.userId, userId));
    expect([b.balanceMicro, b.reservedMicro]).toEqual([5_000_000, 1_000_000]);
  });
});
