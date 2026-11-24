/**
 * The GoodBuild Hackathon (D99). One hackathon since D170: the FUTMinna (D160) and Kadpoly (D167)
 * hackathons were merged into it, with one leaderboard, closing 31 Dec 2026. Their entries, signups,
 * approvals and rank history moved under this id (migration 0035); their old pages redirect here.
 */
export const HACKATHON = {
  /** Stored in the `hackathon` column of every hackathon table. */
  id: "million-2027",
  name: "GoodBuild Hackathon",
  /** Public page. */
  page: "/hackathon",
  /** The in-app section (Get started, My project, Leaderboard, Vote). */
  app: "/home/hackathon",
  /** Where a shared project vote link opens. */
  votePage: "/hackathon/projects",
  /** Leaderboard places marked as the prize zone. */
  zone: 20,
  zoneLabel: "prize zone",
  /** Entries, approvals and credit claims stop at this moment (end of 31 Dec in WAT). */
  closesAt: "2026-12-31T23:00:00Z",
  /** The closing day in copy. */
  closesLabel: "31 Dec",
} as const;

/** When entries, approvals and credit claims stop. */
export const HACKATHON_CLOSE = new Date(HACKATHON.closesAt);
