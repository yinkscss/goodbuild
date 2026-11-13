import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { parseAbi, parseEventLogs, type Hex, type PublicClient } from "viem";

import type { Db } from "@/server/db/client";
import { creditsSyncCursor, onchainCreditEvents } from "@/server/db/onchain-credits-schema";
import { users } from "@/server/db/schema";
import { postLedgerEntry } from "./ledger";
import { creditsContract } from "./contract-address";
import { markQuotePaid } from "./quote";

/**
 * GoodBuild Credits on-chain (D51, D52). The token's `Redeemed(account, credits, ref)` event is the
 * only thing that moves on-chain credit into the ledger: the wallet burned the tokens, so the same
 * amount is posted once to that wallet's account. 1 GBC unit = 1 micro-USD (6 decimals), so no
 * conversion. Posting is keyed by chain, transaction and log index, so any number of readers (the
 * user's own "I redeemed" call, the background sync, a re-scan) can overlap and credit once.
 */
export const CREDITS_ABI = parseAbi([
  "event Redeemed(address indexed account, uint256 credits, bytes32 ref)",
  "event Purchased(address indexed account, uint256 gdPaid, uint256 credits, uint256 bonus, bytes32 ref)",
  "function goodDollar() view returns (address)",
  "function quoteSigner() view returns (address)",
  "function maxPerQuote() view returns (uint256)",
  "function remaining() view returns (uint256)",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
  "function transferAndCall(address,uint256,bytes)",
]);

export { creditsContract };

export interface RedeemedLog {
  chainId: number;
  txHash: Hex;
  logIndex: number;
  blockNumber: number;
  wallet: string;
  amountMicro: number;
  /** The quote ref the contract emitted with this event, when known. */
  ref?: Hex;
}

export interface CreditResult {
  /** True when this call put money in a ledger. False for a replay, or when no account owns the wallet yet. */
  credited: boolean;
  userId: string | null;
  amountMicro: number;
}

const keyOf = (e: { chainId: number; txHash: string; logIndex: number }) => `onchain:${e.chainId}:${e.txHash.toLowerCase()}:${e.logIndex}`;

/** Credit one event if its wallet has an account and it hasn't been credited. Safe to call any number of times. */
async function creditRow(db: Db, row: typeof onchainCreditEvents.$inferSelect): Promise<CreditResult> {
  if (row.ledgerEntryId) return { credited: false, userId: row.userId, amountMicro: row.amountMicro };
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.wallet, row.wallet)).limit(1);
  if (!user) return { credited: false, userId: null, amountMicro: row.amountMicro };
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    // Lock the event row so two readers can't both pass the check above.
    const [locked] = await tx.select().from(onchainCreditEvents).where(eq(onchainCreditEvents.id, row.id)).for("update");
    if (locked.ledgerEntryId) return { credited: false, userId: locked.userId, amountMicro: locked.amountMicro };
    const posted = await postLedgerEntry(tx, {
      userId: user.id,
      kind: "deposit",
      amountMicro: locked.amountMicro,
      idempotencyKey: keyOf(locked),
      refType: "onchain",
      refId: `${locked.chainId}:${locked.txHash}:${locked.logIndex}`,
    });
    await tx.update(onchainCreditEvents).set({ userId: user.id, ledgerEntryId: posted.entry.id, creditedAt: new Date() }).where(eq(onchainCreditEvents.id, locked.id));
    return { credited: !posted.replayed, userId: user.id, amountMicro: locked.amountMicro };
  });
}

/** Record a redemption event and credit it if its wallet has an account. Replays change nothing. */
export async function recordRedemption(db: Db, log: RedeemedLog): Promise<CreditResult> {
  if (!Number.isSafeInteger(log.amountMicro) || log.amountMicro <= 0) throw new Error("A redemption must be a positive whole number of units.");
  const values = { chainId: log.chainId, txHash: log.txHash.toLowerCase(), logIndex: log.logIndex, blockNumber: log.blockNumber, wallet: log.wallet.toLowerCase(), amountMicro: log.amountMicro };
  await db.insert(onchainCreditEvents).values(values).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(onchainCreditEvents)
    .where(and(eq(onchainCreditEvents.chainId, values.chainId), eq(onchainCreditEvents.txHash, values.txHash), eq(onchainCreditEvents.logIndex, values.logIndex)))
    .limit(1);
  if (log.ref) await markQuotePaid(db, log.ref, values.txHash);
  return creditRow(db, row);
}

/** Credit anything this wallet redeemed before it had an account. Called when it signs in. */
export async function creditPendingForWallet(db: Db, wallet: string): Promise<number> {
  const rows = await db
    .select()
    .from(onchainCreditEvents)
    .where(and(eq(onchainCreditEvents.wallet, wallet.toLowerCase()), isNull(onchainCreditEvents.ledgerEntryId)));
  let total = 0;
  for (const row of rows) {
    const r = await creditRow(db, row);
    if (r.credited) total += r.amountMicro;
  }
  return total;
}

type ReceiptClient = Pick<PublicClient, "getTransactionReceipt">;

