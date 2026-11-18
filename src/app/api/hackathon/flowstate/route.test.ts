// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { getParticipant } from "@/server/hackathon/community";
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
it("saves proof for an existing voter arriving without a hackathon signup", async () => {
  expect(await getParticipant(db, session!.user.id)).toBeNull();
  const res = await post({ action: "confirm", hash });
  expect(res.status).toBe(200);
  expect(await getParticipant(db, session!.user.id)).toMatchObject({
    email: "builder@example.com",
    flowstate: "voted",
    flowstateTxHash: hash,
  });
});
it("requires contact signup before preparing a vote for an external wallet", async () => {
  session!.user.email = null;
  expect((await post({ action: "prepare", additional: "1" })).status).toBe(409);
  expect(mocks.prepare).not.toHaveBeenCalled();
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
  expect(await getParticipant(db, session!.user.id)).toMatchObject({
    flowstate: "voted",
    flowstateTxHash: null,
  });
});
