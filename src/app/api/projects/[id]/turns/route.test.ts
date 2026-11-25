// @vitest-environment node
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type Db } from "@/server/db/client";
import { balances, messages, projects, turnJobs, usageEvents, users } from "@/server/db/schema";

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

/** Uses the D28/D30 free allowances, kept as the FREE_POLICY=legacy off switch (D123). */
process.env.FREE_POLICY = "legacy";


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

describe("POST turns: first-message ideas and button ids (D173)", () => {
  let userId: string;
  let projectId: string;
  beforeEach(async () => {
    db = await createTestDb();
    const wallet = `0x${randomUUID().replaceAll("-", "")}`;
    const [u] = await db.insert(users).values({ wallet }).returning({ id: users.id });
    userId = u.id;
    session = { user: { id: userId, wallet } };
    const [p] = await db.insert(projects).values({ ownerId: userId, name: "P", chainId: 11142220, currentVersion: 0 }).returning({ id: projects.id });
    projectId = p.id;
  });
  const queueFirst = async (content: string) => (await db.insert(messages).values({ projectId, role: "user", content, status: "queued" }).returning({ id: messages.id }))[0].id;

  it("answers the landing page's vague first message with ideas, no job, and the same on a double submit", async () => {
    const first = await queueFirst("i want to build a gooddollar app");
    for (let i = 0; i < 2; i++) {
      const res = await send(projectId, { mode: "build", userMessageId: first });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ messageId: first, status: "answered" });
    }
    expect(await db.select().from(turnJobs)).toEqual([]);
    const replies = (await db.select().from(messages).where(eq(messages.projectId, projectId))).filter((m) => m.role === "assistant");
    expect(replies).toHaveLength(1);
    expect((replies[0].meta?.suggestions as string[]).length).toBe(3);
  });

  it("queues a concrete first message as before", async () => {
    const first = await queueFirst("A G$ tip jar for my blog");
    const res = await send(projectId, { mode: "build", userMessageId: first });
    expect(res.status).toBe(202);
  });

  it("saves the button id, and recognises an old client's button text", async () => {
    const res = await send(projectId, { mode: "build", prompt: "Fix the remaining errors from the last build." });
    expect(res.status).toBe(202);
    const { messageId } = await res.json();
    const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
    expect(m.meta?.turnAction).toBe("repair");
    // A repair never plans first, even on a project with no version yet.
    expect(m.meta?.intake).toBeUndefined();
  });

  it("rejects an unknown action id", async () => {
    const res = await send(projectId, { mode: "build", prompt: "Start building", action: "launch_rockets" });
    expect(res.status).toBe(400);
  });
});
