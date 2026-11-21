import { describe, expect, it } from "vitest";
import type { TokenRow } from "@/lib/turn-types";
import { addTokens, formatTokenReport, modelLabel, shortTokens } from "./token-report";

describe("token report (D162)", () => {
  it("adds calls up by step and model", () => {
    const rows: TokenRow[] = [];
    addTokens(rows, "spec", { model: "claude-sonnet-5-5", inputTokens: 20_000, cachedInputTokens: 0, outputTokens: 1_000 });
    addTokens(rows, "spec", { model: "claude-sonnet-5-5", inputTokens: 22_000, cachedInputTokens: 18_000, outputTokens: 500 });
    addTokens(rows, "build", { model: "deepseek-flash", inputTokens: 100_000, cachedInputTokens: 90_000, outputTokens: 8_000 });
    expect(rows).toEqual([
      { step: "spec", model: "claude-sonnet-5-5", calls: 2, input: 42_000, cached: 18_000, output: 1_500 },
      { step: "build", model: "deepseek-flash", calls: 1, input: 100_000, cached: 90_000, output: 8_000 },
    ]);
    expect(formatTokenReport(rows)).toEqual([
      "tokens: Sonnet 42.0K in (18.0K cached), 1.5K out · DeepSeek 100.0K in (90.0K cached), 8.0K out",
      "tokens by step: spec 42.0K (Sonnet, 2 calls) · build 100.0K (DeepSeek, 1 call)",
    ]);
  });

  it("formats small and large numbers and names models", () => {
    expect(shortTokens(940)).toBe("940");
    expect(shortTokens(1_234_567)).toBe("1.2M");
    expect(modelLabel("deepseek-flash")).toBe("DeepSeek");
    expect(modelLabel("claude-sonnet-5-5")).toBe("Sonnet");
    expect(formatTokenReport([])).toEqual([]);
  });
});
