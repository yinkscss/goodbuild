import type { TokenRow } from "@/lib/turn-types";

/**
 * The token report (D162, after GPT Engineer's per-step token log): every model call's usage is added to
 * the build's record under the step it served (spec, contracts, build, fix, review, ...) and the model
 * that answered, so where a build's tokens went is measured instead of guessed. Replayed calls are added
 * the same way, so a resumed build reports the whole build.
 */
export function addTokens(rows: TokenRow[], step: string, usage: { model: string; inputTokens: number; outputTokens: number; cachedInputTokens: number }): void {
  const row = rows.find((r) => r.step === step && r.model === usage.model);
  if (row) {
    row.calls += 1;
    row.input += usage.inputTokens;
    row.cached += usage.cachedInputTokens;
    row.output += usage.outputTokens;
  } else {
    rows.push({ step, model: usage.model, calls: 1, input: usage.inputTokens, cached: usage.cachedInputTokens, output: usage.outputTokens });
  }
}

/** "12.3K", "940", "1.2M". */
export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** The model's family name for the log: "Sonnet", "DeepSeek", or the id itself. */
export function modelLabel(model: string): string {
  if (/sonnet/i.test(model)) return "Sonnet";
  if (/opus/i.test(model)) return "Opus";
  if (/haiku/i.test(model)) return "Haiku";
  if (/deepseek/i.test(model)) return "DeepSeek";
  return model;
}

/**
 * One log line per model and one per step, e.g.
 * "tokens: Sonnet 41.2K in (30.1K cached), 3.1K out · DeepSeek 220.4K in (180.0K cached), 18.0K out"
 * "tokens by step: spec 41.2K (Sonnet) · build 160.3K (DeepSeek) · fix 60.1K (DeepSeek)"
 */
export function formatTokenReport(rows: TokenRow[]): string[] {
  if (!rows.length) return [];
  const byModel = new Map<string, { input: number; cached: number; output: number }>();
  for (const r of rows) {
    const label = modelLabel(r.model);
    const m = byModel.get(label) ?? { input: 0, cached: 0, output: 0 };
    m.input += r.input;
    m.cached += r.cached;
    m.output += r.output;
    byModel.set(label, m);
  }
  const models = [...byModel.entries()].map(([label, m]) => `${label} ${shortTokens(m.input)} in (${shortTokens(m.cached)} cached), ${shortTokens(m.output)} out`);
  const steps = rows.map((r) => `${r.step} ${shortTokens(r.input)} (${modelLabel(r.model)}, ${r.calls} ${r.calls === 1 ? "call" : "calls"})`);
  return [`tokens: ${models.join(" · ")}`, `tokens by step: ${steps.join(" · ")}`];
}
