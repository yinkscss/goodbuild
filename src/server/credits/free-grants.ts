import "server-only";

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Address } from "viem";

import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import type { Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { ledgerEntries, turnJobs, usageEvents, users } from "@/server/db/schema";
import { readBalance } from "./holds";
import { postLedgerEntry } from "./ledger";

/**
 * Free credits for verified people (D123). Nobody gets free build credits until GoodDollar's
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
/** Free plan turns a day for a verified account. */
export const FREE_PLAN_TURNS_PER_DAY = 5;
/** Free plan turns a day before verifying: new wallets cost nothing, so this is the one thing a fake account can farm. */
export const FREE_PLAN_TURNS_PER_DAY_UNVERIFIED = 2;
/** Everything free in a calendar month, in credits ($50): grants plus free planning. Set by the owner, 18 Nov 2026. */
export const FREE_BUDGET_CREDITS_PER_MONTH = 5_000;
/** The same, a week (Monday 00:00 UTC), so the month's budget isn't all gone in its first days. */
export const FREE_BUDGET_CREDITS_PER_WEEK = 1_250;
/** A refill only for someone below this many credits, so free credit can't pile up. 0 turns it off. */
export const REFILL_BELOW_CREDITS = 10;
/** A refill only for someone who finished a build or deployed in this many days. 0 turns it off. */
export const REFILL_ACTIVE_DAYS = 30;
/** Free credits not spent this many days after they were given are taken back. 0 turns it off. */
export const FREE_CREDITS_EXPIRE_DAYS = 30;
/**
 * Free AI used before this moment counts against the welcome grant, so people verified under D30
 * aren't paid twice. Free planning after it doesn't. FREE_POLICY_START overrides.
 */
export const FREE_POLICY_START = "2026-11-18T00:00:00Z";
/** Held back in the budget for each free plan turn queued or running: more than a plan costs (PLAN_HEADROOM_MICRO). */
export const RESERVED_PER_PLAN_MICRO = 10_000;

/**
 * Refills follow GoodDollar's day, which runs noon to noon UTC (UBISchemeV2's periodStart, read on
 * Celo as 2023-03-01T12:00:00Z), so "claim your G$, then your refill" is one day in both places.
 * Weeks and months for refills shift by the same 12 hours: a week starts Monday at noon UTC.
 */
export const GD_DAY_OFFSET_MS = 12 * 3_600_000;

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
    planTurnsPerDayUnverified: count(env.FREE_PLAN_TURNS_PER_DAY_UNVERIFIED, FREE_PLAN_TURNS_PER_DAY_UNVERIFIED),
    budgetMicro: count(env.FREE_BUDGET_CREDITS_PER_MONTH, FREE_BUDGET_CREDITS_PER_MONTH) * MICRO_PER_CREDIT,
    weekBudgetMicro: count(env.FREE_BUDGET_CREDITS_PER_WEEK, FREE_BUDGET_CREDITS_PER_WEEK) * MICRO_PER_CREDIT,
    refillBelowMicro: count(env.REFILL_BELOW_CREDITS, REFILL_BELOW_CREDITS) * MICRO_PER_CREDIT,
    activeDays: count(env.REFILL_ACTIVE_DAYS, REFILL_ACTIVE_DAYS),
    expireDays: count(env.FREE_CREDITS_EXPIRE_DAYS, FREE_CREDITS_EXPIRE_DAYS),
    policyStart: Number.isNaN(start.getTime()) ? new Date(FREE_POLICY_START) : start,
    /** The refill needs today's G$ UBI claimed first (on unless REFILL_REQUIRES_UBI=off). */
    requiresUbi: env.REFILL_REQUIRES_UBI?.trim().toLowerCase() !== "off",
    /** The welcome waits for a FlowState vote for GoodBuildIt (D125; on unless WELCOME_REQUIRES_VOTE=off). */
    welcomeNeedsVote: env.WELCOME_REQUIRES_VOTE?.trim().toLowerCase() !== "off",
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

/** The moment GoodDollar's current day began (noon UTC). */
export function gdDayStart(now: Date): Date {
  return new Date(dayStart(new Date(now.getTime() - GD_DAY_OFFSET_MS)).getTime() + GD_DAY_OFFSET_MS);
}

/** refillStatus on GoodDollar's day: the clock is shifted back 12 hours, and the next time forward again. */
export function refillStatusGd(claims: Date[], now: Date, limits: { perWeek: number; perMonth: number }): RefillStatus {
  const s = refillStatus(claims, new Date(now.getTime() - GD_DAY_OFFSET_MS), limits);
  return { ...s, nextAt: s.nextAt ? new Date(s.nextAt.getTime() + GD_DAY_OFFSET_MS) : null };
}

/** The ledger-key day for a refill made now: the date GoodDollar's current day began on. */
export const gdDayKey = (now: Date) => dayKey(new Date(now.getTime() - GD_DAY_OFFSET_MS));

// ---------------------------------------------------------------- the monthly and weekly budgets

/**
 * What is free since `from`: grants posted, free AI charged (never before the policy started), and a
 * reservation for each free plan turn queued or running (other than `startingJobId`). In micro-USD.
 */
async function freeUsedSinceMicro(db: Db, from: Date, env: Env, startingJobId?: string): Promise<number> {
  const { policyStart } = freeSettings(env);
  const since = policyStart > from ? policyStart : from;
  const [grants] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMicro}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.kind, "adjust"), inArray(ledgerEntries.refType, [WELCOME_REF, REFILL_REF]), gte(ledgerEntries.createdAt, from)));
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

