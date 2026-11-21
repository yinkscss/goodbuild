import "server-only";

import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { creditQuotes } from "@/server/db/credit-quotes-schema";
import { onchainCreditEvents, creditsSyncCursor } from "@/server/db/onchain-credits-schema";
import { users } from "@/server/db/schema";

export const PAYMENT_WARNING_AGE_MS = 10 * 60 * 1000;
/** Bounded samples of ingested payments awaiting a ledger entry. Unpaid quotes are normal. */
export async function paymentHealth(db: Db, chainId: number, head: bigint, now = new Date()) {
  const cutoff = new Date(now.getTime() - PAYMENT_WARNING_AGE_MS);
  const unsettled = await db.select({ txHash: onchainCreditEvents.txHash, ref: onchainCreditEvents.ref })
    .from(onchainCreditEvents).innerJoin(users, eq(users.wallet, onchainCreditEvents.wallet))
    .where(and(eq(onchainCreditEvents.chainId, chainId), isNull(onchainCreditEvents.ledgerEntryId), lt(onchainCreditEvents.createdAt, cutoff))).limit(20);
  const missing = await db.select({ txHash: creditQuotes.paidTx, ref: creditQuotes.ref })
    .from(creditQuotes).leftJoin(onchainCreditEvents, and(eq(onchainCreditEvents.chainId, creditQuotes.chainId), eq(onchainCreditEvents.ref, creditQuotes.ref)))
    .where(and(eq(creditQuotes.chainId, chainId), isNotNull(creditQuotes.paidTx), lt(creditQuotes.paidAt, cutoff), isNull(onchainCreditEvents.id))).limit(20);
  const [cursor] = await db.select().from(creditsSyncCursor).where(eq(creditsSyncCursor.chainId, chainId));
  // The scanner deliberately trails by 1,800 blocks. Allow another 1,800 before warning.
  const scannerBehind = !cursor || head - BigInt(cursor.lastBlock) > BigInt(3600);
  return { chainId, awaitingCredits: [...unsettled, ...missing], scannerBehind, cursorBlock: cursor?.lastBlock ?? null, headBlock: head.toString(), sampled: unsettled.length === 20 || missing.length === 20 };
}

/** One warning per chain per 15 minutes; recovery is logged once. No external messages. */
export function createPaymentMonitor(log: Pick<Console, "warn" | "info"> = console) {
  const warnings = new Map<number, number>();
  return async (db: Db, chainId: number, head: bigint, now = new Date()) => {
    const health = await paymentHealth(db, chainId, head, now);
    if (health.awaitingCredits.length || health.scannerBehind) {
      const previous = warnings.get(chainId);
      if (previous === undefined || now.getTime() - previous >= 15 * 60 * 1000) {
        log.warn("[credits] payment_health", { ...health, thresholdMinutes: 10 });
        warnings.set(chainId, now.getTime());
      }
    } else if (warnings.delete(chainId)) log.info("[credits] payment_health_recovered", { chainId });
    return health;
  };
}
