/**
 * Weekly Rising Star (D135): the published project with the most new approvals in each of three weeks
 * gets a badge. No money, so a project far down the ladder can still win it.
 *
 * A snapshot dated D is taken at about midnight West Africa time as D begins, so it holds the counts
 * at the end of D-1. A week that ends on day E is therefore read from the snapshot dated E+1.
 */
export const WEEKS = [
  { n: 1, label: "18 to 25 Nov", boundary: "2026-11-26" },
  { n: 2, label: "26 Nov to 2 Dec", boundary: "2026-12-03" },
  { n: 3, label: "3 to 10 Dec", boundary: "2026-12-11" },
] as const;

/** Kadpoly runs to 31 Dec (D166), so it gets three more weeks after the main three. */
export const LATE_WEEKS = [
  { n: 4, label: "11 to 17 Dec", boundary: "2026-12-18" },
  { n: 5, label: "18 to 24 Dec", boundary: "2026-12-25" },
  { n: 6, label: "25 to 31 Dec", boundary: "2027-01-01" },
] as const;

export type Week = { n: number; label: string; boundary: string };

/**
 * The Rising Star weeks of a hackathon that closes at `close`: every week whose end snapshot is taken
 * by the day after the close (WAT). Main and FUTMinna get weeks 1 to 3, Kadpoly 1 to 6.
 */
export function weeksUntil(close: Date): Week[] {
  const lastDay = new Date(close.getTime() + 3_600_000).toISOString().slice(0, 10);
  return [...WEEKS, ...LATE_WEEKS].filter((w) => w.boundary <= lastDay);
}

export interface Snapshot {
  day: string;
  entryId: string;
  approvals: number;
}
export interface RisingStar {
  week: number;
  entryId: string;
  /** New approvals during the week. */
  gained: number;
}

/**
 * The winner of every week that has finished, as far as the snapshots show. `order` lists entry ids by
 * submission time: it breaks ties (earlier submission wins, as in the ranking). A week with no new
 * approvals has no winner. A week whose end snapshot, or the previous week's, is missing is skipped
 * rather than guessed.
 */
export function risingStars(snapshots: Snapshot[], order: string[], weeks: readonly Week[] = WEEKS): RisingStar[] {
  const byDay = new Map<string, Map<string, number>>();
  for (const s of snapshots) {
    const day = byDay.get(s.day) ?? new Map<string, number>();
    day.set(s.entryId, s.approvals);
    byDay.set(s.day, day);
  }
  const days = [...byDay.keys()].sort();
  const firstOnOrAfter = (boundary: string) => days.find((d) => d >= boundary);
  const rank = new Map(order.map((id, i) => [id, i]));
  const result: RisingStar[] = [];
  let previous: Map<string, number> | null = new Map(); // before the first week everything is 0
  for (const week of weeks) {
    const endDay = firstOnOrAfter(week.boundary);
    const end = endDay ? byDay.get(endDay) : undefined;
    if (!end || !previous) {
      previous = null;
      continue;
    }
    let best: RisingStar | null = null;
    for (const [entryId, approvals] of end) {
      if (!rank.has(entryId)) continue;
      const gained = approvals - (previous.get(entryId) ?? 0);
      if (gained <= 0) continue;
      if (!best || gained > best.gained || (gained === best.gained && rank.get(entryId)! < rank.get(best.entryId)!)) {
        best = { week: week.n, entryId, gained };
      }
    }
    if (best) result.push(best);
    previous = end;
  }
  return result;
}
