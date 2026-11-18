import "server-only";

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Address } from "viem";

import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import type { Db } from "@/server/db/client";
import { ledgerEntries, turnJobs, usageEvents, users } from "@/server/db/schema";
import { postLedgerEntry } from "./ledger";

/**
 * Free credits for verified people (D112). Nobody gets free build credits until GoodDollar's
 * Identity contract says they are a verified person. Then:
 * - a welcome grant, once per GoodDollar root (so linked wallets share it), posted automatically
 *   when the verification is first seen;
 * - a refill the person taps to claim, at most once a day, REFILLS_PER_WEEK a week and
 *   REFILLS_PER_MONTH a calendar month, counted per root. Weeks start Monday 00:00 UTC. A claim
 *   that isn't made is simply lost: nothing carries over.
 * Both are ordinary ledger `adjust` entries, so they are spent like any other credit. Planning is
 * free for everyone, up to FREE_PLAN_TURNS_PER_DAY plan turns a day per account (cap.ts).
 * Everything free (grants and free planning) shares one monthly budget.
 *
 * FREE_POLICY=legacy switches all of this off and goes back to D28/D30's free allowances. It is
 * the off switch if this goes wrong after launch.
 */

type Env = Record<string, string | undefined>;

/** Enough for a few small builds: live builds cost about 2 to 35 credits (D28). */
export const WELCOME_CREDITS = 40;
export const REFILL_CREDITS = 10;
export const REFILLS_PER_WEEK = 5;
export const REFILLS_PER_MONTH = 5;
export const FREE_PLAN_TURNS_PER_DAY = 5;
/** Everything free in a calendar month, in credits: grants plus free planning. Owner to tune (UNVERIFIED). */
export const FREE_BUDGET_CREDITS_PER_MONTH = 2_000;
/**
 * Free AI used before this moment counts against the welcome grant, so people verified under D30
 * aren't paid twice. Free planning after it doesn't. FREE_POLICY_START overrides.
 */
export const FREE_POLICY_START = "2026-11-18T00:00:00Z";
/** Held back in the budget for each free plan turn queued or running: more than a plan costs (PLAN_HEADROOM_MICRO). */
export const RESERVED_PER_PLAN_MICRO = 10_000;

export const WELCOME_REF = "welcome";
export const REFILL_REF = "refill";

export function freePolicy(env: Env): "verified" | "legacy" {
  return env.FREE_POLICY?.trim().toLowerCase() === "legacy" ? "legacy" : "verified";
}

/** A whole number from the settings (zero allowed), or the default. */
function count(raw: string | undefined, fallback: number) {
  const value = raw?.trim() ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function freeSettings(env: Env) {
  const start = new Date(env.FREE_POLICY_START?.trim() || FREE_POLICY_START);
  return {
    welcomeMicro: count(env.WELCOME_CREDITS, WELCOME_CREDITS) * MICRO_PER_CREDIT,
    refillMicro: count(env.REFILL_CREDITS, REFILL_CREDITS) * MICRO_PER_CREDIT,
    perWeek: count(env.REFILLS_PER_WEEK, REFILLS_PER_WEEK),
    perMonth: count(env.REFILLS_PER_MONTH, REFILLS_PER_MONTH),
    planTurnsPerDay: count(env.FREE_PLAN_TURNS_PER_DAY, FREE_PLAN_TURNS_PER_DAY),
    budgetMicro: count(env.FREE_BUDGET_CREDITS_PER_MONTH, FREE_BUDGET_CREDITS_PER_MONTH) * MICRO_PER_CREDIT,
    policyStart: Number.isNaN(start.getTime()) ? new Date(FREE_POLICY_START) : start,
  };
}

// ---------------------------------------------------------------- time windows (UTC)

export function dayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Monday 00:00 UTC of this week. */
export function weekStart(now: Date): Date {
  const day = dayStart(now);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * 86_400_000);
}

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const nextMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

/** `2026-11-18`, the day part of a refill's ledger key. */
export function dayKey(now: Date): string {
  return dayStart(now).toISOString().slice(0, 10);
}

export type RefillState = "available" | "claimed_today" | "week_full" | "month_full";

