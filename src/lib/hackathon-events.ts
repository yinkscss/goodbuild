/**
 * The hackathons GoodBuild runs side by side (D160, D167). Each one has its own entries, approvals,
 * leaderboard, signup list and closing time, all stored under its id in the existing hackathon tables.
 * Credits are not per event: every hackathon page uses the main hackathon's claim, so one GoodDollar
 * identity gets one grant whichever page it registers on.
 */

/** A campus hackathon's school and prize (D160 FUTMinna, D167 Kadpoly). Page copy is built from it. */
export interface Campus {
  /** Short school name used in copy ("FUTMinna student?"). */
  short: string;
  /** Brand tag in the page header. */
  tag: string;
  school: string;
  /** The prize as a headline: "₦150,000" or "Full tuition". */
  prizeHeadline: string;
  /** The prize in a sentence: "a ₦150,000 scholarship". */
  prize: string;
  /** Under the headline on the prize card. */
  prizeNote: string;
  /** The prize section's first sentence. */
  prizeLine: string;
  /** The poster's last line: "Win a scholarship." */
  posterWin: string;
  /** For the page title: "₦150,000 scholarship". */
  prizeTitle: string;
  /** How many win. */
  winners: number;
  /**
   * Judged: judges pick the winners from the top `zone` (FUTMinna's shortlist). Not judged: the top
   * `winners` by approvals win and the rest of the zone is a waitlist (Kadpoly).
   */
  judged: boolean;
  judges: string;
  /** When it runs, for the poster tag: "ends 10 Dec". */
  dates: string;
}

interface EventConfig {
  id: string;
  name: string;
  /** Public page. */
  page: string;
  /** The in-app section (Get started, My project, Leaderboard, Vote). */
  app: string;
  /** Where a shared project vote link opens. */
  votePage: string;
  /** Leaderboard places marked as the prize zone (or shortlist, or winners plus waitlist). */
  zone: number;
  zoneLabel: string;
  /** Whether the leaderboard shows G$ estimates (D130's reward pool). */
  showsGd: boolean;
  /** Name on the hackathon switch. */
  label: string;
  /** Entries and approvals stop at this moment (end of the day in WAT). */
  closesAt: string;
  /** The closing day in copy: "10 Dec". */
  closesLabel: string;
  campus: Campus | null;
}

const JUDGES = "GoodBuild and GoodCash judges";

export const HACKATHON_EVENTS = {
  main: {
    id: "million-2027",
    name: "GoodBuild Hackathon",
    page: "/hackathon",
    app: "/home/hackathon",
    votePage: "/hackathon/projects",
    zone: 20,
    zoneLabel: "prize zone",
    showsGd: true,
    label: "Main hackathon",
    closesAt: "2026-12-10T23:00:00Z",
    closesLabel: "10 Dec",
    campus: null,
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
    label: "FUTMinna",
    closesAt: "2026-12-10T23:00:00Z",
    closesLabel: "10 Dec",
    campus: {
      short: "FUTMinna",
      tag: "FUTMINNA",
      school: "Federal University of Technology Minna",
      prizeHeadline: "₦150,000",
      prize: "a ₦150,000 scholarship",
      prizeNote: "Awarded to the best app or game.",
      prizeLine: "One ₦150,000 scholarship for the best GoodDollar app or game.",
      posterWin: "Win a scholarship.",
      prizeTitle: "₦150,000 scholarship",
      winners: 1,
      judged: true,
      judges: JUDGES,
      dates: "ends 10 Dec",
    },
  },
  /** Kaduna Polytechnic (D167): FUTMinna's rules and voting; top 3 win full tuition, 4 and 5 waitlisted, closes 31 Dec. */
  kadpoly: {
    id: "kadpoly-2026",
    name: "Kadpoly Hackathon",
    page: "/hackathon/kadpoly",
    app: "/home/hackathon/kadpoly",
    votePage: "/hackathon/kadpoly",
    zone: 5,
    zoneLabel: "top 5",
    showsGd: false,
    label: "Kadpoly",
    closesAt: "2026-12-31T23:00:00Z",
    closesLabel: "31 Dec",
    campus: {
      short: "Kadpoly",
      tag: "KADPOLY",
      school: "Kaduna Polytechnic",
      prizeHeadline: "Full tuition",
      prize: "full tuition for the session",
      prizeNote: "For each of the top 3 apps or games. The next 2 are waitlisted.",
      prizeLine: "Full tuition for the session for each of the top 3 GoodDollar apps or games.",
      posterWin: "Win full tuition.",
      prizeTitle: "Full tuition scholarships",
      winners: 3,
      judged: false,
      judges: JUDGES,
      dates: "23 Nov to 31 Dec",
    },
  },
} as const satisfies Record<string, EventConfig>;

