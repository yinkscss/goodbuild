import { allocateHackathonRewards, REWARD_SLOTS } from "./hackathon-rewards";

export type League = "Gold" | "Silver" | "Bronze";

/** Leagues are decided by approvals only: 100+, 40+, 10+. They carry a badge, never money. */
export function leagueFor(approvals: number): League | null {
  if (approvals >= 100) return "Gold";
  if (approvals >= 40) return "Silver";
  if (approvals >= 10) return "Bronze";
  return null;
}

type Entry = { id: string; liveUrl: string; approvals: number };

export interface LadderRow<T extends Entry> {
  entry: T & { rank: number; baseGd: number; topupGd: number; totalGd: number };
  league: League | null;
  inPrizeZone: boolean;
}

export interface Ladder<T extends Entry> {
  /** Published projects, best first. Ideas without a live app are not ranked. */
  rows: Array<LadderRow<T>>;
  /** The caller's own row, if they have a published project. */
  mine: LadderRow<T> | null;
  /** More approvals the caller needs to reach the prize zone (0 when already in it). */
  gapToPrizeZone: number | null;
}

/** Build the ranked ladder from the public entry list; `myId` marks the viewer's own project. */
export function buildLadder<T extends Entry>(entries: T[], myId?: string | null): Ladder<T> {
  const rows = allocateHackathonRewards(entries)
    .filter((e): e is typeof e & { rank: number } => e.rank !== null)
    .map((entry) => ({
      entry,
      league: leagueFor(entry.approvals),
      inPrizeZone: entry.rank <= REWARD_SLOTS,
    }));
  const mine = myId ? (rows.find((r) => r.entry.id === myId) ?? null) : null;
  let gap: number | null = null;
  if (mine) {
    if (mine.inPrizeZone) gap = 0;
    else {
      // Smallest k so that k more approvals put this project in the top 20, ties included.
      for (let k = 1; k <= 100_000; k++) {
        const test = allocateHackathonRewards(
          entries.map((e) => (e.id === myId ? { ...e, approvals: e.approvals + k } : e)),
        ).find((e) => e.id === myId);
        if (test && test.rank !== null && test.rank <= REWARD_SLOTS) {
          gap = k;
          break;
        }
      }
    }
  }
  return { rows, mine, gapToPrizeZone: gap };
}
