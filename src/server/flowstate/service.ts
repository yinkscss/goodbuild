import "server-only";
import {
  decodeFunctionData,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  FLOWSTATE_ABI,
  FLOWSTATE_CHAIN_ID,
  FLOWSTATE_COUNCIL,
  FLOWSTATE_RUNTIME_HASH,
  GOODBUILDIT_RECIPIENT,
  GOODCASH_RECIPIENT,
  planFlowstateSupport,
  type FlowstateStatus,
} from "@/lib/flowstate/config";
import { readGoodIdRoot } from "@/server/goodid";
import { celoFees } from "@/server/gas-grant/grant";

export class FlowstateError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

/**
 * A changed contract must be re-reviewed before this app will ever request a signature. Returns whether
 * GoodCash is an active recipient too (D158); if it isn't, votes go to GoodBuildIt only.
 */
async function assertDeployment(client: PublicClient): Promise<boolean> {
  const code = await client.getCode({ address: FLOWSTATE_COUNCIL });
  if (!code || keccak256(code) !== FLOWSTATE_RUNTIME_HASH)
    throw new FlowstateError(
      "FlowState’s voting contract has changed or could not be verified. Use the official site while we recheck it.",
      503,
    );
  const [[recipient], [partner]] = await Promise.all(
    [GOODBUILDIT_RECIPIENT, GOODCASH_RECIPIENT].map((address) =>
      client.readContract({
        address: FLOWSTATE_COUNCIL,
        abi: FLOWSTATE_ABI,
        functionName: "recipients",
        args: [address],
      }),
    ),
  );
  if (recipient.toLowerCase() !== GOODBUILDIT_RECIPIENT)
    throw new FlowstateError(
      "GoodBuildIt is not an active recipient in this Flow Council.",
    );
  return partner.toLowerCase() === GOODCASH_RECIPIENT;
}

export async function flowstateStatus(
  client: PublicClient,
  wallet: Address,
  blockNumber?: bigint,
): Promise<FlowstateStatus> {
  const partnerActive = await assertDeployment(client);
  const [root, voter, votes, maxSpread] = await Promise.all([
    readGoodIdRoot(client, wallet),
    client.readContract({
      address: FLOWSTATE_COUNCIL,
      abi: FLOWSTATE_ABI,
      functionName: "voters",
      blockNumber,
      args: [wallet],
    }),
    client.readContract({
      address: FLOWSTATE_COUNCIL,
      abi: FLOWSTATE_ABI,
      functionName: "getVotes",
      blockNumber,
      args: [wallet],
    }),
    client.readContract({
      address: FLOWSTATE_COUNCIL,
      abi: FLOWSTATE_ABI,
      functionName: "maxVotingSpread",
      blockNumber,
    }),
  ]);
  const allocated = votes.reduce((sum, vote) => sum + vote.amount, BigInt(0));
  const power = voter[1];
  const amountFor = (recipient: string) =>
    votes.find((v) => v.recipient.toLowerCase() === recipient)?.amount ??
    BigInt(0);
  const backed = votes.filter((v) => v.amount > BigInt(0)).length;
  const spreadLeft = maxSpread > 0 ? Math.max(0, maxSpread - backed) : null;
  return {
    verified: Boolean(root),
    registered: voter[0] !== zeroAddress && power > BigInt(0),
    votingPower: String(power),
    allocated: String(allocated),
    available: String(power > allocated ? power - allocated : BigInt(0)),
    support: String(amountFor(GOODBUILDIT_RECIPIENT)),
    partnerSupport: String(amountFor(GOODCASH_RECIPIENT)),
    partnerActive,
    spreadLeft,
    spreadFull: spreadLeft === 0,
  };
}

