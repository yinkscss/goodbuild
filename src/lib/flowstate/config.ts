import { parseAbi } from "viem";

// Verified against FlowState's accepted application and the deployed Celo contract, 18 Nov 2026.
export const FLOWSTATE_CHAIN_ID = 42220;
export const FLOWSTATE_COUNCIL =
  "0x889e0aadaa3f8b28a794ef70da147827c620a590" as const;
export const GOODBUILDIT_RECIPIENT =
  "0xf0449277e30cc9063147bfb9ecdf036bf9d41531" as const;
/**
 * GoodCash, our partner (D158): every one-tap vote is split 50/50 between GoodBuildIt and GoodCash.
 * Read from FlowState's public applications API (project 194, Accepted) and checked on the council
 * contract's `recipients` on Celo, 20 Nov 2026.
 */
export const GOODCASH_RECIPIENT =
  "0xafdeebb89cda1669361117ea2eae3411f1228cb6" as const;
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
  /** This wallet's current votes for GoodBuildIt. */
  support: string;
  /** This wallet's current votes for GoodCash (D158). */
  partnerSupport: string;
  /** GoodCash is an active recipient in the council right now. If not, votes go to GoodBuildIt only. */
  partnerActive: boolean;
  /** Projects this ballot can still add; null when the council sets no limit. */
  spreadLeft: number | null;
  spreadFull: boolean;
}

const MAX_VOTE = BigInt(2) ** BigInt(96);

/**
 * Plans a vote that adds `additional` points (D158): half to GoodCash, the rest (half plus any odd
 * point) to GoodBuildIt. Each amount is that project's new total, so other projects on the ballot keep
 * their votes. Falls back to all for GoodBuildIt when GoodCash isn't active, the ballot has room for
 * only one new project, or there is a single point to give.
 */
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
  const support = BigInt(status.support);
  const partnerSupport = BigInt(status.partnerSupport);
  const gbNew = support === BigInt(0) ? 1 : 0;
  const gcNew = partnerSupport === BigInt(0) ? 1 : 0;
  const room = (needed: number) =>
    status.spreadLeft === null || status.spreadLeft >= needed;
  if (!room(gbNew))
    throw new Error(
      "Your ballot already supports the maximum number of projects. Manage it on FlowState to make room.",
    );
  const split =
    status.partnerActive && additional >= BigInt(2) && room(gbNew + gcNew);
  const partnerShare = split ? additional / BigInt(2) : BigInt(0);
  const after = support + additional - partnerShare;
  const partnerAfter = split ? partnerSupport + partnerShare : null;
  if (after >= MAX_VOTE || (partnerAfter !== null && partnerAfter >= MAX_VOTE))
    throw new Error("Vote amount is too large.");
  const votes: { recipient: `0x${string}`; amount: bigint }[] = [
    { recipient: GOODBUILDIT_RECIPIENT, amount: after },
  ];
  if (partnerAfter !== null)
    votes.push({ recipient: GOODCASH_RECIPIENT, amount: partnerAfter });
  return { after, partnerAfter, votes };
}

/** The `vote` arguments for a plan the server priced, built only from the two pinned recipients. */
export function flowstateVoteArgs(after: string, partnerAfter: string | null) {
  const votes: { recipient: `0x${string}`; amount: bigint }[] = [
    { recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(after) },
  ];
  if (partnerAfter !== null)
    votes.push({ recipient: GOODCASH_RECIPIENT, amount: BigInt(partnerAfter) });
  return votes;
}
