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
 * conversion. Posting is keyed by chain and the event's quote ref (GB-13, D111): the contract releases
 * each ref once, so any number of readers (the user's own "I redeemed" call, the background sync, a
 * re-scan), a reorg that moves the transaction to another block or log index, or a second payment of a
 * quote whose first transaction was dropped, all credit once. Rows recorded before the ref was stored
 * keep their old key, chain + transaction + log index.
 *
 * Nothing is credited until it is SYNC_CONFIRMATIONS blocks deep, from the receipt or from the scan.
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
  /** The quote (or grant) ref the contract emitted with this event. Every real `Redeemed` log has one. */
  ref: Hex;
}

export interface CreditResult {
  /** True when this call put money in a ledger. False for a replay, or when no account owns the wallet yet. */
  credited: boolean;
  userId: string | null;
  amountMicro: number;
}

/**
 * The ledger key: one per (chain, ref), since the contract releases a ref once (GB-13). A row recorded
 * before migration 0021 has no ref and keeps the key it was credited under, chain + transaction + log.
 */
const keyOf = (e: { chainId: number; txHash: string; logIndex: number; ref: string | null }) =>
  e.ref ? `onchain:${e.chainId}:${e.ref}` : `onchain:${e.chainId}:${e.txHash.toLowerCase()}:${e.logIndex}`;

const REF = /^0x[0-9a-f]{64}$/;
/** Another reader stored this ref first (drizzle wraps the driver's error, so look at both). */
function isRefViolation(error: unknown): boolean {
  for (const e of [error, (error as { cause?: unknown })?.cause] as Array<{ code?: string; constraint_name?: string; constraint?: string; message?: string } | undefined>) {
    if (e?.code === "23505" && `${e.constraint_name ?? e.constraint ?? ""} ${e.message ?? ""}`.includes("onchain_credit_events_ref_unique")) return true;
  }
  return false;
}

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

/**
 * Record a redemption event and credit it if its wallet has an account. Replays change nothing, and
 * neither does the same ref arriving again from another transaction or log index (GB-13): the first
 * row for a ref is the one that is credited, and later copies are logged, not stored.
 */
export async function recordRedemption(db: Db, log: RedeemedLog): Promise<CreditResult> {
  if (!Number.isSafeInteger(log.amountMicro) || log.amountMicro <= 0) throw new Error("A redemption must be a positive whole number of units.");
  const ref = typeof log.ref === "string" ? log.ref.toLowerCase() : "";
  if (!REF.test(ref)) throw new Error("A redemption from the chain must carry its 32-byte ref.");
  const values = { chainId: log.chainId, txHash: log.txHash.toLowerCase(), logIndex: log.logIndex, blockNumber: log.blockNumber, wallet: log.wallet.toLowerCase(), amountMicro: log.amountMicro, ref };
  const atLog = and(eq(onchainCreditEvents.chainId, values.chainId), eq(onchainCreditEvents.txHash, values.txHash), eq(onchainCreditEvents.logIndex, values.logIndex));
  const byRef = and(eq(onchainCreditEvents.chainId, values.chainId), eq(onchainCreditEvents.ref, ref));
  // A row recorded before migration 0021 at this exact log has no ref: fill it in, unless another row already holds this ref.
  try {
    await db
      .update(onchainCreditEvents)
      .set({ ref })
      .where(and(atLog, isNull(onchainCreditEvents.ref), sql`not exists (select 1 from ${onchainCreditEvents} o where o.chain_id = ${values.chainId} and o.ref = ${ref})`));
  } catch (error) {
    if (!isRefViolation(error)) throw error; // a concurrent reader inserted this ref first; the row below is that one
  }
  // Conflicts on either unique index (this log, or this ref) leave the existing row alone.
  await db.insert(onchainCreditEvents).values(values).onConflictDoNothing();
  const [row] = (await db.select().from(onchainCreditEvents).where(byRef).limit(1)).concat(await db.select().from(onchainCreditEvents).where(atLog).limit(1));
  if (row.txHash !== values.txHash || row.logIndex !== values.logIndex) {
    console.warn(`[credits] chain ${values.chainId} ref ${ref} seen again at ${values.txHash}#${values.logIndex} (block ${values.blockNumber}); first recorded at ${row.txHash}#${row.logIndex} (block ${row.blockNumber}). A reorg or a re-paid quote: credited once.`);
    if (row.wallet !== values.wallet || row.amountMicro !== values.amountMicro) {
      console.warn(`[credits] chain ${values.chainId} ref ${ref}: the copies disagree (${row.wallet} ${row.amountMicro} vs ${values.wallet} ${values.amountMicro}). Not credited again; investigate.`);
    }
  }
  await markQuotePaid(db, ref, values.txHash);
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

type ReceiptClient = Pick<PublicClient, "getTransactionReceipt" | "getBlockNumber">;

/**
 * The user's own "I redeemed" call: read the transaction, keep only `Redeemed` logs the real contract
 * emitted, and record them. Whose they are comes from the log, never from the caller, so someone
 * submitting another wallet's hash only speeds up that wallet's credit. A transaction fewer than
 * SYNC_CONFIRMATIONS blocks deep answers `pending` and records nothing yet (GB-13); the screen asks again.
 */
export async function redeemFromReceipt(db: Db, client: ReceiptClient, chainId: number, txHash: Hex, env: NodeJS.ProcessEnv = process.env): Promise<{ events: number; creditedMicro: number; pending?: true }> {
  const contract = creditsContract(chainId, env);
  if (!contract) throw new CreditsNotConfiguredError(chainId);
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  // A head older than the receipt (another node answered) reads as not deep enough, which only waits.
  if ((await client.getBlockNumber()) - receipt.blockNumber < SYNC_CONFIRMATIONS) return { events: 0, creditedMicro: 0, pending: true };
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
/**
 * N (GB-13, D111): an event is credited only once at least this many blocks have been built on top of
 * its block. Celo makes a block a second, so about 30 seconds: well inside the browser's two-minute wait
 * after paying, and past the short reorgs of the newest blocks. The `safe` tag (measured about 4 minutes
 * behind) and `finalized` (about 25) are too slow for that wait.
 */
export const SYNC_CONFIRMATIONS = BigInt(30);
/**
 * K (GB-13, D111): the checkpoint never records a block newer than head minus K, so every scan re-reads
 * the newest K blocks. A node serving logs that lags the node that reported head by less than K can't
 * make the scan skip an event (re-reading is free: events credit once per ref). 1,800 blocks is about
 * 30 minutes, which also covers the measured distance to the `finalized` block (about 25 minutes), so a
 * reorg short of finality is re-read too. It costs one extra log call per scan.
 */
export const SYNC_CHECKPOINT_LAG = BigInt(1_800);

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
 * first scan after this change re-reads all history once and credits anything missed). At most
 * SYNC_MAX_BLOCKS per call, so a long gap catches up over a few ticks.
 *
 * GB-13: it reads only up to head minus SYNC_CONFIRMATIONS, and the checkpoint never passes head minus
 * SYNC_CHECKPOINT_LAG, so each scan re-reads at least the newest K blocks (this replaces D106's 64-block
 * overlap). A log the contract can't have emitted (an amount that isn't a positive whole number we can
 * count exactly, or no ref) is logged and skipped, so it can't hold the checkpoint back forever.
 */
