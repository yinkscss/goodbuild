/**
 * A project's first message that asks what to build, or names nothing to build ("I want a G dollar app",
 * "Hlo"), gets three ready ideas instead of a paid build (D173). Deliberately narrow: a concrete request,
 * even a short one ("a quiz game"), or a request phrased as a question ("Can you build a quiz?") is never
 * caught. Missing a vague message costs what it cost before; catching a real request would cost a build.
 * Jev's shadow `vague` signal measures whether a classifier can replace this rule later.
 */
const ASKS_FOR_IDEAS =
  /^(?:so\s+|ok(?:ay)?\s+|hi\s+|hello\s+)?(?:what|which)\s+(?:\w+\s+){0,3}(?:should|can|could|do|shall)\s+(?:i|we|you)\s+(?:build|make|create)\b|\b(?:give|suggest|show|recommend)\s+(?:me\s+|us\s+)?(?:some\s+|a\s+few\s+|any\s+)?(?:\w+\s+)?ideas?\b|^(?:any\s+)?(?:app\s+)?ideas?\s*\??$/i;
const FILLER =
  /\b(?:hi|hello|hlo|helo|hey|please|pls|i|we|want|wanna|need|would|like|to|build|make|create|an?|the|some|something|app|apps|application|dapp|website|site|with|using|use|on|for|g|dollars?|gooddollar|good|celo|integration|me|my|it|cool|nice|new|one|just|can|you|help|let's|lets|us)\b/gi;

export type FirstIntent = "ideas" | "build";

export function firstIntent(message: string): FirstIntent {
  const text = message.trim();
  if (!text || text.length > 200) return "build";
  if (ASKS_FOR_IDEAS.test(text)) return "ideas";
  const rest = text.replace(/g\s?\$/gi, " ").replace(FILLER, " ").replace(/[^\p{L}\p{N}]+/gu, "");
  return rest ? "build" : "ideas";
}
