import "server-only";

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import { IdempotencyConflictError, InsufficientBalanceError, getBalanceMicro, postLedgerEntry } from "@/server/credits/ledger";
import type { Db } from "@/server/db/client";
import { hackathonRefusals, hackathonRegistrations } from "@/server/db/hackathon-schema";
import { ledgerEntries, users } from "@/server/db/schema";
import { CLAIMS_CLOSE, HACKATHON_ID, budgetCredits } from "./claim";

/** A wallet that signed up this soon before claiming is flagged on the admin page. */
export const FRESH_WALLET_MS = 10 * 60 * 1000;

const credits = (micro: number) => Math.round(micro / MICRO_PER_CREDIT);

export interface ExpireResult {
  checked: number;
  expired: number;
  removedCredits: number;
  /** Rows left for the next sweep because the balance moved while they were being expired. */
  skipped: number;
}

/**
 * After the deadline, remove what each builder hasn't spent of their hackathon grant. AI usage
 * since registering counts against the grant first, so credits a person bought are never removed,
 * and the removal never takes a balance below zero. Each row is done once (keyed by root), so the
 * sweep is safe to run again.
 */
export async function expireUnusedCredits(db: Db, now = new Date()): Promise<ExpireResult> {
  if (now < CLAIMS_CLOSE) throw new Error("Hackathon credits can only be expired after claims close.");
  const rows = await db
    .select()
    .from(hackathonRegistrations)
    .where(and(eq(hackathonRegistrations.hackathon, HACKATHON_ID), isNull(hackathonRegistrations.expiredAt)));
  const result: ExpireResult = { checked: rows.length, expired: 0, removedCredits: 0, skipped: 0 };

  for (const row of rows) {
    const granted = row.startMicro + row.deployMicro;
    const [usage] = await db
      .select({ micro: sql<string>`coalesce(sum(-${ledgerEntries.amountMicro}), 0)` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.userId, row.userId), eq(ledgerEntries.kind, "usage"), gte(ledgerEntries.createdAt, row.createdAt)));
    const unspent = Math.max(0, granted - Number(usage.micro));
    const balance = await getBalanceMicro(db, row.userId);
    const remove = Math.min(unspent, Math.max(0, balance));
    try {
      let entryId: string | null = null;
      if (remove > 0) {
        const posted = await postLedgerEntry(db, {
          userId: row.userId,
          kind: "adjust",
          amountMicro: -remove,
          idempotencyKey: `hackathon:${HACKATHON_ID}:expire:${row.goodidRoot}`,
          refType: "hackathon",
          refId: `${HACKATHON_ID}:expire`,
        });
        entryId = posted.entry.id;
      }
      await db.update(hackathonRegistrations).set({ expiredEntryId: entryId, expiredMicro: remove, expiredAt: now }).where(eq(hackathonRegistrations.id, row.id));
      result.expired += 1;
      result.removedCredits += credits(remove);
    } catch (error) {
      // The balance moved under us, or another sweep got there first with other numbers.
      if (!(error instanceof InsufficientBalanceError || error instanceof IdempotencyConflictError)) throw error;
      result.skipped += 1;
    }
  }
  return result;
}

/** The worker's hourly call: a no-op until claims close, then one sweep that logs what it did. */
export async function sweepHackathonExpiry(getDb: () => Promise<Db>, now = new Date()): Promise<ExpireResult | null> {
  if (now < CLAIMS_CLOSE) return null;
  const result = await expireUnusedCredits(await getDb(), now);
  if (result.expired || result.skipped) console.log(`[worker] hackathon expiry: ${result.expired} expired, ${result.removedCredits} credits removed, ${result.skipped} left for next time`);
  return result;
}

export interface HackathonReport {
  budgetCredits: number;
  grantedCredits: number;
  expiredCredits: number;
  registered: number;
  deployed: number;
  refusals: number;
  closesAt: string;
  closed: boolean;
  expiredDone: boolean;
  perDay: Array<{ day: string; count: number }>;
  rows: Array<{ wallet: string; root: string; at: string; startCredits: number; deployCredits: number; expiredCredits: number; freshWallet: boolean; linkedWallet: boolean }>;
  refused: Array<{ wallet: string; root: string; code: string; at: string }>;
}

/** Everything the admin page shows, newest first. */
export async function hackathonReport(db: Db, now = new Date(), env: Record<string, string | undefined> = process.env, limit = 500): Promise<HackathonReport> {
  const mine = eq(hackathonRegistrations.hackathon, HACKATHON_ID);
  const [totals] = await db
    .select({
      registered: sql<number>`count(*)::int`,
      deployed: sql<number>`count(${hackathonRegistrations.deployEntryId})::int`,
      granted: sql<string>`coalesce(sum(${hackathonRegistrations.startMicro} + ${hackathonRegistrations.deployMicro}), 0)`,
      expired: sql<string>`coalesce(sum(${hackathonRegistrations.expiredMicro}), 0)`,
      pending: sql<number>`count(*) filter (where ${hackathonRegistrations.expiredAt} is null)::int`,
    })
    .from(hackathonRegistrations)
    .where(mine);

  const day = sql<string>`to_char(${hackathonRegistrations.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const perDay = await db.select({ day, count: sql<number>`count(*)::int` }).from(hackathonRegistrations).where(mine).groupBy(day).orderBy(day);

  const rows = await db
    .select({ reg: hackathonRegistrations, accountCreatedAt: users.createdAt })
    .from(hackathonRegistrations)
    .innerJoin(users, eq(users.id, hackathonRegistrations.userId))
    .where(mine)
    .orderBy(desc(hackathonRegistrations.createdAt))
    .limit(limit);

  const [refusalCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(hackathonRefusals)
    .where(eq(hackathonRefusals.hackathon, HACKATHON_ID));
  const refused = await db.select().from(hackathonRefusals).where(eq(hackathonRefusals.hackathon, HACKATHON_ID)).orderBy(desc(hackathonRefusals.createdAt)).limit(100);

  return {
    budgetCredits: budgetCredits(env),
    grantedCredits: credits(Number(totals.granted)),
    expiredCredits: credits(Number(totals.expired)),
    registered: totals.registered,
    deployed: totals.deployed,
    refusals: refusalCount.n,
    closesAt: CLAIMS_CLOSE.toISOString(),
    closed: now >= CLAIMS_CLOSE,
    expiredDone: totals.registered > 0 && totals.pending === 0,
    perDay,
    rows: rows.map(({ reg, accountCreatedAt }) => ({
      wallet: reg.wallet,
      root: reg.goodidRoot,
      at: reg.createdAt.toISOString(),
      startCredits: credits(reg.startMicro),
      deployCredits: credits(reg.deployMicro),
      expiredCredits: credits(reg.expiredMicro),
      freshWallet: reg.createdAt.getTime() - accountCreatedAt.getTime() < FRESH_WALLET_MS,
      linkedWallet: reg.wallet !== reg.goodidRoot,
    })),
    refused: refused.map((r) => ({ wallet: r.wallet, root: r.goodidRoot, code: r.code, at: r.createdAt.toISOString() })),
  };
}
