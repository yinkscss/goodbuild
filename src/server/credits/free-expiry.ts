import "server-only";

import { and, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";

import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import type { Db } from "@/server/db/client";
import { ledgerEntries } from "@/server/db/schema";
import { REFILL_REF, WELCOME_REF, freePolicy, freeSettings } from "./free-grants";
import { lockBalance } from "./holds";
import { postLedgerEntry } from "./ledger";

type Env = Record<string, string | undefined>;

export const FREE_EXPIRY_REF = "free_expiry";

export interface FreeExpiryResult {
  checked: number;
  expired: number;
  removedCredits: number;
}

const GRANTS = [WELCOME_REF, REFILL_REF];

/**
 * Take back free credits (welcome and refills, D123) not spent within FREE_CREDITS_EXPIRE_DAYS of
 * being given. Free credit is counted as spent first, so what's left of it came from the newest
 * grants: anything left beyond what was granted inside the window has outlived it. For each account:
 *
 *   left    = granted − already expired − everything spent since the first grant
 *   expire  = left − granted inside the window, never more than the balance not set aside for builds
 *
 * Counting every spend since the first grant (paid ones too) can only make `left` smaller, so a
 * mistake here keeps credit with the person rather than taking too much. Bought credits are never
 * touched, and no balance goes below zero. Safe to run any number of times: each run recomputes from
 * the ledger under the account's balance lock, and its entry is keyed to the hour.
 */
export async function expireFreeCredits(db: Db, now = new Date(), env: Env = process.env): Promise<FreeExpiryResult> {
  const settings = freeSettings(env);
  const result: FreeExpiryResult = { checked: 0, expired: 0, removedCredits: 0 };
  if (freePolicy(env) === "legacy" || settings.expireDays <= 0) return result;
  const cutoff = new Date(now.getTime() - settings.expireDays * 86_400_000);

  const candidates = await db
    .selectDistinct({ userId: ledgerEntries.userId })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.kind, "adjust"), inArray(ledgerEntries.refType, GRANTS), lte(ledgerEntries.createdAt, cutoff)));
  result.checked = candidates.length;

  for (const { userId } of candidates) {
    const removed = await db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const balance = await lockBalance(tx, userId);
      const sum = async (where: ReturnType<typeof and>) => {
        const [row] = await tx.select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMicro}), 0)` }).from(ledgerEntries).where(where);
        return Number(row?.total ?? 0);
      };
      const mine = eq(ledgerEntries.userId, userId);
      const [first] = await tx
        .select({ at: sql<Date>`min(${ledgerEntries.createdAt})` })
        .from(ledgerEntries)
        .where(and(mine, eq(ledgerEntries.kind, "adjust"), inArray(ledgerEntries.refType, GRANTS)));
      const granted = await sum(and(mine, eq(ledgerEntries.kind, "adjust"), inArray(ledgerEntries.refType, GRANTS)));
      const expired = -(await sum(and(mine, eq(ledgerEntries.refType, FREE_EXPIRY_REF))));
      const spent = first?.at ? -(await sum(and(mine, eq(ledgerEntries.kind, "usage"), gte(ledgerEntries.createdAt, new Date(first.at))))) : 0;
      const recent = await sum(and(mine, eq(ledgerEntries.kind, "adjust"), inArray(ledgerEntries.refType, GRANTS), gt(ledgerEntries.createdAt, cutoff)));
      const left = Math.max(0, granted - expired - spent);
      const remove = Math.min(Math.max(0, left - recent), Math.max(0, balance.availableMicro));
      if (remove <= 0) return 0;
      const hour = now.toISOString().slice(0, 13);
      await postLedgerEntry(tx, { userId, kind: "adjust", amountMicro: -remove, idempotencyKey: `free-expiry:${userId}:${hour}`, refType: FREE_EXPIRY_REF, refId: hour });
      return remove;
    });
    if (removed > 0) {
      result.expired += 1;
      result.removedCredits += Math.round(removed / MICRO_PER_CREDIT);
    }
  }
  return result;
}

/** The worker's hourly call. Logs only when it took something back. */
export async function sweepFreeExpiry(getDb: () => Promise<Db>, now = new Date()): Promise<FreeExpiryResult> {
  const result = await expireFreeCredits(await getDb(), now);
  if (result.expired) console.log(`[worker] free credit expiry: ${result.expired} accounts, ${result.removedCredits} credits taken back`);
  return result;
}
