import "server-only";

import { and, eq, inArray, ne, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { turnJobs, usageEvents, users, type FundingSource } from "@/server/db/schema";

/**
 * Free AI for accounts that haven't verified with GoodDollar (D28). One account is one wallet, and
 * Magic gives each email one wallet, so this also caps each email. It counts what we charge, so
 * cost plus markup (D13). Checked before a build starts: a build that starts under the cap may
 * finish, because stopping partway would leave the project broken.
 */
export const UNVERIFIED_CAP_MICRO = 200_000;

export const CAP_MESSAGE = "You've used your free $0.20 of AI. Verify with GoodDollar to get $0.50 more.";

/**
 * Total free AI for one verified person: the $0.20 plus $0.50 more (D30). Counted across every
 * account linked to the same GoodDollar identity, so one face can't claim it through several wallets.
 */
export const VERIFIED_CAP_MICRO = 700_000;

export const VERIFIED_CAP_MESSAGE = "You've used all your free AI. Top-ups are coming soon.";

/**
 * Total real provider spend the free trial may reach, across every account (D29). Set below the
 * provider balance, so builds already running can finish before the money runs out. It counts free
 * and exempt spend, all of it since the start (D48), and never paid or platform spend. A top-up of
 * the provider account means raising FREE_AI_BUDGET_MICRO.
 */
export const FREE_BUDGET_MICRO = 4_000_000;

/** Held back for each build in progress, whose cost isn't known yet: about the dearest seen so far. */
export const RESERVED_PER_BUILD_MICRO = 350_000;

export const BUDGET_MESSAGE = "The free trial is full right now. Please check back soon.";

export const FUNDING_UNAVAILABLE_MESSAGE = "This build can't start yet. Please try again later.";

export type CapDecision =
  | { allowed: true }
  | { allowed: false; reason: "free_limit" | "verified_limit" | "one_build_at_a_time" | "budget_full" | "funding_unavailable"; message: string };

/**
 * Which usage uses up what (D48). A person's free allowance (D28, D30) is used only by `free` usage.
 * The free total (D29) protects the provider balance, which exempt usage draws on too, so it counts
 * `free` and `exempt`. Paid usage is the payer's own money, and the platform pays for AI reviews
 * (MAINNET_PLAN decision 3), so neither ever touches free AI.
 */
const PERSONAL_FREE: FundingSource[] = ["free"];
const FREE_TOTAL: FundingSource[] = ["free", "exempt"];

function capMicro(env: Record<string, string | undefined>) {
  return Number(env.UNVERIFIED_CAP_MICRO) || UNVERIFIED_CAP_MICRO;
}

function verifiedCapMicro(env: Record<string, string | undefined>) {
  return Number(env.VERIFIED_CAP_MICRO) || VERIFIED_CAP_MICRO;
}

function budgetMicro(env: Record<string, string | undefined>) {
  const raw = env.FREE_AI_BUDGET_MICRO?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : FREE_BUDGET_MICRO;
}

/** Wallets exempt from the cap, for the people running the service. */
export function isExempt(wallet: string, env: Record<string, string | undefined>) {
  return (env.UNCAPPED_WALLETS ?? "")
    .toLowerCase()
    .split(",")
    .map((w) => w.trim())
    .includes(wallet.toLowerCase());
}

/** The free AI this account has used. Paid, exempt and platform usage don't count (D48). */
export async function spentMicro(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.chargedMicro}), 0)` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), inArray(usageEvents.funding, PERSONAL_FREE)));
  return Number(row?.total ?? 0);
}

/** The free AI this person has used: every account sharing their GoodDollar identity. */
async function identitySpentMicro(db: Db, goodidRoot: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.chargedMicro}), 0)` })
    .from(usageEvents)
    .innerJoin(users, eq(usageEvents.userId, users.id))
    .where(and(eq(users.goodidRoot, goodidRoot), inArray(usageEvents.funding, PERSONAL_FREE)));
  return Number(row?.total ?? 0);
}

/**
 * Is there room left in the total budget? New requests also count queued builds. The worker starts
 * builds one by one, so it counts only the others already running: two queued builds near the limit
 * would otherwise each see the other's reservation and both fail. Only free and exempt spending and
 * builds count (D48).
 */
