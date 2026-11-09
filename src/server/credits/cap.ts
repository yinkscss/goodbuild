import "server-only";

import { and, eq, inArray, ne, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { turnJobs, usageEvents, users, type FundingSource } from "@/server/db/schema";
import { CREDIT_HELD_MESSAGE, OUT_OF_CREDITS_MESSAGE, PAID_MIN_DIRECT_MICRO, hasPaid, holdMicro, lockBalance, minStartMicro, readBalance } from "./holds";

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

export const VERIFIED_CAP_MESSAGE = "You've used all your free AI. Add credits with G$ to keep building.";

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

/** A free job's free AI ran out while it waited, and they have credit. A job keeps one source (D48). */
export const FREE_RAN_OUT_MESSAGE = "Your free AI ran out before this build started. Retry to run it on your credits.";

export type CapRefusal = {
  allowed: false;
  reason: "free_limit" | "verified_limit" | "one_build_at_a_time" | "budget_full" | "funding_unavailable" | "out_of_credits" | "credit_held";
  message: string;
};

export type CapDecision = { allowed: true } | CapRefusal;

/** A build may start, on this funding, with this much of the balance set aside for it (D49). */
export type StartDecision = { allowed: true; funding: Extract<FundingSource, "free" | "exempt" | "paid">; holdMicro: number } | CapRefusal;

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
 * What is left of this person's free AI allowance (D28, D30), in micro-USD, for showing next to their
 * paid balance. `null` means unlimited (an exempt wallet). It never goes below zero.
 */
export async function freeRemainingMicro(db: Db, userId: string, env: Record<string, string | undefined> = process.env): Promise<number | null> {
  const [user] = await db.select({ wallet: users.wallet, verifiedAt: users.verifiedAt, goodidRoot: users.goodidRoot }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || isExempt(user.wallet, env)) return null;
  if (user.verifiedAt) {
    const spent = user.goodidRoot ? await identitySpentMicro(db, user.goodidRoot) : await spentMicro(db, userId);
    return Math.max(verifiedCapMicro(env) - spent, 0);
  }
  return Math.max(capMicro(env) - (await spentMicro(db, userId)), 0);
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
 * Free-or-exempt funding, for jobs queued without the start check (tests, scripts) and direct runs,
 * neither of which sets anything aside, so neither may spend credit. The turns route uses `startTurn`,
 * and calls outside a turn `decideDirectFunding`.
 */
export async function decideFunding(db: Db, userId: string, env: Record<string, string | undefined> = process.env): Promise<Extract<FundingSource, "free" | "exempt">> {
  const [user] = await db.select({ wallet: users.wallet }).from(users).where(eq(users.id, userId)).limit(1);
  return user && isExempt(user.wallet, env) ? "exempt" : "free";
}

/** May this user spend free AI now? The free limits only: credit doesn't come into it. */
async function freeAllowance(db: Db, input: { userId: string; projectId?: string; startingJobId?: string }, env: Record<string, string | undefined>): Promise<CapDecision> {
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
 * What to tell someone who can't use free AI and hasn't enough free credit. Whoever has bought credit
 * hears about credit, never about free limits (plan section 5 item 4). Everyone else, which today is
 * everyone, gets the free-limit message they get now.
 */
async function creditRefusal(db: Db, userId: string, free: CapRefusal, balance: { balanceMicro: number }, needMicro: number): Promise<CapRefusal> {
  if (!(await hasPaid(db, userId))) return free;
  return balance.balanceMicro >= needMicro ? { allowed: false, reason: "credit_held", message: CREDIT_HELD_MESSAGE } : { allowed: false, reason: "out_of_credits", message: OUT_OF_CREDITS_MESSAGE };
}

/**
 * Who funds the build this user wants to start, and what's set aside for it (MAINNET_PLAN section 5
 * item 3, D49): exempt goes ahead, free comes first, then credit if enough of it is free. Run in the
 * transaction that queues the job: this takes the user's balance lock and holds it until the job is
 * in, so builds started at the same moment see each other's jobs and holds, for free builds too.
 */
export async function decideStart(tx: Db, input: { userId: string; projectId: string }, env: Record<string, string | undefined> = process.env): Promise<StartDecision> {
  const balance = await lockBalance(tx, input.userId);
  const free = await freeAllowance(tx, input, env);
  if (free.allowed) return { allowed: true, funding: await decideFunding(tx, input.userId, env), holdMicro: 0 };
  if (free.reason === "one_build_at_a_time") return free;
  if (balance.availableMicro >= minStartMicro(env)) return { allowed: true, funding: "paid", holdMicro: Math.min(holdMicro(env), balance.availableMicro) };
  return creditRefusal(tx, input.userId, free, balance, minStartMicro(env));
}

/**
 * Who funds an AI call outside a build: an upload or a visual check, decided when it runs (D48). Free
 * first, then credit. There's no job to hold anything against, so it needs only enough free credit
 * for one such call, and simultaneous ones can take a balance slightly below zero, which plan section
 * 5 item 6 writes off. Someone with no free credit stays on `free`, the route having checked already.
 */
export async function decideDirectFunding(db: Db, userId: string, env: Record<string, string | undefined> = process.env): Promise<Extract<FundingSource, "free" | "exempt" | "paid">> {
  const funding = await decideFunding(db, userId, env);
  if (funding === "exempt") return funding;
  if ((await readBalance(db, userId)).availableMicro < PAID_MIN_DIRECT_MICRO) return "free";
  return (await freeAllowance(db, { userId }, env)).allowed ? "free" : "paid";
}

/**
 * May this user spend more AI? Used for calls outside a build, with neither job field, and by the
 * worker for the job it has just claimed, with that job's stored `funding`, which decides over the
 * worker's own settings: a job keeps one source for life. A paid job always passes here, since its
 * hold was taken when it was queued and every call is checked against it as it runs. Queueing a build
 * goes through `decideStart`, which also does this under the balance lock.
 */
export async function checkAiAllowance(
  db: Db,
  input: { userId: string; projectId?: string; startingJobId?: string; funding?: FundingSource },
  env: Record<string, string | undefined> = process.env,
): Promise<CapDecision> {
  if (input.funding === "exempt" || input.funding === "paid") return { allowed: true };
  // Nothing creates these jobs yet: the AI review, when it's built, decides how they run.
  if (input.funding === "platform") return { allowed: false, reason: "funding_unavailable", message: FUNDING_UNAVAILABLE_MESSAGE };

  const free = await freeAllowance(db, input, env);
  if (free.allowed || free.reason === "one_build_at_a_time") return free;
  const balance = await readBalance(db, input.userId);
  const need = input.startingJobId || input.projectId ? minStartMicro(env) : PAID_MIN_DIRECT_MICRO;
  // A free job can't turn into a paid one, so someone with credit is told to send it again.
  if (input.funding === "free") return balance.availableMicro >= need || (await hasPaid(db, input.userId)) ? { ...free, message: FREE_RAN_OUT_MESSAGE } : free;
  return balance.availableMicro >= need ? { allowed: true } : creditRefusal(db, input.userId, free, balance, need);
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
  // Whoever has bought credit hears about credit, never about free limits (plan section 5 item 4).
  if (await hasPaid(db, userId)) return false;
  return budgetHasRoom(db, undefined, env);
}
