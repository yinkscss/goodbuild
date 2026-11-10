/**
 * What kind of dApp a project is, for card tiles and (later) agent template choice.
 * Taken from the template when one was picked, otherwise inferred from the name or prompt.
 */
export type ContractKind = "savings" | "tips" | "tickets" | "crowdfund" | "vote" | "badges" | "token" | "escrow" | "game" | "site" | "custom";

export const KIND_LABEL: Record<ContractKind, string> = {
  savings: "Savings circle",
  tips: "Tip jar",
  tickets: "Event tickets",
  crowdfund: "Crowdfund",
  vote: "Voting",
  badges: "NFT badges",
  token: "Token",
  escrow: "Escrow",
  game: "Game",
  site: "Website",
  custom: "Custom dApp",
};

const TEMPLATE_KIND: Record<string, ContractKind> = {
  "savings-circle": "savings",
  "tip-jar": "tips",
  "event-tickets": "tickets",
  crowdfund: "crowdfund",
  "class-vote": "vote",
  "event-badges": "badges",
  "mini-game": "game",
};

// Ordered: the first match wins, so more specific words come first.
const RULES: Array<[ContractKind, RegExp]> = [
  // First: "a quiz game with G$ prizes and a token" is a game.
  ["game", /\b(arcade|platformer|flappy|tetris|pong|breakout|endless runner|mini[- ]?games?|video games?|(?:clicker|snake|puzzle|quiz|card|memory|2d|browser) games?|a game (?:where|about|like|with|in which|for)|(?:build|make|create|want)(?: me| us)? an? (?:\w+ ){0,3}game)\b/i],
  ["savings", /\b(savings?|ajo|esusu|rosca|susu|thrift|contribution circle)\b/i],
  ["tips", /\b(tips?|tip ?jar|donat(e|ion)s?)\b/i],
  ["tickets", /\b(tickets?|ticketing|check-?in)\b/i],
  ["crowdfund", /\b(crowd ?fund(ing)?|fund ?rais(e|er|ing)|refund)\b/i],
  ["vote", /\b(vot(e|es|ing)|polls?|ballot|elections?|governance|dao)\b/i],
  ["badges", /\b(badges?|poap|attendance|certificates?|nfts?|soulbound)\b/i],
  ["escrow", /\b(escrow|milestones?)\b/i],
  ["token", /\b(token|erc-?20|coin)\b/i],
  // Last, so "a landing page for my tip jar" is still a tip jar.
  ["site", /\b(landing ?page|website|web ?site|portfolio|home ?page|blog)\b/i],
];

export function inferKind(input: { templateId?: string | null; text?: string | null }): ContractKind {
  const fromTemplate = input.templateId ? TEMPLATE_KIND[input.templateId] : undefined;
  if (fromTemplate) return fromTemplate;
  const text = input.text ?? "";
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  return "custom";
}
