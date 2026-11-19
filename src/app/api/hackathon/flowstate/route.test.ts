// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import { ledgerEntries } from "@/server/db/schema";
import { flowstateVoters } from "@/server/db/hackathon-schema";
import { getParticipant, saveParticipant } from "@/server/hackathon/community";
const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  prepare: vi.fn(),
  confirm: vi.fn(),
  existing: vi.fn(),
  claim: vi.fn(),
}));
let db: Db;
let session: { user: typeof users.$inferSelect } | null;
vi.mock("@/server/db/client", async (original) => ({
  ...(await original<typeof import("@/server/db/client")>()),
  getDb: async () => db,
}));
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
vi.mock("@/server/deploy/service", () => ({
  publicClientFor: () => ({ getBlockNumber: async () => BigInt(100) }),
}));
vi.mock("@/server/flowstate/service", async (original) => ({
  ...(await original<typeof import("@/server/flowstate/service")>()),
  flowstateStatus: mocks.status,
  prepareFlowstateVote: mocks.prepare,
  confirmFlowstateVote: mocks.confirm,
  confirmExistingFlowstateSupport: mocks.existing,
}));
vi.mock("@/server/goodid", async (original) => {
  const real = await original<typeof import("@/server/goodid")>();
  return {
    readGoodIdentityOnCelo: async () => ({ root: "0x" + "ab".repeat(20) }),
    // The chain says verified: record it, as the real one does.
    syncGoodId: async (d: Db, u: { id: string }) => {
      await real.recordGoodIdRoot(d, u.id, "0x" + "ab".repeat(20));
      return true;
    },
  };
});
vi.mock("@/server/flowstate/eligibility", () => ({
  claimFlowstateEligibility: mocks.claim,
}));
import { GET, POST } from "./route";
const state = {
  verified: true,
  registered: false,
  votingPower: "0",
  allocated: "0",
  available: "0",
  support: "0",
  spreadFull: false,
};
const hash = "0x" + "a".repeat(64);
const voter = async () =>
  (await db.select().from(flowstateVoters).where(eq(flowstateVoters.userId, session!.user.id)))[0] ?? null;
const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/hackathon/flowstate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
beforeEach(async () => {
  db = await createTestDb();
  const [user] = await db
    .insert(users)
    .values({
      wallet: "0x1111111111111111111111111111111111111111",
      email: "builder@example.com",
    })
    .returning();
  session = { user };
  vi.clearAllMocks();
  mocks.status.mockResolvedValue(state);
  mocks.existing.mockResolvedValue({ ...state, hash: null });
  mocks.claim.mockResolvedValue({ success: true });
  mocks.confirm.mockResolvedValue({
    ...state,
    registered: true,
    support: "1",
    hash,
  });
});
it("refuses unsigned requests before touching the chain or FlowState", async () => {
  session = null;
  expect((await GET()).status).toBe(401);
  expect((await post({ action: "existing" })).status).toBe(401);
  expect(mocks.status).not.toHaveBeenCalled();
});
it("atomically allows only one upstream eligibility claim from concurrent clicks", async () => {
  const body = {
    action: "eligibility",
    issuedAt: Date.now(),
    signature: "0x" + "a".repeat(130),
  };
  const results = await Promise.all([post(body), post(body)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
  expect(mocks.claim).toHaveBeenCalledOnce();
});
it("records a vote without enrolling the voter in the hackathon (D126)", async () => {
  const res = await post({ action: "confirm", hash });
  expect(res.status).toBe(200);
  expect(await voter()).toMatchObject({ txHash: hash });
  expect((await voter())?.votedAt).toBeInstanceOf(Date);
  expect(await getParticipant(db, session!.user.id)).toBeNull();
});
it("mirrors the vote onto an existing hackathon signup", async () => {
  await saveParticipant(db, session!.user, { email: "builder@example.com" });
  expect((await post({ action: "confirm", hash })).status).toBe(200);
  expect(await getParticipant(db, session!.user.id)).toMatchObject({
    flowstate: "voted",
    flowstateTxHash: hash,
  });
});
it("lets a wallet with no email on the account prepare a vote", async () => {
  session!.user.email = null;
  mocks.prepare.mockResolvedValue({ ...state, short: false, feeCapWei: "1" });
  expect((await post({ action: "prepare", additional: "1" })).status).toBe(200);
  expect(mocks.prepare).toHaveBeenCalledOnce();
});
it("only accepts existing support after a fresh on-chain positive check", async () => {
  expect((await post({ action: "existing" })).status).toBe(409);
  mocks.existing.mockResolvedValue({
    ...state,
    support: "2",
    registered: true,
    hash: null,
  });
  expect((await post({ action: "existing" })).status).toBe(200);
  expect(await voter()).toMatchObject({ txHash: null });
  expect((await voter())?.votedAt).toBeInstanceOf(Date);
});

it("posts the 40 welcome credits as soon as the vote is confirmed, once", async () => {
  const first = await (await post({ action: "confirm", hash })).json();
  expect(first.welcomeMicro).toBe(400_000);
  const again = await (await post({ action: "confirm", hash })).json();
  expect(again.welcomeMicro).toBe(0);
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.userId, session!.user.id), eq(ledgerEntries.refType, "welcome")));
  expect(rows).toHaveLength(1);
});
it("records a wallet already verified with GoodDollar elsewhere, so /stats counts it", async () => {
  expect((await GET()).status).toBe(200);
  const [row] = await db.select({ verifiedAt: users.verifiedAt, root: users.goodidRoot }).from(users).where(eq(users.id, session!.user.id));
  expect(row.verifiedAt).toBeInstanceOf(Date);
  expect(row.root).toBe("0x" + "ab".repeat(20));
});
it("records nothing when the chain says the wallet isn't verified", async () => {
  mocks.status.mockResolvedValue({ ...state, verified: false });
  await GET();
  const [row] = await db.select({ verifiedAt: users.verifiedAt }).from(users).where(eq(users.id, session!.user.id));
  expect(row.verifiedAt).toBeNull();
});