export interface RefillStatus {
  state: RefillState;
  leftThisWeek: number;
  leftThisMonth: number;
  /** When the next claim becomes possible, or null when one is possible now. */
  nextAt: Date | null;
  /** Days this calendar month a refill was claimed, oldest first (for the month meter). */
  claimedDays: string[];
}

/**
 * Where a person stands with refills, from the times of the claims they've made (any order). Pure,
 * so the week and month edges are easy to test.
 */
export function refillStatus(claims: Date[], now: Date, limits: { perWeek: number; perMonth: number }): RefillStatus {
  const today = dayStart(now).getTime();
  const week = weekStart(now).getTime();
  const month = monthStart(now).getTime();
  const inMonth = claims.filter((c) => c.getTime() >= month && c.getTime() <= now.getTime()).sort((a, b) => a.getTime() - b.getTime());
  const usedWeek = claims.filter((c) => c.getTime() >= week && c.getTime() <= now.getTime()).length;
  const claimedToday = claims.some((c) => c.getTime() >= today && c.getTime() <= now.getTime());
  const leftThisMonth = Math.max(limits.perMonth - inMonth.length, 0);
  const leftThisWeek = Math.min(Math.max(limits.perWeek - usedWeek, 0), leftThisMonth);
  const claimedDays = inMonth.map((c) => dayKey(c));

  if (leftThisMonth === 0) return { state: "month_full", leftThisWeek: 0, leftThisMonth, nextAt: nextMonth(now), claimedDays };
  if (leftThisWeek === 0) {
    const nextWeek = addDays(new Date(week), 7);
    // A week that crosses into a new month: the month resets first if it comes first.
    return { state: "week_full", leftThisWeek, leftThisMonth, nextAt: nextWeek < nextMonth(now) ? nextWeek : nextMonth(now), claimedDays };
  }
  if (claimedToday) return { state: "claimed_today", leftThisWeek, leftThisMonth, nextAt: addDays(new Date(today), 1), claimedDays };
  return { state: "available", leftThisWeek, leftThisMonth, nextAt: null, claimedDays };
}

// ---------------------------------------------------------------- the monthly budget

/**
 * What is free this month so far: grants posted, free AI charged since the policy started, and a
 * reservation for each free plan turn queued or running (other than `startingJobId`). In micro-USD.
 */
export async function freeUsedThisMonthMicro(db: Db, now: Date, env: Env, startingJobId?: string): Promise<number> {
  const { policyStart } = freeSettings(env);
  const month = monthStart(now);
  const since = policyStart > month ? policyStart : month;
  const [grants] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMicro}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.kind, "adjust"), inArray(ledgerEntries.refType, [WELCOME_REF, REFILL_REF]), gte(ledgerEntries.createdAt, month)));
  const [ai] = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.chargedMicro}), 0)` })
    .from(usageEvents)
    .where(and(eq(usageEvents.funding, "free"), gte(usageEvents.createdAt, since)));
  const open = await db
    .select({ id: turnJobs.id })
    .from(turnJobs)
    .where(and(eq(turnJobs.funding, "free"), inArray(turnJobs.status, ["queued", "running"])));
  const reserved = open.filter((j) => j.id !== startingJobId).length * RESERVED_PER_PLAN_MICRO;
  return Number(grants?.total ?? 0) + Number(ai?.total ?? 0) + reserved;
}

export async function freeBudgetLeftMicro(db: Db, now: Date, env: Env, startingJobId?: string): Promise<number> {
  return freeSettings(env).budgetMicro - (await freeUsedThisMonthMicro(db, now, env, startingJobId));
}

// ---------------------------------------------------------------- claims

export type FreeGrantErrorCode = "not_verified" | "expired" | "claimed_today" | "week_full" | "month_full" | "budget_full" | "off";

export class FreeGrantError extends Error {
  constructor(
    readonly code: FreeGrantErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const NOT_VERIFIED_MESSAGE = "This wallet isn't verified with GoodDollar yet. Verify, then try again.";
export const EXPIRED_MESSAGE = "Your GoodDollar verification has expired. Verify again to keep getting refills.";
export const BUDGET_FULL_MESSAGE = "This month's free credits are all gone. Refills come back on the 1st. Credits you buy still work.";

/** What GoodDollar's Identity contract says about a wallet, read fresh. */
export interface GoodIdentity {
  /** The verified wallet behind this one (itself or the one it's linked to), lowercased, or null. */
  root: Address | null;
  /** When the root's verification runs out, or null when the contract doesn't say. */
  expiresAt: Date | null;
}

export interface FreeDeps {
  readIdentity: (wallet: Address) => Promise<GoodIdentity>;
  now?: Date;
  env?: Env;
}

export interface WelcomeResult {
  /** Credits posted by this call (0 when already granted or nothing was due). */
  grantedMicro: number;
  /** True once this root has had its welcome, now or before. */
  done: boolean;
}

export interface RefillResult {
  grantedMicro: number;
  status: RefillStatus;
}

async function lockFree(tx: Db) {
  // One lock for every free grant: the budget is shared, and volume is small.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('free-grants'))`);
}