/** What's free this calendar month so far. */
export function freeUsedThisMonthMicro(db: Db, now: Date, env: Env, startingJobId?: string): Promise<number> {
  return freeUsedSinceMicro(db, monthStart(now), env, startingJobId);
}

/**
 * Room left for free credit: the smaller of the month's and the week's (calendar, UTC), and which of
 * the two is the tighter, so a refusal can say when it comes back.
 */
export async function freeBudget(db: Db, now: Date, env: Env, startingJobId?: string): Promise<{ leftMicro: number; limit: "week" | "month" }> {
  const settings = freeSettings(env);
  const month = settings.budgetMicro - (await freeUsedSinceMicro(db, monthStart(now), env, startingJobId));
  const week = settings.weekBudgetMicro - (await freeUsedSinceMicro(db, weekStart(now), env, startingJobId));
  return week < month ? { leftMicro: week, limit: "week" } : { leftMicro: month, limit: "month" };
}

export async function freeBudgetLeftMicro(db: Db, now: Date, env: Env, startingJobId?: string): Promise<number> {
  return (await freeBudget(db, now, env, startingJobId)).leftMicro;
}

// ---------------------------------------------------------------- claims

export type FreeGrantErrorCode = "not_verified" | "expired" | "ubi_not_claimed" | "claimed_today" | "week_full" | "month_full" | "budget_full" | "not_low" | "inactive" | "off" | "not_voted";

export const NOT_VOTED_MESSAGE = "One last step: vote for GoodBuildIt on FlowState, right here on GoodBuild, to unlock your free credits. We cover the network fee.";

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
export const UBI_NOT_CLAIMED_MESSAGE = "Claim today's G$ UBI first, then claim your refill.";
export const BUDGET_FULL_MESSAGE = "This month's free credits are all gone. Refills come back on the 1st. Credits you buy still work.";
export const WEEK_BUDGET_FULL_MESSAGE = "This week's free credits are all gone. They come back on Monday. Credits you buy still work.";
export const budgetFullMessage = (limit: "week" | "month") => (limit === "week" ? WEEK_BUDGET_FULL_MESSAGE : BUDGET_FULL_MESSAGE);
export const notLowMessage = (credits: number) => `Refills are for when you're running low. You can claim one once you have under ${credits} credits.`;
export const INACTIVE_MESSAGE = "Refills are for people who are building. Finish a build or deploy an app, then claim.";

/** What GoodDollar's Identity contract says about a wallet, read fresh. */
export interface GoodIdentity {
  /** The verified wallet behind this one (itself or the one it's linked to), lowercased, or null. */
  root: Address | null;
  /** When the root's verification runs out, or null when the contract doesn't say. */
  expiresAt: Date | null;
}

