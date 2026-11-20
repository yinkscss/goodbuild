import { expect, it } from "vitest";
import {
  flowstateClaimMessage,
  GOODBUILDIT_RECIPIENT,
  GOODCASH_RECIPIENT,
  flowstateVoteArgs,
  planFlowstateSupport,
} from "./config";
const status = {
  verified: true,
  registered: true,
  votingPower: "10",
  allocated: "7",
  available: "3",
  support: "2",
  partnerSupport: "0",
  partnerActive: true,
  spreadLeft: null as number | null,
  spreadFull: false,
};
it("splits the new points 50/50 with GoodCash, the odd point to GoodBuildIt, keeping existing totals", () => {
  expect(planFlowstateSupport(status, BigInt(3))).toEqual({
    after: BigInt(4),
    partnerAfter: BigInt(1),
    votes: [
      { recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(4) },
      { recipient: GOODCASH_RECIPIENT, amount: BigInt(1) },
    ],
  });
  expect(
    planFlowstateSupport(
      { ...status, available: "10", support: "0", partnerSupport: "5" },
      BigInt(10),
    ).votes,
  ).toEqual([
    { recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(5) },
    { recipient: GOODCASH_RECIPIENT, amount: BigInt(10) },
  ]);
});
it("gives everything to GoodBuildIt when the split can't happen", () => {
  const solo = (s: typeof status, n: number) => planFlowstateSupport(s, BigInt(n));
  // One point only.
  expect(solo(status, 1)).toEqual({
    after: BigInt(3),
    partnerAfter: null,
    votes: [{ recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(3) }],
  });
  // GoodCash not an active recipient.
  expect(solo({ ...status, partnerActive: false }, 3).votes).toEqual([
    { recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(5) },
  ]);
  // Room for one new project only, and both are new.
  expect(solo({ ...status, support: "0", spreadLeft: 1 }, 3).votes).toEqual([
    { recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(3) },
  ]);
  // GoodBuildIt already on the ballot, room for GoodCash.
  expect(solo({ ...status, spreadLeft: 1 }, 2).votes).toHaveLength(2);
  // No room at all, but both already on the ballot: still splits.
  expect(solo({ ...status, partnerSupport: "1", spreadLeft: 0 }, 2).votes).toHaveLength(2);
});
it("builds wallet args only from the pinned recipients", () => {
  expect(flowstateVoteArgs("6", "4")).toEqual([
    { recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(6) },
    { recipient: GOODCASH_RECIPIENT, amount: BigInt(4) },
  ]);
  expect(flowstateVoteArgs("6", null)).toEqual([
    { recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(6) },
  ]);
});
it("refuses votes it can't cast", () => {
  expect(() => planFlowstateSupport(status, BigInt(4))).toThrow(/available/);
  expect(() => planFlowstateSupport(status, BigInt(0))).toThrow();
  expect(() =>
    planFlowstateSupport({ ...status, verified: false }, BigInt(1)),
  ).toThrow(/GoodDollar/);
  expect(() =>
    planFlowstateSupport(
      { ...status, support: "0", spreadLeft: 0, spreadFull: true },
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
