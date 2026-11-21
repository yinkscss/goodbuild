// @vitest-environment node
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type Db } from "@/server/db/client";

let db: Db;
let session: { user: { id: string; wallet: string } } | null = null;
vi.mock("@/server/db/client", async (original) => ({ ...(await original<typeof import("@/server/db/client")>()), getDb: async () => db }));
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

import { signInUser } from "@/server/auth/service";
import { projects } from "@/server/db/schema";
import { createProjectFromPrompt } from "@/server/projects";
import { POST } from "./route";

let projectId: string;
const forget = (remove: string) =>
  POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ remove }) }), { params: Promise.resolve({ id: projectId }) } as never);
const decisions = async () => (await db.select().from(projects).where(eq(projects.id, projectId)))[0].memory?.decisions;

beforeEach(async () => {
  db = await createTestDb();
  const u = await signInUser(db, { wallet: privateKeyToAccount(generatePrivateKey()).address, walletKind: "embedded", attestation: { ageOk: true, notUsPerson: true } });
  session = { user: { id: u.id, wallet: u.wallet } };
  projectId = (await createProjectFromPrompt(db, u.id, { prompt: "savings goals", network: "celo-sepolia" })).id;
  await db.update(projects).set({ memory: { summary: "s", decisions: ["Brand colour #0f766e", "Tips at least 5 G$", "No dark mode"], upTo: 9 } }).where(eq(projects.id, projectId));
});

describe("forgetting what GoodBuild remembers (D163)", () => {
  it("removes one decision from the stored memory and keeps the rest", async () => {
    const res = await forget("Tips at least 5 G$");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ remembered: ["Brand colour #0f766e", "No dark mode"] });
    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(row.memory).toEqual({ summary: "s", decisions: ["Brand colour #0f766e", "No dark mode"], upTo: 9 });
  });

  it("keeps both removals when two tabs forget different things", async () => {
    await Promise.all([forget("Brand colour #0f766e"), forget("No dark mode")]);
    expect(await decisions()).toEqual(["Tips at least 5 G$"]);
  });

  it("refuses while a build runs, and changes nothing", async () => {
    await db.update(projects).set({ turnStartedAt: new Date() }).where(eq(projects.id, projectId));
    const res = await forget("No dark mode");
    expect(res.status).toBe(409);
    expect(await decisions()).toHaveLength(3);
  });

  it("only works on the person's own project", async () => {
    const other = await signInUser(db, { wallet: privateKeyToAccount(generatePrivateKey()).address, walletKind: "embedded", attestation: { ageOk: true, notUsPerson: true } });
    session = { user: { id: other.id, wallet: other.wallet } };
    expect((await forget("No dark mode")).status).toBe(404);
    expect(await decisions()).toHaveLength(3);
  });
});
