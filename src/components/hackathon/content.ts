/**
 * Copy and numbers for /hackathon. Everything marked DRAFT is a placeholder the owner has not
 * confirmed yet (prize split, dates, tracks, team size, partner links): change it here only.
 */

export const HACKATHON = {
  name: "GoodBuild Hackathon",
  poolGd: 1_000_000,
  /** DRAFT dates (West Africa Time). */
  window: "18 Nov to 31 Dec 2026",
} as const;

export interface Prize {
  id: "reserve" | "base" | "approvals";
  label: string;
  note: string;
}
export const PRIZES: Prize[] = [
  {
    id: "reserve",
    label: "1,000,000 G$ total pool",
    note: "A fixed pool that is never exceeded. 700,000 G$ goes to rank prizes and 300,000 G$ is shared by approvals.",
  },
  {
    id: "base",
    label: "Top 20 rank prizes",
    note: "175,000 G$ for 1st, 105,000 for 2nd, 70,000 for 3rd, 42,000 each for 4th and 5th, 21,000 each for 6th to 10th, 16,100 each for 11th to 20th. Unused slots stay unpaid.",
  },
  {
    id: "approvals",
    label: "Up to 5,000 G$ per approval",
    note: "Every verified approval pays up to 5,000 G$ on any published project, including those outside the top 20. The rate drops if approvals would overrun the 300,000 G$ approval pool.",
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

/** Timeline, in order (D130). `now` marks the current stage. */
export const TIMELINE: Array<{
  when: string;
  title: string;
  body: string;
  now?: boolean;
}> = [
  {
    when: "18 Nov",
    title: "Registration, submissions and voting open",
    body: "Connect, verify, get credits, submit and approve projects.",
    now: true,
  },
  {
    when: "24 Dec",
    title: "Submit by now for a fair vote",
    body: "Late projects have less time to collect approvals.",
  },
  {
    when: "31 Dec",
    title: "Submissions and voting close",
    body: "Deployed on Celo with a live link. Ranking is fixed at midnight.",
  },
  {
    when: "Early Jan",
    title: "Winners announced",
    body: "Rewards follow the published terms.",
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
  { ok: true, text: "Open to everyone, wherever you study or work. One hackathon, one leaderboard." },
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
  { ok: true, text: "New work started after 18 Nov. Open source is welcome." },
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
    a: "The total pool is 1,000,000 G$ and is never exceeded. 700,000 G$ goes to the top 20 published projects by verified approvals: 175,000 G$ for 1st, 105,000 for 2nd, 70,000 for 3rd, 42,000 each for 4th and 5th, 21,000 each for 6th to 10th and 16,100 each for 11th to 20th. The other 300,000 G$ is shared by approvals: each pays up to 5,000 G$, less if there are many approvals, and applies to every published project. Fewer than 20 eligible entries leave unused rank prizes unpaid. Ties go to the earlier submission. Earnings are estimates until voting closes on 31 Dec; they are not your build-credit balance.",
  },
  {
    q: "Do I have to vote on FlowState to get credits?",
    a: "Yes. First verify with GoodDollar, then use the support button in step 3. It checks your FlowState ballot and sends your remaining votes to GoodBuildIt for your wallet to sign. This supports the hackathon; approving a project is a separate action. Once support is confirmed on-chain, you can claim free build credits.",
  },
  {
    q: "Can I submit before my app is ready?",
    a: "Yes. Sign in and register your idea, then return to add your live app and source code. Approvals open once you add a live app link.",
  },
  {
    q: "I'm at FUTMinna or Kadpoly. Is there a separate hackathon for my school?",
    a: "Not any more. On 24 Nov the FUTMinna and Kadpoly hackathons joined this one, so there is one hackathon for everyone with one leaderboard and the 1,000,000 G$ pool, closing 31 Dec. If you already signed up, entered or approved projects there, all of it carried over. The school scholarships are no longer offered.",
  },
];

export const fmtGd = (n: number) => n.toLocaleString("en-US");

export const FLOWSTATE_URL =
  "https://flowstate.network/flow-councils/42220/0x889e0aadaa3f8b28a794ef70da147827c620a590";
