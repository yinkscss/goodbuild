import { describe, expect, it } from "vitest";

import { chargedMicro, costMicro, estimateTurnMicro, priceFor } from "./pricing";

describe("pricing", () => {
  it("prices Sonnet 5.5 at $2 / $10 per MTok", () => {
    // 1M input + 1M output = $12 = 12,000,000 micro-USD
    expect(costMicro("anthropic/claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(12_000_000);
  });

  it("prices cached input at the cache rate", () => {
    const full = costMicro("claude-sonnet-5-5", { inputTokens: 100_000, outputTokens: 0 });
    const cached = costMicro("claude-sonnet-5-5", { inputTokens: 100_000, outputTokens: 0, cachedInputTokens: 100_000 });
    expect(full).toBe(200_000);
    expect(cached).toBe(10_000);
  });

  it("prices DeepSeek Flash at peak rates", () => {
    expect(costMicro("deepseek/deepseek-flash", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(1_500_000);
    expect(priceFor("deepseek-chat").label).toBe("DeepSeek Flash");
  });

  it("prices unknown models like the strong model, never cheaper", () => {
    expect(costMicro("some/new-model", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(2_000_000);
  });

  it("adds the 25% markup and rounds up", () => {
    expect(chargedMicro(1_000_000)).toBe(1_250_000);
    expect(chargedMicro(3)).toBe(4);
  });

  it("estimates more for a first build than a follow-up, and least for plan mode", () => {
    const base = { contextChars: 40_000 };
    const first = estimateTurnMicro({ ...base, mode: "build", firstBuild: true });
    const follow = estimateTurnMicro({ ...base, mode: "build", firstBuild: false });
    const plan = estimateTurnMicro({ ...base, mode: "plan", firstBuild: false });
    expect(first).toBeGreaterThan(follow);
    expect(follow).toBeGreaterThan(plan);
    // A first build with ~40K chars of context lands in the tens of cents.
    expect(first).toBeGreaterThan(100_000);
    expect(first).toBeLessThan(1_000_000);
  });
});
