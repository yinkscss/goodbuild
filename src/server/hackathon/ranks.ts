import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { hackathonRankSnapshots } from "@/server/db/hackathon-schema";
import { allocateHackathonRewards } from "@/lib/hackathon-rewards";
import { CLAIMS_CLOSE, HACKATHON_ID } from "./claim";
import { listEntries } from "./community";

/** The West Africa Time date (UTC+1, no daylight saving) as YYYY-MM-DD. */
export function watDay(now: Date): string {
  return new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
}

/**
 * Record today's rank for every published project, once per WAT day (D134). The first run of the day
 * wins; later runs change nothing, so the worker can call it every hour. Snapshots continue through
 * the first day after the close, which records the final ranking, then stop.
 */
export async function snapshotRanks(db: Db, now = new Date()): Promise<{ day: string; written: number }> {
  const day = watDay(now);
  if (day > watDay(CLAIMS_CLOSE)) return { day, written: 0 };
  const ranked = allocateHackathonRewards(await listEntries(db)).filter(
    (e): e is typeof e & { rank: number } => e.rank !== null,
  );
  if (ranked.length === 0) return { day, written: 0 };
  const rows = await db
    .insert(hackathonRankSnapshots)
    .values(ranked.map((e) => ({ hackathon: HACKATHON_ID, day, entryId: e.id, rank: e.rank, approvals: e.approvals })))
    .onConflictDoNothing()
    .returning({ id: hackathonRankSnapshots.id });
  return { day, written: rows.length };
}

/** Each project's rank in the latest snapshot from a day before today, or nothing if there is none yet. */
export async function previousRanks(db: Db, now = new Date()): Promise<Map<string, number>> {
  const today = watDay(now);
  const [latest] = await db
    .select({ day: hackathonRankSnapshots.day })
    .from(hackathonRankSnapshots)
    .where(and(eq(hackathonRankSnapshots.hackathon, HACKATHON_ID), lt(hackathonRankSnapshots.day, today)))
    .orderBy(desc(hackathonRankSnapshots.day))
    .limit(1);
  if (!latest) return new Map();
  const rows = await db
    .select({ entryId: hackathonRankSnapshots.entryId, rank: hackathonRankSnapshots.rank })
    .from(hackathonRankSnapshots)
    .where(and(eq(hackathonRankSnapshots.hackathon, HACKATHON_ID), eq(hackathonRankSnapshots.day, latest.day)));
  return new Map(rows.map((r) => [r.entryId, r.rank]));
}

/** The public entry list with each project's previous-day rank (`prevRank`), for the arrows. */
export async function withRankMoves<T extends { id: string }>(db: Db, entries: T[], now = new Date()) {
  const before = await previousRanks(db, now);
  return entries.map((e) => ({ ...e, prevRank: before.get(e.id) ?? null }));
}

/** The worker's hourly call: today's snapshot if it isn't there yet. */
export async function sweepRankSnapshot(getDb: () => Promise<Db>, now = new Date()) {
  const result = await snapshotRanks(await getDb(), now);
  if (result.written) console.log(`[worker] hackathon rank snapshot ${result.day}: ${result.written} projects`);
  return result;
}