/** Keep the account's verification in step with what the chain just said. */
async function recordRoot(tx: Db, userId: string, root: string) {
  await tx.update(users).set({ goodidRoot: root, verifiedAt: sql`coalesce(${users.verifiedAt}, now())` }).where(eq(users.id, userId));
}

/** Free AI this person had before the policy started: every account with this root, plus this one. */
async function priorFreeMicro(tx: Db, userId: string, root: string, before: Date): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${usageEvents.chargedMicro}), 0)` })
    .from(usageEvents)
    .innerJoin(users, eq(usageEvents.userId, users.id))
    .where(and(sql`(${users.goodidRoot} = ${root} or ${users.id} = ${userId})`, eq(usageEvents.funding, "free"), lt(usageEvents.createdAt, before)));
  return Number(row?.total ?? 0);
}

async function welcomeFor(tx: Db, root: string) {
  const [row] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.refType, WELCOME_REF), eq(ledgerEntries.refId, root))).limit(1);
  return row;
}

/**
 * Give a verified person their welcome credits, once per root. Safe to call any number of times.
 * Free AI they had before D112 (D28, D30) comes off it, so nobody is paid twice; if that leaves
 * nothing, nothing is posted and the welcome counts as done.
 */
export async function claimWelcome(db: Db, user: { id: string; wallet: string }, deps: FreeDeps): Promise<WelcomeResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  if (freePolicy(env) === "legacy") throw new FreeGrantError("off", "Free credits work the old way right now.");
  // The chain decides, never a stored flag or GoodDollar's redirect. Read outside the transaction.
  const identity = await deps.readIdentity(user.wallet as Address);
  if (!identity.root) throw new FreeGrantError("not_verified", NOT_VERIFIED_MESSAGE);
  const root = identity.root.toLowerCase();
  const settings = freeSettings(env);

  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await lockFree(tx);
    await recordRoot(tx, user.id, root);
    if (await welcomeFor(tx, root)) return { grantedMicro: 0, done: true };

    const amount = settings.welcomeMicro - (await priorFreeMicro(tx, user.id, root, settings.policyStart));
    if (amount <= 0) return { grantedMicro: 0, done: true };
    if ((await freeBudgetLeftMicro(tx, now, env)) < amount) throw new FreeGrantError("budget_full", BUDGET_FULL_MESSAGE);
    await postLedgerEntry(tx, { userId: user.id, kind: "adjust", amountMicro: amount, idempotencyKey: `welcome:${root}`, refType: WELCOME_REF, refId: root });
    return { grantedMicro: amount, done: true };
  });
}

/**
 * The days this root claimed a refill, from the earlier of this week's and this month's start. Read
 * from the ledger keys (`refill:<root>:<day>`), so the day a claim counts for is the day it was
 * made for, whatever the clock in the database says.
 */
async function refillTimes(db: Db, root: string, now: Date): Promise<Date[]> {
  const week = weekStart(now);
  const month = monthStart(now);
  const since = dayKey(week < month ? week : month);
  const prefix = `refill:${root}:`;
  const rows = await db
    .select({ key: ledgerEntries.idempotencyKey })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.refType, REFILL_REF), eq(ledgerEntries.refId, root)));
  return rows
    .map((r) => r.key.slice(prefix.length))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= since)
    .map((day) => new Date(`${day}T00:00:00Z`));
}

const REFUSAL: Record<Exclude<RefillState, "available">, string> = {
  claimed_today: "You've claimed today's refill. Come back tomorrow.",
  week_full: "You've used this week's refills. They come back on Monday.",
  month_full: "You've used this month's refills. They come back on the 1st.",
};

/**
 * Claim today's refill. The chain is read again: the wallet must still have a root, and the root's
 * verification must not have expired. Then the day, week and month limits, counted per root under
 * the free-grants lock, and the monthly budget.
 */
export async function claimRefill(db: Db, user: { id: string; wallet: string }, deps: FreeDeps): Promise<RefillResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  if (freePolicy(env) === "legacy") throw new FreeGrantError("off", "Free credits work the old way right now.");
  const identity = await deps.readIdentity(user.wallet as Address);
  if (!identity.root) {
    const [row] = await db.select({ verifiedAt: users.verifiedAt }).from(users).where(eq(users.id, user.id)).limit(1);
    // Verified before but the chain no longer says so: GoodDollar's verification has lapsed.
    throw row?.verifiedAt ? new FreeGrantError("expired", EXPIRED_MESSAGE) : new FreeGrantError("not_verified", NOT_VERIFIED_MESSAGE);
  }
  if (identity.expiresAt && identity.expiresAt <= now) throw new FreeGrantError("expired", EXPIRED_MESSAGE);
  const root = identity.root.toLowerCase();
  const settings = freeSettings(env);

  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await lockFree(tx);
    await recordRoot(tx, user.id, root);
    const before = refillStatus(await refillTimes(tx, root, now), now, settings);
    if (before.state !== "available") throw new FreeGrantError(before.state, REFUSAL[before.state]);
    if (settings.refillMicro <= 0) throw new FreeGrantError("off", "Refills are switched off right now.");
    if ((await freeBudgetLeftMicro(tx, now, env)) < settings.refillMicro) throw new FreeGrantError("budget_full", BUDGET_FULL_MESSAGE);
    await postLedgerEntry(tx, { userId: user.id, kind: "adjust", amountMicro: settings.refillMicro, idempotencyKey: `refill:${root}:${dayKey(now)}`, refType: REFILL_REF, refId: root });
    return { grantedMicro: settings.refillMicro, status: refillStatus([...(await refillTimes(tx, root, now))], now, settings) };
  });
}

// ---------------------------------------------------------------- status for the cards

export interface FreeStatus {
  policy: "verified" | "legacy";
  verified: boolean;
  /** The welcome grant for this root has been handled (posted, or nothing was due). */
  welcomeDone: boolean;
  welcomeCredits: number;
  refillCredits: number;
  refill: RefillStatus | null;
  budgetFull: boolean;
}

/**
 * Where this account stands, from what's stored: no chain read, so it's cheap enough for every page
 * load. A claim reads the chain again before it pays anything.
 */
export async function freeStatus(db: Db, userId: string, now = new Date(), env: Env = process.env): Promise<FreeStatus> {
  const settings = freeSettings(env);
  const [user] = await db.select({ verifiedAt: users.verifiedAt, goodidRoot: users.goodidRoot }).from(users).where(eq(users.id, userId)).limit(1);
  const root = user?.verifiedAt ? user.goodidRoot : null;
  const base = {
    policy: freePolicy(env),
    welcomeCredits: settings.welcomeMicro / MICRO_PER_CREDIT,
    refillCredits: settings.refillMicro / MICRO_PER_CREDIT,
    budgetFull: (await freeBudgetLeftMicro(db, now, env)) < Math.min(settings.refillMicro || Infinity, settings.welcomeMicro || Infinity),
  };
  if (!root) return { ...base, verified: false, welcomeDone: false, refill: null };
  // Nothing is posted when earlier free AI used the whole welcome, so that counts as done too.
  const welcomeDone = Boolean(await welcomeFor(db, root)) || (await priorFreeMicro(db, userId, root, settings.policyStart)) >= settings.welcomeMicro;
  return { ...base, verified: true, welcomeDone, refill: refillStatus(await refillTimes(db, root, now), now, settings) };
}
