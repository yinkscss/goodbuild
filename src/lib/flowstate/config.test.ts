import { expect, it } from "vitest";
import {
  flowstateClaimMessage,
  GOODBUILDIT_RECIPIENT,
  planFlowstateSupport,
} from "./config";
const status = {
  verified: true,
  registered: true,
  votingPower: "10",
  allocated: "7",
  available: "3",
  support: "2",
  spreadFull: false,
};
it("adds support only to GoodBuildIt while preserving the rest of the ballot", () => {
  expect(planFlowstateSupport(status, BigInt(1))).toEqual({
    after: BigInt(3),
    votes: [{ recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(3) }],
  });
  expect(() => planFlowstateSupport(status, BigInt(4))).toThrow(/available/);
  expect(() => planFlowstateSupport(status, BigInt(0))).toThrow();
  expect(() =>
    planFlowstateSupport({ ...status, verified: false }, BigInt(1)),
  ).toThrow(/GoodDollar/);
  expect(() =>
    planFlowstateSupport(
      { ...status, support: "0", spreadFull: true },
      BigInt(1),
    ),
  ).toThrow(/maximum/);
});
it("matches FlowState claim normalization and binds the council, wallet and timestamp", () => {
  expect(
    flowstateClaimMessage("0xABC", Date.parse("2026-11-18T12:00:00.999Z")),
  ).toBe(
    "Claim voting rights in this Flow Council.\n\nCouncil: 0x889e0aadaa3f8b28a794ef70da147827c620a590\nChain: 42220\nWallet: 0xabc\nIssued at: 2026-11-18T12:00:00Z",
  );
});