export type HackathonEvent = keyof typeof HACKATHON_EVENTS;
export const EVENTS = Object.keys(HACKATHON_EVENTS) as HackathonEvent[];
/** The campus hackathons (FUTMinna, Kadpoly): every event but the main one. */
export type CampusEvent = Exclude<HackathonEvent, "main">;
export const CAMPUS_EVENTS = EVENTS.filter((e): e is CampusEvent => e !== "main");

/** One event's settings, typed loosely so every event reads the same way. */
export function eventConfig(event: HackathonEvent): EventConfig {
  return HACKATHON_EVENTS[event];
}

/** Anything that isn't a known event name means the main hackathon. */
export function parseEvent(value: unknown): HackathonEvent {
  return typeof value === "string" && (EVENTS as string[]).includes(value) ? (value as HackathonEvent) : "main";
}

export function eventId(event: HackathonEvent): string {
  return HACKATHON_EVENTS[event].id;
}

/** The event a page belongs to, from its path: everything under a `/futminna` segment is FUTMinna, and so on. */
export function eventFromPath(path: string | null | undefined): HackathonEvent {
  const segments = (path ?? "").split(/[/?#]/);
  return CAMPUS_EVENTS.find((e) => segments.includes(e)) ?? "main";
}

/** An /api/hackathon URL for this event. The main hackathon keeps its plain URLs. */
export function eventApi(path: string, event: HackathonEvent): string {
  if (event === "main") return path;
  return `${path}${path.includes("?") ? "&" : "?"}event=${event}`;
}

/** When entries and approvals for this event stop. */
export function closeOf(event: HackathonEvent): Date {
  return new Date(HACKATHON_EVENTS[event].closesAt);
}

/** The event with this stored id (`futminna-2026`), if any. */
export function eventOfId(id: string): HackathonEvent | null {
  return EVENTS.find((e) => HACKATHON_EVENTS[e].id === id) ?? null;
}

/** A campus hackathon's school and prize. */
export function campusOf(event: CampusEvent): Campus {
  return HACKATHON_EVENTS[event].campus;
}

/** How the winners are picked, in one sentence, for a campus hackathon. */
export function campusPicking(event: CampusEvent): string {
  const c = campusOf(event);
  const { zone, closesLabel } = HACKATHON_EVENTS[event];
  return c.judged
    ? `The top ${zone} by approvals make the shortlist, and ${c.judges} pick the winner after voting closes on ${closesLabel}.`
    : `When voting closes on ${closesLabel}, the top ${c.winners} by approvals win and the next ${zone - c.winners} are waitlisted.`;
}

/** The leaderboard badge for a place inside the zone, or null outside it. */
export function zoneBadge(event: HackathonEvent, rank: number): string | null {
  const config = eventConfig(event);
  if (config.showsGd || rank > config.zone) return null;
  const c = config.campus;
  if (!c || c.judged) return "Shortlist";
  return rank <= c.winners ? `Top ${c.winners}` : "Waitlist";
}