export interface FreeDeps {
  readIdentity: (wallet: Address) => Promise<GoodIdentity>;
  /** When this root last claimed its G$ UBI (UBIScheme lastClaimed), read fresh. Needed by refills. */
  readUbiClaimedAt?: (root: Address) => Promise<Date | null>;
  /** Has this wallet's FlowState vote for GoodBuildIt landed on-chain? Read fresh. Needed by the welcome (D125). */
  readVoted?: (wallet: Address) => Promise<boolean>;
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
 * Free AI they had before D123 (D28, D30) comes off it, so nobody is paid twice; if that leaves
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
  // D125: the welcome also needs a vote for GoodBuildIt on FlowState, cast in GoodBuild's own dialog.
  // Someone already granted isn't asked again. No vote reader means no proof, so no welcome.
  if (settings.welcomeNeedsVote && !(await welcomeFor(db, root))) {
    const voted = deps.readVoted ? await deps.readVoted(user.wallet as Address) : false;
    if (!voted) throw new FreeGrantError("not_voted", NOT_VOTED_MESSAGE);
  }

  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await lockFree(tx);
    await recordRoot(tx, user.id, root);
    if (await welcomeFor(tx, root)) return { grantedMicro: 0, done: true };

    const amount = settings.welcomeMicro - (await priorFreeMicro(tx, user.id, root, settings.policyStart));
    if (amount <= 0) return { grantedMicro: 0, done: true };
    const budget = await freeBudget(tx, now, env);
    if (budget.leftMicro < amount) throw new FreeGrantError("budget_full", budgetFullMessage(budget.limit));
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
  // Keys are GoodDollar days, so the windows are worked out on GoodDollar's clock.
  const gdNow = new Date(now.getTime() - GD_DAY_OFFSET_MS);
  const week = weekStart(gdNow);
  const month = monthStart(gdNow);
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

/**
 * Why this person can't have a refill right now, beyond the day, week and month limits, or null.
 * - `not_low`: this account has REFILL_BELOW_CREDITS or more, so free credit can't pile up.
 * - `inactive`: no account on this GoodDollar identity finished a build or deployed in REFILL_ACTIVE_DAYS.
 */
async function refillBlock(db: Db, userId: string, root: string, now: Date, settings: ReturnType<typeof freeSettings>): Promise<"not_low" | "inactive" | null> {
  if (settings.refillBelowMicro > 0 && (await readBalance(db, userId)).balanceMicro >= settings.refillBelowMicro) return "not_low";
  if (settings.activeDays > 0) {
    const since = new Date(now.getTime() - settings.activeDays * 86_400_000);
    const people = sql`(select ${users.id} from ${users} where ${users.goodidRoot} = ${root} or ${users.id} = ${userId})`;
    const [built] = await db
      .select({ id: turnJobs.id })
      .from(turnJobs)
      .where(and(sql`${turnJobs.userId} in ${people}`, eq(turnJobs.mode, "build"), eq(turnJobs.status, "done"), gte(turnJobs.createdAt, since)))
      .limit(1);
    if (built) return null;
    const [deployed] = await db.select({ id: deployments.id }).from(deployments).where(and(sql`${deployments.userId} in ${people}`, gte(deployments.createdAt, since))).limit(1);
    if (!deployed) return "inactive";
  }
  return null;
}

function blockError(block: "not_low" | "inactive", settings: ReturnType<typeof freeSettings>) {
  return block === "not_low" ? new FreeGrantError("not_low", notLowMessage(settings.refillBelowMicro / MICRO_PER_CREDIT)) : new FreeGrantError("inactive", INACTIVE_MESSAGE);
}

const REFUSAL: Record<Exclude<RefillState, "available">, string> = {
  claimed_today: "You've claimed today's refill. Come back tomorrow.",
  week_full: "You've used this week's refills. They come back on Monday at noon UTC.",
  month_full: "You've used this month's refills. They come back on the 1st.",
};

/**
 * Claim today's refill. The chain is read again: the wallet must still have a root, the root's
 * verification must not have expired, and (unless REFILL_REQUIRES_UBI=off) the root must have claimed
 * its G$ UBI since GoodDollar's day began at noon UTC. Then the day, week and month limits, counted
 * per root under the free-grants lock, and the monthly budget.
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
  // Before the UBI check, so nobody is sent to pay a network fee for a refill they can't have.
  const early = await refillBlock(db, user.id, root, now, settings);
  if (early) throw blockError(early, settings);
  if (settings.requiresUbi) {
    const claimedAt = deps.readUbiClaimedAt ? await deps.readUbiClaimedAt(identity.root) : null;
    if (!claimedAt || claimedAt < gdDayStart(now)) throw new FreeGrantError("ubi_not_claimed", UBI_NOT_CLAIMED_MESSAGE);
  }

  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await lockFree(tx);
    await recordRoot(tx, user.id, root);
    const before = refillStatusGd(await refillTimes(tx, root, now), now, settings);
    if (before.state !== "available") throw new FreeGrantError(before.state, REFUSAL[before.state]);
    if (settings.refillMicro <= 0) throw new FreeGrantError("off", "Refills are switched off right now.");
    // Again under the lock: two claims at once from linked accounts mustn't both pass the balance check.
    const block = await refillBlock(tx, user.id, root, now, settings);
    if (block) throw blockError(block, settings);
    const budget = await freeBudget(tx, now, env);
    if (budget.leftMicro < settings.refillMicro) throw new FreeGrantError("budget_full", budgetFullMessage(budget.limit));
    await postLedgerEntry(tx, { userId: user.id, kind: "adjust", amountMicro: settings.refillMicro, idempotencyKey: `refill:${root}:${gdDayKey(now)}`, refType: REFILL_REF, refId: root });
    return { grantedMicro: settings.refillMicro, status: refillStatusGd(await refillTimes(tx, root, now), now, settings) };
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
  /** A refill needs today's G$ UBI claimed first. */
  refillNeedsUbi: boolean;
  /** Why a refill can't be claimed beyond the day/week/month limits: under REFILL_BELOW_CREDITS isn't met, or no recent build. */
  refillBlocked: "not_low" | "inactive" | null;
  refillBelowCredits: number;
  /** Has this person claimed G$ UBI since GoodDollar's day began? Null when not asked or unreadable. */
  ubiClaimedToday: boolean | null;
  /** The welcome waits for a FlowState vote (D125). The card shows the vote step while it's not done. */
  welcomeNeedsVote: boolean;
}