export async function syncRedemptions(db: Db, client: LogClient, chainId: number, env: NodeJS.ProcessEnv = process.env): Promise<{ scanned: number; events: number }> {
  const contract = creditsContract(chainId, env);
  if (!contract) return { scanned: 0, events: 0 };
  const configured = BigInt(env[`CREDITS_START_BLOCK_${chainId}`] ?? 0);
  const cursor = await syncCursor(db, chainId);
  const head = await client.getBlockNumber();
  const deep = head - SYNC_CONFIRMATIONS; // the newest block credited from
  const mark = head - SYNC_CHECKPOINT_LAG; // the newest block the checkpoint may record
  let from = configured;
  if (cursor !== null) {
    // Resume after the checkpoint, but always re-read the newest K blocks, even if an older version
    // of this code (or a server whose node reported a later head) put the checkpoint inside them.
    let resume = BigInt(cursor) + BigInt(1);
    if (mark + BigInt(1) < resume) resume = mark + BigInt(1);
    if (resume > from) from = resume;
  }
  if (from > deep) return { scanned: 0, events: 0 };
  const last = from + SYNC_MAX_BLOCKS - BigInt(1);
  const stop = last < deep ? last : deep;
  let events = 0;
  const scanned = Number(stop - from + BigInt(1));
  while (from <= stop) {
    const to = from + SYNC_CHUNK - BigInt(1) < stop ? from + SYNC_CHUNK - BigInt(1) : stop;
    const logs = await client.getContractEvents({ address: contract, abi: CREDITS_ABI, eventName: "Redeemed", fromBlock: from, toBlock: to, strict: true });
    for (const l of logs) {
      const amountMicro = Number(l.args.credits);
      if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0 || !REF.test(String(l.args.ref).toLowerCase())) {
        console.error(`[credits] skipped a malformed Redeemed log on chain ${chainId}: ${l.transactionHash}#${l.logIndex} (block ${l.blockNumber}), credits ${String(l.args.credits)}, ref ${String(l.args.ref)}. Not credited; investigate.`);
        continue;
      }
      await recordRedemption(db, { chainId, txHash: l.transactionHash, logIndex: l.logIndex, blockNumber: Number(l.blockNumber), wallet: l.args.account, amountMicro, ref: l.args.ref });
      events++;
    }
    // Only once every event in the chunk is recorded: a failure above leaves the checkpoint where it was.
    // Never past head - K, so the newest blocks are read again next time.
    const upTo = to < mark ? to : mark;
    if (upTo >= configured) await advanceCursor(db, chainId, upTo);
    from = to + BigInt(1);
  }
  return { scanned, events };
}
