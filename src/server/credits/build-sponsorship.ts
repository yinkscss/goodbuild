import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { buildSponsorships, turnJobs } from "@/server/db/schema";

export const SPONSORSHIP_EXHAUSTED_MESSAGE = "The included build allowance is used up. Your progress is saved. Choose a smaller next step or continue using credits.";
export class SponsorshipExhaustedError extends Error {
  constructor() { super(SPONSORSHIP_EXHAUSTED_MESSAGE); }
}
const amount = (raw: string | undefined, fallback: number) => raw !== undefined && Number.isSafeInteger(Number(raw)) && Number(raw) >= 0 ? Number(raw) : fallback;
export function sponsorshipSettings(env: Record<string, string | undefined>) {
  return { first: amount(env.FIRST_DELIVERY_MICRO, 1_000_000), repair: amount(env.BUILD_REPAIR_MICRO, 300_000), monthly: amount(env.BUILD_SPONSOR_BUDGET_MICRO, 50_000_000) };
}

/** Call inside the queue transaction, before any credit balance locks. A single budget lock prevents oversubscription. */
export async function reserveSponsorship(db: Db, key: string, limit: number, env: Record<string, string | undefined>): Promise<boolean> {
  if (!limit) return false;
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('build-sponsorship'))`);
  const [existing] = await db.select().from(buildSponsorships).where(eq(buildSponsorships.allowanceKey, key));
  if (existing) return false;
  // One statement gives a consistent snapshot of incurred usage + remaining reservations,
  // including jobs reserved in a prior month that are still running.
  const result = await db.execute(sql`select
    coalesce((select sum(charged_micro) from usage_events where funding = 'platform' and created_at >= date_trunc('month', now())), 0)
    + coalesce((select sum(greatest(0, s.limit_micro - s.spent_micro)) from build_sponsorships s join turn_jobs j on j.id = s.job_id where j.status in ('queued', 'running')), 0) as micro`);
  const [total] = (Array.isArray(result) ? result : (result as unknown as { rows: { micro: string }[] }).rows) as { micro: string }[];
  return Number(total.micro) + limit <= sponsorshipSettings(env).monthly;
}

export async function sponsorshipCanCall(db: Db, jobId: string, worst: number): Promise<boolean> {
  const [s] = await db.select().from(buildSponsorships).where(eq(buildSponsorships.jobId, jobId)).for("update");
  return Boolean(s && s.spentMicro + worst <= s.limitMicro);
}

export async function recordSponsoredUsage(db: Db, jobId: string, micro: number, insert: (tx: Db) => Promise<boolean>): Promise<boolean> {
  // The runner's lease transaction already locks the job; keep job -> sponsorship lock order.
  const [s] = await db.select().from(buildSponsorships).where(eq(buildSponsorships.jobId, jobId)).for("update");
  if (!s) throw new Error("Missing build sponsorship");
  if (!(await insert(db))) return false;
  // Never discard an incurred provider bill, even if its reported model/cost exceeded the estimate.
  await db.update(buildSponsorships).set({ spentMicro: sql`${buildSponsorships.spentMicro} + ${micro}` }).where(eq(buildSponsorships.jobId, jobId));
  return true;
}

export async function platformJobAllowed(db: Db, jobId: string): Promise<boolean> {
  const [s] = await db.select({ id: buildSponsorships.jobId }).from(buildSponsorships).innerJoin(turnJobs, eq(turnJobs.id, buildSponsorships.jobId))
    .where(and(eq(buildSponsorships.jobId, jobId), inArray(turnJobs.status, ["queued", "running"])));
  return Boolean(s);
}

/**
 * Give back a sponsorship that paid for nothing, so its allowance key can be reserved again. Used when a build
 * failed because GoodBuild's own AI account was empty (23 Nov 2026): the person shouldn't lose a free build to it.
 */
export async function releaseUnusedSponsorship(db: Db, jobId: string): Promise<boolean> {
  const rows = await db.delete(buildSponsorships).where(and(eq(buildSponsorships.jobId, jobId), eq(buildSponsorships.spentMicro, 0))).returning({ id: buildSponsorships.jobId });
  return rows.length > 0;
}
