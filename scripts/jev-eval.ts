import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyTurn,
  features,
  questionVersion,
  resolveAnswers,
  responseSchema,
  thresholds,
  type Feature,
  type IntentState,
  type JevDecision,
} from "../src/server/agent/jev";
import { requestedMilestones } from "../src/server/agent/delivery";
import { isGameRequest, parseIntake } from "../src/server/agent/plan-intake";
import { mentionsGd } from "../src/server/agent/checks";

const corpus = JSON.parse(readFileSync("docs/evals/jev/corpus.json", "utf8")) as {
  version: number;
  cases: Array<IntentState & { id: string; expected: Partial<Record<Feature, string>> }>;
};
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const dir = resolve(option("--out-dir", ".data/jev-eval"));
mkdirSync(dir, { recursive: true });
const model = option("--model", process.env.JEV_MODEL || "jev-latest");
const limits = {
  high: Number(option("--high", String(thresholds.high))),
  low: Number(option("--low", String(thresholds.low))),
};
if (!(limits.low >= 0 && limits.low < limits.high && limits.high <= 1)) throw Error("Invalid probability thresholds");
const filename = resolve(dir, "recordings.json");
const cache: Record<string, JevDecision> = existsSync(filename) ? JSON.parse(readFileSync(filename, "utf8")) : {};
const esc = (v: string) =>
  v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
async function main() {
  const rows: string[] = [];
  let missing = 0,
    failed = 0;
  for (const { id, expected, ...state } of corpus.cases) {
    const revision = createHash("sha256").update(JSON.stringify(state)).digest("hex");
    const key = [corpus.version, model, questionVersion, revision].join("/");
    if (args.includes("--record")) {
      cache[key] = await classifyTurn(state, undefined, { ...process.env, JEV_MODEL: model });
      writeFileSync(filename, JSON.stringify(cache, null, 2));
    }
    const saved = cache[key];
    const parsed = saved && responseSchema.safeParse(saved.response);
    const result =
      parsed?.success && saved.revision === revision && saved.version === questionVersion
        ? { ...saved, signals: resolveAnswers(parsed.data, limits) }
        : undefined;
    if (!result) missing++;
    const legacy = requestedMilestones(state.request).map((m) => m.id);
    const milestones = result ? requestedMilestones(state.request, result).map((m) => m.id) : [];
    for (const [feature, label] of Object.entries(expected)) {
      const capability = feature as Feature;
      const before =
        feature === "advance"
          ? ["continue", "continue building", "build next", "next milestone"].includes(state.request.toLowerCase())
          : feature === "game"
            ? isGameRequest(state.request)
            : feature === "gd"
              ? mentionsGd(state.request)
              : feature === "leaderboard"
                ? !!parseIntake('{"questions":[{"question":"How?","options":["Tap","Keys"]}]}', state.request)?.leaderboard
                : legacy.includes(feature as (typeof legacy)[number]);
      const after = result?.signals[capability] ?? "unevaluated";
      const outcome = !result ? "unevaluated" : after === label ? "pass" : "regression";
      if (outcome === "regression") failed++;
      const cells = [
        id,
        state.request,
        feature,
        label,
        before ? "requested" : "unspecified",
        after,
        legacy.join(", ") || "interface",
        result ? milestones.join(", ") || "interface" : "unevaluated",
        outcome,
        result?.model ?? "—",
      ];
      rows.push(
        `<tr data-feature="${feature}" data-outcome="${outcome}">${cells.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`,
      );
    }
  }
  const select = (id: string, options: string[]) =>
    `<select id="${id}"><option value="">All</option>${options.map((x) => `<option>${x}</option>`).join("")}</select>`;
  const report = `<!doctype html><meta charset="utf-8"><title>Jev routing replay</title><style>body{font:16px system-ui;margin:3vw;color:#182426}table{border-collapse:collapse;width:100%}td,th{padding:.6rem;border-bottom:1px solid #bbb;text-align:left}tr[data-outcome=regression]{background:#ffe7d8}label{margin-right:1rem}</style><h1>Jev routing replay</h1><p>${missing} unevaluated scenarios · ${failed} incorrect labels · corpus ${corpus.version} · model ${esc(model)} · thresholds ${limits.low} / ${limits.high}</p><p>Question and capability catalog revision <code>${questionVersion}</code></p><label>Capability ${select("feature", Object.keys(features))}</label><label>Outcome ${select("outcome", ["pass", "regression", "unevaluated"])}</label><table><thead><tr>${["Scenario", "Request", "Capability", "Expected", "Legacy", "Jev", "Legacy milestones", "Jev milestones", "Result", "Resolved model"].map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table><script>document.onchange=()=>document.querySelectorAll('tbody tr').forEach(row=>{row.hidden=['feature','outcome'].some(id=>document.getElementById(id).value && row.dataset[id]!==document.getElementById(id).value)})</script>`;
  writeFileSync(resolve(dir, "index.html"), report);
  console.log(
    `${corpus.cases.length} scenarios, ${missing} unevaluated, ${failed} incorrect labels. Report: ${dir}/index.html`,
  );
  if (args.includes("--require-pass") && (missing || failed)) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
