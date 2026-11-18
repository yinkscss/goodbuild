// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  participant: vi.fn(),
  status: vi.fn(),
  claim: vi.fn(),
  support: vi.fn(),
}));
vi.mock("@/server/auth/http", () => ({
  requireSession: async () => ({
    user: { id: "u", wallet: "0x1111111111111111111111111111111111111111" },
  }),
  errorResponse: () => new Response(null, { status: 500 }),
}));
vi.mock("@/server/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/server/deploy/service", () => ({ publicClientFor: () => ({}) }));
vi.mock("@/server/hackathon/community", () => ({
  getParticipant: mocks.participant,
}));
vi.mock("@/server/hackathon/claim", async (original) => ({
  ...(await original<typeof import("@/server/hackathon/claim")>()),
  hackathonStatus: mocks.status,
  claimHackathon: mocks.claim,
}));
vi.mock("@/server/flowstate/service", async (original) => ({
  ...(await original<typeof import("@/server/flowstate/service")>()),
  confirmExistingFlowstateSupport: mocks.support,
}));
import { POST } from "./route";
import { FlowstateError } from "@/server/flowstate/service";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.participant.mockResolvedValue({ flowstate: "pending" });
  mocks.status.mockResolvedValue({ registered: false });
  mocks.claim.mockResolvedValue({
    registered: true,
    startCredits: 20,
    deployCredits: 0,
    deployPending: true,
  });
  mocks.support.mockResolvedValue({ verified: true, support: "10" });
});
it.each(["pending", "visited", "skipped"])(
  "does not grant initial credits for %s progress",
  async (flowstate) => {
    mocks.participant.mockResolvedValue({ flowstate });
    expect((await POST()).status).toBe(403);
    expect(mocks.claim).not.toHaveBeenCalled();
  },
);
it("rechecks on-chain support rather than trusting a stored voted flag", async () => {
  mocks.participant.mockResolvedValue({ flowstate: "voted" });
  mocks.support.mockRejectedValue(
    new FlowstateError("No settled support", 409),
  );
  expect((await POST()).status).toBe(409);
  expect(mocks.claim).not.toHaveBeenCalled();
});
it("grants initial credits after positive settled support", async () => {
  mocks.participant.mockResolvedValue({ flowstate: "voted" });
  expect((await POST()).status).toBe(200);
  expect(mocks.support).toHaveBeenCalledOnce();
  expect(mocks.claim).toHaveBeenCalledOnce();
});
it("keeps the already-earned deploy credit entitlement after registration", async () => {
  mocks.status.mockResolvedValue({ registered: true });
  expect((await POST()).status).toBe(200);
  expect(mocks.support).not.toHaveBeenCalled();
  expect(mocks.claim).toHaveBeenCalledOnce();
});
