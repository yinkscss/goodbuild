// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
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
