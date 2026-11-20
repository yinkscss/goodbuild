/**
 * The hackathons GoodBuild runs side by side (D160). Each one has its own entries, approvals,
 * leaderboard and signup list, all stored under its id in the existing hackathon tables. Credits are
 * not per event: every hackathon page uses the main hackathon's claim, so one GoodDollar identity
 * gets one grant whichever page it registers on.
 */
export const HACKATHON_EVENTS = {
  main: {
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
    /** Whether the leaderboard shows G$ estimates (D130's reward pool). */
    showsGd: true,
  },
  futminna: {
    id: "futminna-2026",
    name: "FUTMinna Hackathon",
    page: "/hackathon/futminna",
    app: "/home/hackathon/futminna",
    votePage: "/hackathon/futminna",
    zone: 5,
    zoneLabel: "shortlist",
    showsGd: false,
  },
} as const;

export type HackathonEvent = keyof typeof HACKATHON_EVENTS;
export const EVENTS = Object.keys(HACKATHON_EVENTS) as HackathonEvent[];

/** Anything that isn't a known event name means the main hackathon. */
export function parseEvent(value: unknown): HackathonEvent {
  return value === "futminna" ? "futminna" : "main";
}

export function eventId(event: HackathonEvent): string {
  return HACKATHON_EVENTS[event].id;
}

/** The event a page belongs to, from its path: everything under a `/futminna` segment is FUTMinna. */
export function eventFromPath(path: string | null | undefined): HackathonEvent {
  return /\/futminna(\/|$)/.test(path ?? "") ? "futminna" : "main";
}

/** An /api/hackathon URL for this event. The main hackathon keeps its plain URLs. */
export function eventApi(path: string, event: HackathonEvent): string {
  if (event === "main") return path;
  return `${path}${path.includes("?") ? "&" : "?"}event=${event}`;
}

/** FUTMinna prize copy (D160). Judges pick the winner from the top 5 by approvals. */
export const FUTMINNA = {
  scholarshipNaira: 150_000,
  shortlist: 5,
  judges: "GoodBuild and GoodCash judges",
} as const;
