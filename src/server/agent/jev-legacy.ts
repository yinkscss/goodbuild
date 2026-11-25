// What the built-in keyword rules say about a request, per capability. Used to compare against Jev
// (shadow mode and the replay report). Removed once Jev routing is the only path.
import { requestedMilestones } from "./delivery";
import { mentionsGd } from "./checks";
import { asksLeaderboard, asksMiniPay, isGameRequest, isMultiplayerGame, looksLikeWebsite } from "./plan-intake";
import { isContinuation, type Feature } from "./jev";


/** Only the capabilities the built-in rules can answer are present. */
export function legacySignals(request: string): Partial<Record<Feature, boolean>> {
  const ids = requestedMilestones(request).map((m) => m.id as string);
  return {
    wallet: ids.includes("wallet"),
    multiplayer: ids.includes("multiplayer") || isMultiplayerGame(request),
    integrations: ids.includes("integrations"),
    payments: ids.includes("payments"),
    game: isGameRequest(request),
    website: looksLikeWebsite(request),
    miniPay: asksMiniPay(request),
    leaderboard: asksLeaderboard(request),
    gd: mentionsGd(request),
    advance: isContinuation(request),
  };
}

/** Capabilities where the two disagree. A Jev "unclear" or "unspecified" counts as not requested. */
export function disagreements(request: string, signals: Record<Feature, string>) {
  const legacy = legacySignals(request);
  return (Object.keys(legacy) as Feature[])
    .filter((f) => legacy[f] !== (signals[f] === "requested"))
    .map((f) => ({ feature: f, legacy: legacy[f], jev: signals[f] }));
}