/**
 * The user's own "I redeemed" call: read the transaction, keep only `Redeemed` logs the real contract
 * emitted, and record them. Whose they are comes from the log, never from the caller, so someone
 * submitting another wallet's hash only speeds up that wallet's credit.
 */
export async function redeemFromReceipt(db: Db, client: ReceiptClient, chainId: number, txHash: Hex, env: NodeJS.ProcessEnv = process.env): Promise<{ events: number; creditedMicro: number }> {
  const contract = creditsContract(chainId, env);
  if (!contract) throw new CreditsNotConfiguredError(chainId);
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") return { events: 0, creditedMicro: 0 };
  const logs = parseEventLogs({ abi: CREDITS_ABI, eventName: "Redeemed", logs: receipt.logs.filter((l) => l.address.toLowerCase() === contract.toLowerCase()) });
  let creditedMicro = 0;
  for (const l of logs) {
    const r = await recordRedemption(db, { chainId, txHash, logIndex: l.logIndex, blockNumber: Number(l.blockNumber), wallet: l.args.account, amountMicro: Number(l.args.credits), ref: l.args.ref });
    if (r.credited) creditedMicro += r.amountMicro;
  }
  return { events: logs.length, creditedMicro };
}

export class CreditsNotConfiguredError extends Error {
  readonly code = "credits_not_configured";
  constructor(chainId: number) {
    super(`No GoodBuild Credits contract is set for chain ${chainId}.`);
  }
}

type LogClient = Pick<PublicClient, "getBlockNumber" | "getContractEvents">;
const SYNC_CHUNK = BigInt(2_000);
const SYNC_MAX_BLOCKS = BigInt(50_000);
/** Blocks re-read behind the checkpoint each scan, in case the newest ones were reorganised. Re-reading is free: events credit once. */
export const SYNC_REORG_OVERLAP = BigInt(64);

/** Where the background scan has read up to on this chain, or null before its first scan. */
export async function syncCursor(db: Db, chainId: number): Promise<number | null> {
  const [row] = await db.select({ b: creditsSyncCursor.lastBlock }).from(creditsSyncCursor).where(eq(creditsSyncCursor.chainId, chainId)).limit(1);
  return row ? row.b : null;
}

/** Move the checkpoint forward to `block`. Never backward, so two servers scanning at once can't undo each other. */
async function advanceCursor(db: Db, chainId: number, block: bigint) {
  await db
    .insert(creditsSyncCursor)
    .values({ chainId, lastBlock: Number(block) })
    .onConflictDoUpdate({ target: creditsSyncCursor.chainId, set: { lastBlock: sql`greatest(${creditsSyncCursor.lastBlock}, excluded.last_block)`, updatedAt: new Date() } });
}

/**
 * The background safety net: scan new blocks for `Redeemed` events, so credit lands even if the user
 * closed the tab after redeeming. It reads from its own checkpoint (GB-01), not from the newest stored
 * event: before, an empty stretch longer than one call never moved the start, and a newer receipt
 * reported directly could move it past an older payment nobody reported. The checkpoint moves after
 * every chunk that was fully read, starts at CREDITS_START_BLOCK_<chain> on the first scan (so the
 * first scan after this change re-reads all history once and credits anything missed), and each scan
 * re-reads SYNC_REORG_OVERLAP blocks behind it. At most SYNC_MAX_BLOCKS per call, so a long gap
 * catches up over a few ticks.
 */
export async function syncRedemptions(db: Db, client: LogClient, chainId: number, env: NodeJS.ProcessEnv = process.env): Promise<{ scanned: number; events: number }> {
  const contract = creditsContract(chainId, env);
  if (!contract) return { scanned: 0, events: 0 };
  const configured = BigInt(env[`CREDITS_START_BLOCK_${chainId}`] ?? 0);
  const cursor = await syncCursor(db, chainId);
  const head = await client.getBlockNumber();
  let from = configured;
  if (cursor !== null) {
    const resume = BigInt(cursor) + BigInt(1) - SYNC_REORG_OVERLAP;
    if (resume > from) from = resume;
  }
  if (from > head) return { scanned: 0, events: 0 };
  const last = from + SYNC_MAX_BLOCKS - BigInt(1);
  const stop = last < head ? last : head;
  let events = 0;
  const scanned = Number(stop - from + BigInt(1));
  while (from <= stop) {
    const to = from + SYNC_CHUNK - BigInt(1) < stop ? from + SYNC_CHUNK - BigInt(1) : stop;
    const logs = await client.getContractEvents({ address: contract, abi: CREDITS_ABI, eventName: "Redeemed", fromBlock: from, toBlock: to, strict: true });
    for (const l of logs) {
      await recordRedemption(db, { chainId, txHash: l.transactionHash, logIndex: l.logIndex, blockNumber: Number(l.blockNumber), wallet: l.args.account, amountMicro: Number(l.args.credits), ref: l.args.ref });
      events++;
    }
    // Only once every event in the chunk is recorded: a failure above leaves the checkpoint where it was.
    await advanceCursor(db, chainId, to);
    from = to + BigInt(1);
  }
  return { scanned, events };
}