/**
 * Where this account stands, from what's stored. With `readUbiClaimedAt`, one chain read too, only for
 * a verified person who needs it for a refill. A claim reads the chain again before it pays anything.
 */
export async function freeStatus(db: Db, userId: string, now = new Date(), env: Env = process.env, readUbiClaimedAt?: FreeDeps["readUbiClaimedAt"]): Promise<FreeStatus> {
  const settings = freeSettings(env);
  const [user] = await db.select({ verifiedAt: users.verifiedAt, goodidRoot: users.goodidRoot }).from(users).where(eq(users.id, userId)).limit(1);
  const root = user?.verifiedAt ? user.goodidRoot : null;
  const base = {
    policy: freePolicy(env),
    welcomeCredits: settings.welcomeMicro / MICRO_PER_CREDIT,
    refillCredits: settings.refillMicro / MICRO_PER_CREDIT,
    budgetFull: (await freeBudgetLeftMicro(db, now, env)) < Math.min(settings.refillMicro || Infinity, settings.welcomeMicro || Infinity),
    refillNeedsUbi: settings.requiresUbi,
    ubiClaimedToday: null as boolean | null,
    refillBlocked: null as "not_low" | "inactive" | null,
    refillBelowCredits: settings.refillBelowMicro / MICRO_PER_CREDIT,
    welcomeNeedsVote: settings.welcomeNeedsVote,
  };
  if (!root) return { ...base, verified: false, welcomeDone: false, refill: null };
  // Nothing is posted when earlier free AI used the whole welcome, so that counts as done too.
  const welcomeDone = Boolean(await welcomeFor(db, root)) || (await priorFreeMicro(db, userId, root, settings.policyStart)) >= settings.welcomeMicro;
  const refill = refillStatusGd(await refillTimes(db, root, now), now, settings);
  const refillBlocked = refill.state === "available" ? await refillBlock(db, userId, root, now, settings) : null;
  let ubiClaimedToday: boolean | null = null;
  if (settings.requiresUbi && readUbiClaimedAt && refill.state === "available" && !refillBlocked) {
    const at = await readUbiClaimedAt(root as Address).catch(() => undefined);
    ubiClaimedToday = at === undefined ? null : Boolean(at && at >= gdDayStart(now));
  }
  return { ...base, verified: true, welcomeDone, refill, ubiClaimedToday, refillBlocked };
}
