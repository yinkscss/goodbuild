/**
 * Copy and numbers for /hackathon. Everything marked DRAFT is a placeholder the owner has not
 * confirmed yet (prize split, dates, tracks, team size, partner links): change it here only.
 */

export const HACKATHON = {
  name: "GoodBuild Hackathon",
  poolGd: 1_000_000,
  /** DRAFT dates (West Africa Time). */
  window: "8 Jan to 8 Feb 2027",
  buildStartsIso: "2027-01-08T11:00:00Z",
} as const;

export interface Prize {
  id: "reserve" | "base" | "approvals";
  label: string;
  note: string;
}
export const PRIZES: Prize[] = [
  {
    id: "reserve",
    label: "1,000,000 G$ shared reserve",
    note: "The top 10 published projects share the reserve through equal base rewards. Rankings follow verified community approvals.",
  },
  {
    id: "base",
    label: "100,000 G$ base reward",
    note: "Each of the top 10 published projects earns a 100,000 G$ base. With fewer than 10 eligible projects, unused slots stay in reserve.",
  },
  {
    id: "approvals",
    label: "+50,000 G$ per approval",
    note: "Every verified approval adds 50,000 G$ to a published project’s estimated earnings, including projects outside the top 10. These top-ups are funded separately, outside the 1,000,000 G$ reserve.",
  },
];

export type TrackIcon = "card" | "clock" | "people" | "pad" | "star";

/** DRAFT tracks. No betting or games of chance (D4, D72). */
export const TRACKS: Array<{
  title: string;
  body: string;
  example: string;
  icon: TrackIcon;
}> = [
  {
    title: "G$ Payments",
    body: "Tipping, payroll, invoices, merchant checkout in G$.",
    example: "e.g. Pay-by-link for market sellers",
    icon: "card",
  },
  {
    title: "Savings circles",
    body: "Ajo, esusu and chama, run by a contract instead of trust.",
    example: "e.g. Weekly G$ circle for 12 members",
    icon: "clock",
  },
  {
    title: "Community DAOs",
    body: "Treasuries, grants and one-human-one-vote polls.",
    example: "e.g. Neighbourhood grants DAO",
    icon: "people",
  },
  {
    title: "Skill games",
    body: "Onchain games and quests with G$ rewards. No betting.",
    example: "e.g. Daily puzzle with a G$ leaderboard",
    icon: "pad",
  },
  {
    title: "Public goods",
    body: "Aid drops, climate, education and impact tools.",
    example: "e.g. School fees fund with milestone payouts",
    icon: "star",
  },
];

export const MARQUEE = [
  "G$ Payments",
  "Savings circles",
  "Community DAOs",
  "Skill games",
  "Creator tools",
  "Public goods",
];

/** DRAFT timeline, in order. `now` marks the current stage. */
export const TIMELINE: Array<{
  when: string;
  title: string;
  body: string;
  now?: boolean;
}> = [
  {
    when: "1 Dec",
    title: "Registration opens",
    body: "Connect, verify, get credits.",
    now: true,
  },
  {
    when: "8 Jan",
    title: "Building starts",
    body: "Kickoff stream and track briefs.",
  },
  {
    when: "25 Jan",
    title: "Mid-point check-in",
    body: "Optional demo for mentor feedback.",
  },
  {
    when: "8 Feb",
    title: "Submissions close",
    body: "Deployed on Celo with a live link.",
  },
  {
    when: "22 Feb",
    title: "Demo day",
    body: "Builders demo. Rewards follow the published terms.",
  },
];

/** Partners without a link yet have `href: null`, which shows "Link coming soon". */
export const PARTNERS: Array<{
  name: [string, string?];
  role: string;
  body: string;
  href: string | null;
  lead?: boolean;
}> = [
  {
    name: ["Good", "Cash"],
    role: "Money partner",
    body: "Prizes and builder credits move through GoodCash.",
    href: "https://goodcash.xyz/",
    lead: true,
  },
  {
    name: ["Good", "Build"],
    role: "Host and sponsor",
    body: "The AI dApp builder for Celo. Every entry starts here, and verified entrants get free build credits.",
    href: "https://goodbuildit.xyz/",
  },
  {
    name: ["Jara"],
    role: "Sponsor",
    body: "Sponsor of the GoodBuild Million Hackathon.",
    href: null,
  },
];

export const RULES: Array<{ ok: boolean; text: string }> = [
  { ok: true, text: "18 or older, verified once with GoodDollar." },
  { ok: true, text: "One verified wallet per person. Teams of up to 4." },
  {
    ok: true,
    text: "Your entry is deployed on Celo and signed from your own wallet.",
  },
  {
    ok: true,
    text: "Start your entry on GoodBuild: its first commit comes from GoodBuild. Then connect GitHub and keep building wherever you like.",
  },
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
  {
    q: "Do I have to build with GoodBuild?",
    a: "You have to start there. Your entry's first commit must come from GoodBuild. After that, connect GitHub in GoodBuild and keep building in any editor you like.",
  },
  {
    q: "How do rewards work?",
    a: "The top 10 published projects receive 100,000 G$ each from the 1,000,000 G$ shared reserve. Every verified approval adds 50,000 G$ separately, outside that reserve, even beyond the top 10. Fewer than 10 eligible entries leave unused reserve slots. Ties go to the earlier submission. Earnings are estimates until rankings close and rewards are settled; they are not your build-credit balance.",
  },
  {
    q: "Do I have to vote on FlowState to get credits?",
    a: "Yes. First verify with GoodDollar, then complete your GoodBuildIt vote in step 3 here on GoodBuild. Once your support is confirmed on-chain, you can claim free build credits. Your points are selected for you, normally 10; you review and confirm before anything is sent.",
  },
  {
    q: "Can I submit before my app is ready?",
    a: "Yes. Sign in and register your idea, then return to add your live app and source code. Approvals open once you add a live app link.",
  },
];

export const fmtGd = (n: number) => n.toLocaleString("en-US");

export const FLOWSTATE_URL =
  "https://flowstate.network/flow-councils/42220/0x889e0aadaa3f8b28a794ef70da147827c620a590";
