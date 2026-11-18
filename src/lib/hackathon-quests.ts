import { LEAGUE_AT, leagueFor, type League } from "./hackathon-ladder";

export interface QuestInput {
  registered: boolean;
  /** The 30 credits after a first Celo deploy have been claimed. */
  deployClaimed: boolean;
  /** The person's project has a live app link. */
  published: boolean;
  /** Approvals the person has given (of `maxApprovals`). */
  approvalsGiven: number;
  maxApprovals: number;
  /** Approvals their own project has received. */
  approvalsReceived: number;
  /** Their project's rank among published projects, or null without one. */
  rank: number | null;
  prizeSlots: number;
  /** Weeks their project won Rising Star (D135). */
  risingStarWeeks: number;
}

export interface Quest {
  id: string;
  title: string;
  hint: string;
  /** Build credits (already paid by the existing claims) or a badge. Quests never pay G$. */
  reward: string;
  done: boolean;
}

export interface Badge {
  id: string;
  label: string;
  earned: boolean;
}

/**
 * Quests and badges for one builder (D133). All of it is read from what the app already stores, and
 * the only money in it is the 20 + 30 credits the existing claims pay. Badges are status, never G$.
 */
export function buildQuests(i: QuestInput): { quests: Quest[]; badges: Badge[]; league: League | null; done: number } {
  const league = leagueFor(i.approvalsReceived);
  const inZone = i.rank !== null && i.rank <= i.prizeSlots;
  const quests: Quest[] = [
    { id: "register", title: "Register and verify", hint: "Connect, verify with GoodDollar and support us on FlowState.", reward: "+20 credits", done: i.registered },
    { id: "deploy", title: "Deploy to Celo", hint: "Deploy your first app, then claim your credits.", reward: "+30 credits", done: i.deployClaimed },
    { id: "publish", title: "Publish your project", hint: "Add your live app link so people can approve it.", reward: "Badge", done: i.published },
    { id: "vote", title: "Use your approvals", hint: `Approve ${i.maxApprovals} projects you’d actually use.`, reward: "Badge", done: i.approvalsGiven >= i.maxApprovals },
    { id: "bronze-quest", title: `Get ${LEAGUE_AT.Bronze} approvals`, hint: "Share your project link with people who’d use it.", reward: "Bronze league", done: i.approvalsReceived >= LEAGUE_AT.Bronze },
    { id: "zone", title: "Reach the prize zone", hint: `Finish in the top ${i.prizeSlots} by approvals.`, reward: "Badge", done: inZone },
  ];
  const badges: Badge[] = [
    { id: "first-approval", label: "First approval", earned: i.approvalsGiven >= 1 },
    { id: "full-ballot", label: "Full ballot", earned: i.approvalsGiven >= i.maxApprovals },
    { id: "published", label: "Published", earned: i.published },
    { id: "bronze", label: "Bronze", earned: i.approvalsReceived >= LEAGUE_AT.Bronze },
    { id: "silver", label: "Silver", earned: i.approvalsReceived >= LEAGUE_AT.Silver },
    { id: "gold", label: "Gold", earned: i.approvalsReceived >= LEAGUE_AT.Gold },
    { id: "prize-zone", label: "Prize zone", earned: inZone },
    { id: "rising-star", label: "Rising Star", earned: i.risingStarWeeks > 0 },
  ];
  return { quests, badges, league, done: quests.filter((q) => q.done).length };
}
