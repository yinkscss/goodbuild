import { parseAbi } from "viem";

// Verified against FlowState's accepted application and the deployed Celo contract, 18 Nov 2026.
export const FLOWSTATE_CHAIN_ID = 42220;
export const FLOWSTATE_COUNCIL =
  "0x889e0aadaa3f8b28a794ef70da147827c620a590" as const;
export const GOODBUILDIT_RECIPIENT =
  "0xf0449277e30cc9063147bfb9ecdf036bf9d41531" as const;
export const FLOWSTATE_RUNTIME_HASH =
  "0x4f4b3bed84f524cc5162457e1ed5233b5527807945185a94a40a640bebf2c591" as const;
export const FLOWSTATE_ORIGIN = "https://flowstate.network";
export const FLOWSTATE_ABI = parseAbi([
  "function voters(address) view returns (address account, uint96 votingPower)",
  "function getVotes(address) view returns ((address recipient, uint96 amount)[])",
  "function recipients(address) view returns (address account, uint96 votes)",
  "function maxVotingSpread() view returns (uint8)",
  "function vote((address recipient, uint96 amount)[] _votes)",
  "event Voted(address account, (address recipient, uint96 amount)[] votes)",
]);

// Exact public proof-of-control format accepted by FlowState's eligibility API.
// This is deliberately not a SIWE login and carries no GoodBuild/Magic session token.
export function flowstateClaimMessage(wallet: string, issuedAt: number) {
  const timestamp = new Date(Math.floor(issuedAt / 1000) * 1000)
    .toISOString()
    .replace(/\.\d+Z$/, "Z");
  return [
    "Claim voting rights in this Flow Council.",
    "",
    `Council: ${FLOWSTATE_COUNCIL}`,
    `Chain: ${FLOWSTATE_CHAIN_ID}`,
    `Wallet: ${wallet.toLowerCase()}`,
    `Issued at: ${timestamp}`,
  ].join("\n");
}
export interface FlowstateStatus {
  verified: boolean;
  registered: boolean;
  votingPower: string;
  allocated: string;
  available: string;
  support: string;
  spreadFull: boolean;
}

export function planFlowstateSupport(
  status: FlowstateStatus,
  additional: bigint,
) {
  if (!status.verified) throw new Error("Verify with GoodDollar first.");
  if (!status.registered)
    throw new Error("Enable voting for your wallet first.");
  if (additional <= BigInt(0) || additional > BigInt(status.available))
    throw new Error(
      "Choose an amount within your available votes. Your existing votes will stay unchanged.",
    );
  if (status.spreadFull && BigInt(status.support) === BigInt(0))
    throw new Error(
      "Your ballot already supports the maximum number of projects. Manage it on FlowState to make room.",
    );
  const after = BigInt(status.support) + additional;
  if (after >= BigInt(2) ** BigInt(96))
    throw new Error("Vote amount is too large.");
  return {
    after,
    votes: [{ recipient: GOODBUILDIT_RECIPIENT, amount: after }],
  };
}
