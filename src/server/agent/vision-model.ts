import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";

type WrapModel = Parameters<typeof wrapLanguageModel>[0]["model"];

/**
 * Turn off DeepSeek's thinking for short image questions. Measured on 4 Nov 2026 (HARNESS.md):
 * with thinking on, deepseek-flash spent all of 500, 2,500 and 6,000 output tokens on reasoning
 * and returned no text; with it off, the same request answered in 2 s and about 150 tokens.
 */
export function withoutThinking(model: WrapModel) {
  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({ settings: { providerOptions: { deepseek: { thinking: { type: "disabled" } } } } }),
  });
}