async function budgetHasRoom(db: Db, startingJobId: string | undefined, env: Record<string, string | undefined>): Promise<boolean> {
  const [spent] = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.providerCostMicro}), 0)` })
    .from(usageEvents)
    .where(inArray(usageEvents.funding, FREE_TOTAL));
  const status = startingJobId ? and(eq(turnJobs.status, "running"), ne(turnJobs.id, startingJobId)) : inArray(turnJobs.status, ["queued", "running"]);
  const [builds] = await db
    .select({ count: sql<string>`count(*)` })
    .from(turnJobs)
    .where(and(status, inArray(turnJobs.funding, FREE_TOTAL)));
  return Number(spent?.total ?? 0) + Number(builds?.count ?? 0) * RESERVED_PER_BUILD_MICRO < budgetMicro(env);
}

/**
 * Who funds a build or AI call this user starts now (D48). Decided once, when a job is created, and
 * kept for the job's life. Exempt wallets are exempt. Everyone else is on free AI, because free comes
 * first (MAINNET_PLAN decision 5) and nothing can debit a paid balance until M3, so a balance unlocks
 * nothing yet: at the free limit a payer is refused exactly as before. M3 adds `paid` here.
 */
export async function decideFunding(db: Db, userId: string, env: Record<string, string | undefined> = process.env): Promise<Extract<FundingSource, "free" | "exempt">> {
  const [user] = await db.select({ wallet: users.wallet }).from(users).where(eq(users.id, userId)).limit(1);
  return user && isExempt(user.wallet, env) ? "exempt" : "free";
}

/**
 * May this user spend more AI? `projectId` is the build they're starting, if any. `startingJobId`
 * is set by the worker for the job it has just claimed, with that job's stored `funding`, which
 * decides over the worker's own settings: a job keeps one source for life.
 */
export async function checkAiAllowance(
  db: Db,
  input: { userId: string; projectId?: string; startingJobId?: string; funding?: FundingSource },
  env: Record<string, string | undefined> = process.env,
): Promise<CapDecision> {
  if (input.funding === "exempt") return { allowed: true };
  // Nothing creates these jobs yet, and nothing could charge for them (M3), so they never run.
  if (input.funding === "paid" || input.funding === "platform") return { allowed: false, reason: "funding_unavailable", message: FUNDING_UNAVAILABLE_MESSAGE };

  const [user] = await db.select({ wallet: users.wallet, verifiedAt: users.verifiedAt, goodidRoot: users.goodidRoot }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user || isExempt(user.wallet, env)) return { allowed: true };

  if (user.verifiedAt) {
    const spent = user.goodidRoot ? await identitySpentMicro(db, user.goodidRoot) : await spentMicro(db, input.userId);
    if (spent >= verifiedCapMicro(env)) return { allowed: false, reason: "verified_limit", message: VERIFIED_CAP_MESSAGE };
  } else if ((await spentMicro(db, input.userId)) >= capMicro(env)) {
    return { allowed: false, reason: "free_limit", message: CAP_MESSAGE };
  }

  // Verified accounts are on free credit too, so the total applies to them as well.
  if (!(await budgetHasRoom(db, input.startingJobId, env))) return { allowed: false, reason: "budget_full", message: BUDGET_MESSAGE };

  // Otherwise builds running at once on several projects could each pass the check and overrun it.
  if (input.projectId) {
    const [other] = await db
      .select({ id: turnJobs.id })
      .from(turnJobs)
      .where(and(eq(turnJobs.userId, input.userId), ne(turnJobs.projectId, input.projectId), inArray(turnJobs.status, ["queued", "running"])))
      .limit(1);
    if (other) return { allowed: false, reason: "one_build_at_a_time", message: "You have a build running on another project. Wait for it to finish, then try again." };
  }
  return { allowed: true };
}

/**
 * Room needed to plan before building (D32). It's more than a plan can cost at worst (see
 * plan-first.test.ts), so a plan can never be what puts someone over the cap with nothing built.
 * Below it they go straight to a build, which D28 lets finish.
 */
export const PLAN_HEADROOM_MICRO = 10_000;

/** Is there room to plan and still start the build afterwards? Only the per-person caps matter here. */
export async function hasPlanHeadroom(db: Db, userId: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const [user] = await db.select({ wallet: users.wallet, verifiedAt: users.verifiedAt, goodidRoot: users.goodidRoot }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || isExempt(user.wallet, env)) return true;
  const spent = user.verifiedAt && user.goodidRoot ? await identitySpentMicro(db, user.goodidRoot) : await spentMicro(db, userId);
  return spent + PLAN_HEADROOM_MICRO < (user.verifiedAt ? verifiedCapMicro(env) : capMicro(env));
}

/** Should the workspace ask this account to verify? Only when that would actually unlock more AI. */
export async function shouldOfferVerification(db: Db, userId: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const [user] = await db.select({ wallet: users.wallet, verifiedAt: users.verifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.verifiedAt || isExempt(user.wallet, env)) return false;
  if ((await spentMicro(db, userId)) < capMicro(env)) return false;
  return budgetHasRoom(db, undefined, env);
}
