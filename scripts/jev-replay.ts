// Replays real prompts (exported read-only from the server) through Jev and compares with the built-in rules.
// Usage: node --import tsx --require ./scripts/worker-preload.cjs scripts/jev-replay.ts --csv .data/prod-prompts.csv [--limit n]
// Output goes to .data/jev-replay/ (gitignored): results.json and index.html. Emails and 0x addresses are redacted before sending.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { classifyTurn, questionVersion, thresholds, type IntentState, type Feature, type Intent } from "../src/server/agent/jev";
import { legacySignals } from "../src/server/agent/jev-legacy";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const out = ".data/jev-replay";
mkdirSync(out, { recursive: true });

type Result = {
  /** What produced this result: reused only when the model, questions, thresholds and input all match. */
  stamp?: string;
  n: number;
  request: string;
  error?: string;
  signals?: Record<Feature, Intent>;
  ms?: number;
  tokens?: { input_tokens: number; output_tokens: number };
  legacy?: Partial<Record<Feature, boolean>>;
  displayKind?: string;
};

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const redact = (s: string) => s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").replace(/0x[a-fA-F0-9]{40}/g, "[address]").slice(0, 4000);

async function main() {
  const rows = parseCsv(readFileSync(opt("--csv", ".data/prod-prompts.csv"), "utf8"));
  const goals = new Map<string, string>();
  for (const r of rows) if (r.n === "1") goals.set(r.project_id, redact(r.content));
  const limit = Number(opt("--limit", String(rows.length)));
  const cacheFile = `${out}/results.json`;
  const done: Record<string, Result> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  const model = process.env.JEV_MODEL || "jev-latest";
  const stampOf = (state: IntentState) =>
    [model, questionVersion, thresholds.high, thresholds.low, createHash("sha256").update(JSON.stringify(state)).digest("hex")].join("/");
  const stateOf = (r: Record<string, string>): IntentState => ({ request: redact(r.content), goal: goals.get(r.project_id), firstBuild: r.n === "1" });
  const todo = rows.slice(0, limit).filter((r) => !done[r.id] || done[r.id].error || done[r.id].stamp !== stampOf(stateOf(r)));
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const r = todo[next++];
      const state = stateOf(r);
      try {
        const d = await classifyTurn(state);
        done[r.id] = { stamp: stampOf(state), n: Number(r.n), request: state.request, signals: d.signals, ms: d.ms, tokens: d.response.usage, legacy: legacySignals(r.content), displayKind: d.displayKind };
      } catch (e) {
        done[r.id] = { stamp: stampOf(state), n: Number(r.n), request: state.request, error: (e as Error).message };
      }
      writeFileSync(cacheFile, JSON.stringify(done, null, 1));
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  // Summarise only this run's prompts: within --limit, and produced by the current model, questions and thresholds.
  const current = rows.slice(0, limit).flatMap((r) => (done[r.id]?.stamp === stampOf(stateOf(r)) ? [done[r.id]] : []));
  const ok = current.filter((x): x is Required<Result> => !x.error);
  const ms = ok.map((x) => x.ms).sort((a, b) => a - b);
  const tokens = ok.reduce((n, x) => n + x.tokens.input_tokens, 0);
  const dis: { feature: string; legacy: boolean; jev: string; n: number; request: string }[] = [];
  for (const x of ok) for (const [f, l] of Object.entries(x.legacy) as [Feature, boolean][]) {
    const j = x.signals[f];
    if (l !== (j === "requested")) dis.push({ feature: f, legacy: l, jev: j, n: x.n, request: x.request });
  }
  const by: Record<string, number> = {};
  for (const d of dis) by[d.feature] = (by[d.feature] ?? 0) + 1;
  const summary = { prompts: ok.length, errors: current.length - ok.length, p50ms: ms[Math.floor(ms.length / 2)], p95ms: ms[Math.floor(ms.length * 0.95)], inputTokensTotal: tokens, inputTokensMean: Math.round(tokens / Math.max(1, ok.length)), disagreements: dis.length, byFeature: by };
  writeFileSync(`${out}/summary.json`, JSON.stringify({ summary, disagreements: dis }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
