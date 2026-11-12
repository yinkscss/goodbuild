import { CHARS_PER_TOKEN, FALLBACK_PRICE, MARKUP_BPS, MODEL_PRICES, type ModelPrice } from "@/config/model-pricing";

/** 1 credit = 1 micro-USD (CREDITS.md §1, D13). */
export const MICRO = 1_000_000;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens served from cache (subset of inputTokens). */
  cachedInputTokens?: number;
}

export function priceFor(model: string): ModelPrice {
  return MODEL_PRICES.find((p) => p.match.test(model)) ?? FALLBACK_PRICE;
}

/** Provider cost of one call in micro-USD, rounded up. */
export function costMicro(model: string, usage: TokenUsage): number {
  const p = priceFor(model);
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  const usd = (fresh * p.inputPerMTok + cached * p.cachedInputPerMTok + usage.outputTokens * p.outputPerMTok) / 1_000_000;
  return Math.ceil(usd * MICRO);
}

/** What the user is charged: provider cost plus the markup (D13), rounded up. */
export function chargedMicro(providerCostMicro: number, markupBps = MARKUP_BPS): number {
  return Math.ceil((providerCostMicro * (10_000 + markupBps)) / 10_000);
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export interface EstimateInput {
  mode: "build" | "plan";
  /** Characters of context the agent will send (system prompt, files, history). */
  contextChars: number;
  /** Whether this is the first build of the project (writes whole files). */
  firstBuild: boolean;
}

/**
 * Preflight estimate of a turn's charge (D13), in micro-USD. Assumptions, all
 * deliberately on the high side:
 * - a build makes ~4 strong-model calls (plan, edits, one round of fixes), each
 *   re-sending the context, which grows by the output written so far;
 * - a first build writes ~12K output tokens, a follow-up ~4K, plan mode ~1.5K in one call.
 */
export function estimateTurnMicro(input: EstimateInput, strongModel = "claude-sonnet-5-5"): number {
  const context = estimateTokens(input.contextChars);
  if (input.mode === "plan") {
    return chargedMicro(costMicro(strongModel, { inputTokens: context, outputTokens: 1_500 }));
  }
  const calls = 4;
  const output = input.firstBuild ? 12_000 : 4_000;
  // Each call re-sends the context plus, on average, half the output produced so far.
  const inputTokens = calls * context + Math.ceil((calls * output) / 2);
  return chargedMicro(costMicro(strongModel, { inputTokens, outputTokens: output }));
}
