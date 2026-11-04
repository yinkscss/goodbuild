/**
 * GoodBuild's own model price table (D13). Billing uses these numbers with the token
 * usage each call reports, not a provider SDK or proxy cost map, which can lag new models.
 *
 * Prices are USD per million tokens, checked 4 Nov 2026:
 * - Claude Sonnet 5.5: https://platform.claude.com/docs/en/models/overview
 *   ($2 input, $10 output; cache reads 5% of input).
 * - DeepSeek Flash: https://api-docs.deepseek.com/quick_start/pricing
 *   (peak $0.30 input cache miss, $0.006 cache hit, $1.20 output). We always use peak
 *   prices, which can only over-estimate (off-peak is half).
 * Re-check before changing markup or launching on mainnet.
 */
export interface ModelPrice {
  /** Matches the model name the provider reports back (provider prefix optional). */
  match: RegExp;
  label: string;
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICES: ModelPrice[] = [
  { match: /claude-sonnet-5-5/, label: "Claude Sonnet 5.5", inputPerMTok: 2, cachedInputPerMTok: 0.1, outputPerMTok: 10 },
  { match: /deepseek-(flash|v4-flash|chat)/, label: "DeepSeek Flash", inputPerMTok: 0.3, cachedInputPerMTok: 0.006, outputPerMTok: 1.2 },
];

/** Used when a reported model isn't in the table: priced like the most expensive one, so we never under-bill. */
export const FALLBACK_PRICE: ModelPrice = {
  match: /.*/,
  label: "Unknown model (priced as strong)",
  inputPerMTok: 2,
  cachedInputPerMTok: 2,
  outputPerMTok: 10,
};

/** D13: actual LLM cost + 25%. In basis points. */
export const MARKUP_BPS = 2500;

/**
 * Characters per token for estimates. Anthropic's current tokenizer is about 2.5
 * characters per token (1M tokens ≈ 2.5M characters, per the models overview), lower
 * than the usual 4, so estimates stay conservative.
 */
export const CHARS_PER_TOKEN = 2.5;
