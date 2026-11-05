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

export type CapDecision = { allowed: true } | { allowed: false; reason: "free_limit" | "one_build_at_a_time"; message: string };

function capMicro(env: Record<string, string | undefined>) {
  return Number(env.UNVERIFIED_CAP_MICRO) || UNVERIFIED_CAP_MICRO;
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

/** May this user spend more AI? `projectId` is the build they're starting, if any. */
export async function checkAiAllowance(
  db: Db,
  input: { userId: string; projectId?: string },
  env: Record<string, string | undefined> = process.env,
): Promise<CapDecision> {
  const [user] = await db.select({ wallet: users.wallet, verifiedAt: users.verifiedAt }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user || user.verifiedAt || isExempt(user.wallet, env)) return { allowed: true };

  if ((await spentMicro(db, input.userId)) >= capMicro(env)) return { allowed: false, reason: "free_limit", message: CAP_MESSAGE };

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
