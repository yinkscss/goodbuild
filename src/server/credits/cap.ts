import "server-only";

import { and, eq, inArray, ne, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { turnJobs, usageEvents, users } from "@/server/db/schema";

/**
 * Free AI for accounts that haven't verified with GoodDollar (D28). One account is one wallet, and
 * Magic gives each email one wallet, so this also caps each email. It counts what we charge, so
 * cost plus markup (D13). Checked before a build starts: a build that starts under the cap may
 * finish, because stopping partway would leave the project broken.
 */
export const UNVERIFIED_CAP_MICRO = 200_000;

export const CAP_MESSAGE = "You've used your free $0.20 of AI. Verifying your account with GoodDollar will unlock more; that's coming soon.";

/**
 * Total real provider spend the free trial may reach, across every account (D29). Set below the
 * provider balance, so builds already running can finish before the money runs out. A top-up means
 * raising FREE_AI_BUDGET_MICRO, because this counts all recorded spend.
 */
export const FREE_BUDGET_MICRO = 4_000_000;

/** Held back for each build in progress, whose cost isn't known yet: about the dearest seen so far. */
export const RESERVED_PER_BUILD_MICRO = 350_000;

export const BUDGET_MESSAGE = "The free trial is full right now. Please check back soon.";

export type CapDecision = { allowed: true } | { allowed: false; reason: "free_limit" | "one_build_at_a_time" | "budget_full"; message: string };

function capMicro(env: Record<string, string | undefined>) {
  return Number(env.UNVERIFIED_CAP_MICRO) || UNVERIFIED_CAP_MICRO;
}

function budgetMicro(env: Record<string, string | undefined>) {
  const raw = env.FREE_AI_BUDGET_MICRO?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : FREE_BUDGET_MICRO;
}

/** Wallets exempt from the cap, for the people running the service. */
function isExempt(wallet: string, env: Record<string, string | undefined>) {
  return (env.UNCAPPED_WALLETS ?? "")
    .toLowerCase()
    .split(",")
    .map((w) => w.trim())
    .includes(wallet.toLowerCase());
}

export async function spentMicro(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.chargedMicro}), 0)` })
    .from(usageEvents)
    .where(eq(usageEvents.userId, userId));
  return Number(row?.total ?? 0);
}

/**
 * Is there room left in the total budget? New requests also count queued builds. The worker starts
 * builds one by one, so it counts only the others already running: two queued builds near the limit
 * would otherwise each see the other's reservation and both fail.
 */
async function budgetHasRoom(db: Db, startingJobId: string | undefined, env: Record<string, string | undefined>): Promise<boolean> {
  const [spent] = await db.select({ total: sql<string>`coalesce(sum(${usageEvents.providerCostMicro}), 0)` }).from(usageEvents);
  const active = startingJobId ? and(eq(turnJobs.status, "running"), ne(turnJobs.id, startingJobId)) : inArray(turnJobs.status, ["queued", "running"]);
  const [builds] = await db.select({ count: sql<string>`count(*)` }).from(turnJobs).where(active);
  return Number(spent?.total ?? 0) + Number(builds?.count ?? 0) * RESERVED_PER_BUILD_MICRO < budgetMicro(env);
}

/**
 * May this user spend more AI? `projectId` is the build they're starting, if any. `startingJobId`
 * is set by the worker for the job it has just claimed.
 */
export async function checkAiAllowance(
  db: Db,
  input: { userId: string; projectId?: string; startingJobId?: string },
  env: Record<string, string | undefined> = process.env,
): Promise<CapDecision> {
  const [user] = await db.select({ wallet: users.wallet, verifiedAt: users.verifiedAt }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user || isExempt(user.wallet, env)) return { allowed: true };

  if (!user.verifiedAt && (await spentMicro(db, input.userId)) >= capMicro(env)) return { allowed: false, reason: "free_limit", message: CAP_MESSAGE };

  // Verified accounts are on free credit too, so the total applies to them as well.
  if (!(await budgetHasRoom(db, input.startingJobId, env))) return { allowed: false, reason: "budget_full", message: BUDGET_MESSAGE };
  if (user.verifiedAt) return { allowed: true };

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
