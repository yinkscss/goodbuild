/**
 * Copy and numbers for /hackathon. Everything marked DRAFT is a placeholder the owner has not
 * confirmed yet (prize split, dates, tracks, team size, partner links): change it here only.
 */

export const HACKATHON = {
  name: "GoodBuild Million Hackathon",
  poolGd: 1_000_000,
  /** DRAFT dates (West Africa Time). */
  window: "8 Jan to 8 Feb 2027",
  buildStartsIso: "2027-01-08T11:00:00Z",
} as const;

export interface Prize {
  id: "grand" | "second" | "third" | "tracks" | "community" | "credits";
  label: string;
  amountGd: number;
  note?: string;
}

/** DRAFT split. Must add up to HACKATHON.poolGd (checked in content.test.ts). */
export const PRIZES: Prize[] = [
  { id: "grand", label: "Grand prize", amountGd: 250_000, note: "The best dApp across every track. Judged on real use, G$ flow and polish." },
  { id: "second", label: "Runner-up", amountGd: 150_000 },
  { id: "third", label: "Third place", amountGd: 100_000 },
  { id: "tracks", label: "Track winners", amountGd: 300_000, note: "5 tracks × 60,000 G$" },
  { id: "community", label: "Community vote", amountGd: 100_000, note: "Verified humans vote, one each" },
  { id: "credits", label: "Builder credits", amountGd: 100_000, note: "Paid out as GoodBuild credits to verified entrants" },
];

export type TrackIcon = "card" | "clock" | "people" | "pad" | "star";

/** DRAFT tracks. No betting or games of chance (D4, D72). */
export const TRACKS: Array<{ title: string; body: string; example: string; icon: TrackIcon }> = [
  { title: "G$ Payments", body: "Tipping, payroll, invoices, merchant checkout in G$.", example: "e.g. Pay-by-link for market sellers", icon: "card" },
  { title: "Savings circles", body: "Ajo, esusu and chama, run by a contract instead of trust.", example: "e.g. Weekly G$ circle for 12 members", icon: "clock" },
  { title: "Community DAOs", body: "Treasuries, grants and one-human-one-vote polls.", example: "e.g. Neighbourhood grants DAO", icon: "people" },
  { title: "Skill games", body: "Onchain games and quests with G$ rewards. No betting.", example: "e.g. Daily puzzle with a G$ leaderboard", icon: "pad" },
  { title: "Public goods", body: "Aid drops, climate, education and impact tools.", example: "e.g. School fees fund with milestone payouts", icon: "star" },
];

export const MARQUEE = ["G$ Payments", "Savings circles", "Community DAOs", "Skill games", "Creator tools", "Public goods"];

/** DRAFT timeline, in order. `now` marks the current stage. */
export const TIMELINE: Array<{ when: string; title: string; body: string; now?: boolean }> = [
  { when: "1 Dec", title: "Registration opens", body: "Connect, verify, get credits.", now: true },
  { when: "8 Jan", title: "Building starts", body: "Kickoff stream and track briefs." },
  { when: "25 Jan", title: "Mid-point check-in", body: "Optional demo for mentor feedback." },
  { when: "8 Feb", title: "Submissions close", body: "Deployed on Celo with a live link." },
  { when: "22 Feb", title: "Demo day", body: "Finalists present. Winners paid in G$." },
];

/** Partner links are not in yet: `href: null` shows "Link coming soon". */
export const PARTNERS: Array<{ name: [string, string?]; role: string; body: string; href: string | null; lead?: boolean }> = [
  { name: ["Good", "Cash"], role: "Money partner", body: "Prizes and builder credits move through GoodCash.", href: null, lead: true },
  { name: ["Good", "Build"], role: "Host and sponsor", body: "The AI dApp builder for Celo. Verified entrants get free build credits.", href: null },
  { name: ["Jara"], role: "Sponsor", body: "Sponsor of the GoodBuild Million Hackathon.", href: null },
];

export const RULES: Array<{ ok: boolean; text: string }> = [
  { ok: true, text: "18 or older, verified once with GoodDollar." },
  { ok: true, text: "One verified wallet per person. Teams of up to 4." },
  { ok: true, text: "Your entry is deployed on Celo and signed from your own wallet." },
  { ok: true, text: "New work started after 8 Jan. Open source is welcome." },
  { ok: false, text: "No betting, gambling or sports-betting apps." },
  { ok: false, text: "Not open to US persons." },
];

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Why do I have to verify with GoodDollar?",
    a: "The prize pool and community vote only work if each builder is one real person. GoodDollar's face check proves that once, and we only learn that your wallet is verified.",
  },
  {
    q: "What do the build credits pay for?",
    a: "Credits pay for building on GoodBuild: prompts, code generation and previews. Deploys are signed in your wallet, so you pay Celo gas yourself.",
  },
  { q: "Do I have to build with GoodBuild?", a: "No. You can write the code yourself. The credits are there to help you move faster." },
  { q: "How are prizes paid?", a: "In G$ on Celo, to the verified wallet that registered the entry." },
];

export const fmtGd = (n: number) => n.toLocaleString("en-US");
