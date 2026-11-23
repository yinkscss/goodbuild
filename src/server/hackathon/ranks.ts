import "server-only";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { hackathonEntries, hackathonRankSnapshots } from "@/server/db/hackathon-schema";
import { allocateHackathonRewards } from "@/lib/hackathon-rewards";
import { risingStars, weeksUntil, type RisingStar } from "@/lib/hackathon-weeks";
import { closeOf, EVENTS, eventId, type HackathonEvent } from "@/lib/hackathon-events";
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
export async function snapshotRanks(db: Db, now = new Date(), event: HackathonEvent = "main"): Promise<{ day: string; written: number }> {
  const day = watDay(now);
  if (day > watDay(closeOf(event))) return { day, written: 0 };
  const ranked = allocateHackathonRewards(await listEntries(db, event)).filter(
    (e): e is typeof e & { rank: number } => e.rank !== null,
  );
  if (ranked.length === 0) return { day, written: 0 };
  const rows = await db
    .insert(hackathonRankSnapshots)
    .values(ranked.map((e) => ({ hackathon: eventId(event), day, entryId: e.id, rank: e.rank, approvals: e.approvals })))
    .onConflictDoNothing()
    .returning({ id: hackathonRankSnapshots.id });
  return { day, written: rows.length };
}

/** Each project's rank in the latest snapshot from a day before today, or nothing if there is none yet. */
export async function previousRanks(db: Db, now = new Date(), event: HackathonEvent = "main"): Promise<Map<string, number>> {
  const today = watDay(now);
  const [latest] = await db
    .select({ day: hackathonRankSnapshots.day })
    .from(hackathonRankSnapshots)
    .where(and(eq(hackathonRankSnapshots.hackathon, eventId(event)), lt(hackathonRankSnapshots.day, today)))
    .orderBy(desc(hackathonRankSnapshots.day))
    .limit(1);
  if (!latest) return new Map();
  const rows = await db
    .select({ entryId: hackathonRankSnapshots.entryId, rank: hackathonRankSnapshots.rank })
    .from(hackathonRankSnapshots)
    .where(and(eq(hackathonRankSnapshots.hackathon, eventId(event)), eq(hackathonRankSnapshots.day, latest.day)));
  return new Map(rows.map((r) => [r.entryId, r.rank]));
}

/** Weekly Rising Star winners (D135), worked out from the daily snapshots. */
export async function weeklyStars(db: Db, event: HackathonEvent = "main"): Promise<RisingStar[]> {
  const snapshots = await db
    .select({ day: hackathonRankSnapshots.day, entryId: hackathonRankSnapshots.entryId, approvals: hackathonRankSnapshots.approvals })
    .from(hackathonRankSnapshots)
    .where(eq(hackathonRankSnapshots.hackathon, eventId(event)));
  if (snapshots.length === 0) return [];
  const order = await db
    .select({ id: hackathonEntries.id })
    .from(hackathonEntries)
    .where(eq(hackathonEntries.hackathon, eventId(event)))
    .orderBy(asc(hackathonEntries.createdAt), asc(hackathonEntries.id));
  return risingStars(snapshots, order.map((o) => o.id), weeksUntil(closeOf(event)));
}

/**
 * The public entry list with each project's previous-day rank (`prevRank`, for the arrows, D134) and
 * the weeks it won Rising Star (`stars`, D135).
 */
export async function withRankMoves<T extends { id: string }>(db: Db, entries: T[], now = new Date(), event: HackathonEvent = "main") {
  const [before, stars] = await Promise.all([previousRanks(db, now, event), weeklyStars(db, event)]);
  return entries.map((e) => ({
    ...e,
    prevRank: before.get(e.id) ?? null,
    stars: stars.filter((s) => s.entryId === e.id).map((s) => s.week),
  }));
}

/** The worker's hourly call: today's snapshot for every hackathon (D160) if it isn't there yet. */
export async function sweepRankSnapshot(getDb: () => Promise<Db>, now = new Date()) {
  const db = await getDb();
  let main = { day: "", written: 0 };
  for (const event of EVENTS) {
    const result = await snapshotRanks(db, now, event);
    if (result.written) console.log(`[worker] hackathon rank snapshot ${event} ${result.day}: ${result.written} projects`);
    if (event === "main") main = result;
  }
  return main;
}