export async function prepareFlowstateVote(
  client: PublicClient,
  wallet: Address,
  additional: bigint,
) {
  const status = await flowstateStatus(client, wallet);
  let plan: ReturnType<typeof planFlowstateSupport>;
  try {
    plan = planFlowstateSupport(status, additional);
  } catch (e) {
    throw new FlowstateError((e as Error).message, 400);
  }
  const call = {
    account: wallet,
    address: FLOWSTATE_COUNCIL,
    abi: FLOWSTATE_ABI,
    functionName: "vote" as const,
    args: [plan.votes] as const,
  };
  await client.simulateContract(call);
  const [estimatedGas, fees, balance] = await Promise.all([
    client.estimateContractGas(call),
    celoFees(client),
    client.getBalance({ address: wallet }),
  ]);
  const gas = (estimatedGas * BigInt(120) + BigInt(99)) / BigInt(100);
  // A small tip over a doubled base fee. The tip used to equal the whole gas price, which doubled what
  // people actually paid; the cap stays about the same, the real fee is about half.
  const { maxFeePerGas, maxPriorityFeePerGas } = fees;
  const feeCapWei = gas * maxFeePerGas;
  return {
    ...status,
    additional: String(additional),
    after: String(plan.after),
    /** GoodCash's new total, or null when this vote goes to GoodBuildIt only (D158). */
    partnerAfter: plan.partnerAfter === null ? null : String(plan.partnerAfter),
    gas: String(gas),
    maxFeePerGas: String(maxFeePerGas),
    maxPriorityFeePerGas: String(maxPriorityFeePerGas),
    feeCapWei: String(feeCapWei),
    /** The wallet can't cover the cap yet. The route tops it up from the gas grant before answering. */
    short: balance < feeCapWei,
  };
}

/** A link click, signature, or submitted hash is never accepted as a completed vote. */
export async function confirmFlowstateVote(
  client: PublicClient,
  wallet: Address,
  hash: Hex,
) {
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);
  if (tx.from.toLowerCase() !== wallet.toLowerCase())
    throw new FlowstateError("This transaction belongs to another wallet.");
  if (
    tx.to?.toLowerCase() !== FLOWSTATE_COUNCIL ||
    tx.value !== BigInt(0) ||
    (tx.chainId !== undefined && tx.chainId !== FLOWSTATE_CHAIN_ID)
  )
    throw new FlowstateError("This is not a FlowState council vote on Celo.");
  const latestBlock = await client.getBlockNumber();
  if (latestBlock < receipt.blockNumber + BigInt(2))
    throw new FlowstateError(
      "Your vote is waiting for three Celo confirmations. Check again in a moment.",
    );
  if (receipt.status !== "success")
    throw new FlowstateError(
      "The vote reverted. No support was added; refresh your ballot and try again.",
      410,
    );
  const decoded = decodeFunctionData({ abi: FLOWSTATE_ABI, data: tx.input });
  if (decoded.functionName !== "vote" || !decoded.args)
    throw new FlowstateError("This transaction does not vote for GoodBuildIt.");
  // GoodBuildIt alone, or GoodBuildIt then GoodCash (D158). Nothing else counts as our vote.
  const votes = decoded.args[0];
  const ours = votes[0];
  const partner = votes[1];
  if (
    votes.length < 1 ||
    votes.length > 2 ||
    ours.recipient.toLowerCase() !== GOODBUILDIT_RECIPIENT ||
    ours.amount <= BigInt(0) ||
    (partner &&
      (partner.recipient.toLowerCase() !== GOODCASH_RECIPIENT ||
        partner.amount <= BigInt(0)))
  )
    throw new FlowstateError(
      "This transaction does not contain the expected GoodBuildIt vote.",
    );
  // Credits and invites depend on GoodBuildIt's support only, so that is the amount that must match.
  const status = await flowstateStatus(client, wallet);
  if (BigInt(status.support) !== ours.amount)
    throw new FlowstateError(
      "Your current FlowState allocation differs from that transaction. Refresh to check your ballot.",
      410,
    );
  return { ...status, hash };
}

/** Existing support must also be stable for three blocks, not just visible at the tip. */
export async function confirmExistingFlowstateSupport(
  client: PublicClient,
  wallet: Address,
) {
  const height = await client.getBlockNumber();
  const [current, settled] = await Promise.all([
    flowstateStatus(client, wallet),
    flowstateStatus(
      client,
      wallet,
      height > BigInt(2) ? height - BigInt(2) : BigInt(0),
    ),
  ]);
  if (
    !current.verified ||
    !settled.registered ||
    BigInt(settled.support) <= BigInt(0) ||
    settled.support !== current.support
  )
    throw new FlowstateError(
      "Your support is not confirmed for three blocks yet. Wait a moment, then check again.",
    );
  return { ...current, hash: null };
}

/** For the welcome credits (D125): does this wallet's settled support for GoodBuildIt sit on-chain? */
export async function hasVotedForGoodBuild(client: PublicClient, wallet: Address): Promise<boolean> {
  try {
    await confirmExistingFlowstateSupport(client, wallet);
    return true;
  } catch (e) {
    if (e instanceof FlowstateError) return false;
    throw e;
  }
}
