/**
 * Plain words for a person who doesn't code (D164). Shared by the server (what it saves) and the workspace (what
 * it shows, including turns saved before D164). The technical text stays in the build log and the server logs.
 */

/** A milestone's name as a person reads it. Each next-step name also matches its milestone when sent as a request. */
export function milestoneName(id: string, fallback = "The next part"): string {
  switch (id) {
    case "interface":
      return "Your app's screens";
    case "wallet":
      return "Connect a wallet";
    case "multiplayer":
      return "Play with others";
    case "integrations":
      return "Sign-in and saved data";
    case "payments":
      return "Payments on Celo";
    default:
      return fallback;
  }
}

/** Saved milestone titles (DeliveryPlan) to their plain names, for records saved before D164. */
const TITLE_IDS: Record<string, string> = {
  "Working first interface": "interface",
  "Wallet connection": "wallet",
  Multiplayer: "multiplayer",
  "Remaining integrations": "integrations",
  "On-chain features and payments": "payments",
};

export function plainMilestoneTitle(title: string): string {
  const bare = title.replace(/\s*\(needs verification\)$/, "");
  return TITLE_IDS[bare] ? milestoneName(TITLE_IDS[bare]) : bare;
}

/**
 * What a person reads when a build stopped for a reason they can't act on. Known causes get one sentence each;
 * anything else is "on our side". Never the raw message.
 */
export function plainError(message: string | undefined | null): string {
  const m = (message ?? "").trim();
  if (!m) return "Something went wrong on our side. Your files are saved.";
  // Already written for people: the credits messages (D138).
  if (/^This build (paused|stopped) because your credits ran (low|out)/.test(m)) return m;
  if (/AI provider|overloaded|rate.?limit|\b(429|502|503|529)\b|model/i.test(m)) return "The AI that writes your app isn't answering right now. That wasn't something you did. Your files are saved.";
  if (/fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|connection (was )?(reset|closed|refused)/i.test(m)) return "We lost the connection to one of our services while building. That wasn't something you did. Your files are saved.";
  if (/timed? ?out|ETIMEDOUT|deadline|took too long/i.test(m)) return "One step took too long, so GoodBuild stopped it. That wasn't something you did. Your files are saved.";
  if (/saved progress|older version of GoodBuild|no longer matches/i.test(m)) return "This build was interrupted and couldn't pick up where it left off. Your files are saved.";
  if (/design reference .* deleted/i.test(m)) return "A picture this build was using was deleted, so it couldn't continue. Your files are saved.";
  return "Something went wrong on our side. That wasn't something you did. Your files are saved.";
}
