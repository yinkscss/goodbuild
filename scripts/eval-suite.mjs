// GoodBuild's eval suite (D70, docs/evals/SUITE.md): runs every scenario in docs/evals/suite/suite.json
// against a running server with real model keys and scores what came out.
//
// Usage: BASE_URL=http://localhost:3000 node scripts/eval-suite.mjs [options]
//   --only a,b            run these scenario ids
//   --limit n             run the first n scenarios
//   --concurrency n       scenarios at once (default 2)
//   --out file.json       write full results (default docs/evals/suite/results/latest.json)
//   --baseline file.json  compare with a baseline and exit 1 on a regression
//   --update-baseline     write this run as the baseline instead of comparing
//
// The server should run with RUN_CHECK=1 (so "ready" means the app really opened) and with caps
// raised for throwaway wallets: UNVERIFIED_CAP_MICRO and FREE_AI_BUDGET_MICRO. The second is also
// the most a run can spend.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const suitePath = option("suite", "docs/evals/suite/suite.json");
const outPath = option("out", "docs/evals/suite/results/latest.json");
const baselinePath = option("baseline", "");
const only = option("only", "")?.split(",").filter(Boolean) ?? [];
const limit = Number(option("limit", "0"));
const concurrency = Math.max(1, Number(option("concurrency", "2")));

/** A regression: the pass rate fell by more than this many points, or the cost rose by more than this share. */
export const MAX_PASS_DROP = 0.1;
export const MAX_COST_RISE = 0.3;

const json = { "content-type": "application/json" };

export function session() {
  const jar = {};
  const call = async (p, init = {}) => {
    const res = await fetch(base + p, { ...init, headers: { ...(init.headers ?? {}), cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") } });
    for (const c of res.headers.getSetCookie()) {
      const [k, ...v] = c.split(";")[0].split("=");
      if (v.join("=")) jar[k] = v.join("=");
    }
    return res;
  };
  return call;
}

export async function signIn(call) {
  const account = privateKeyToAccount(generatePrivateKey());
  const { nonce } = await (await call("/api/auth/nonce")).json();
  const message = createSiweMessage({ address: account.address, chainId: 11142220, domain: new URL(base).host, uri: base, version: "1", nonce, issuedAt: new Date() });
  const res = await call("/api/auth/verify", { method: "POST", headers: json, body: JSON.stringify({ message, signature: await account.signMessage({ message }), walletKind: "external", attestation: { ageOk: true, notUsPerson: true } }) });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
}

/** Every event of a job, reconnecting with ?after= until the server sends `event: end`. */
export async function streamJob(call, projectId, jobId, onEvent) {
  let after = -1;
  for (let failures = 0; failures < 20; ) {
    const res = await call(`/api/projects/${projectId}/turns/${jobId}/events?after=${after}`).catch(() => null);
    if (!res?.ok) {
      failures++;
      await new Promise((r) => setTimeout(r, 1000 * Math.min(8, failures)));
      continue;
    }
    const decoder = new TextDecoder();
    let buf = "";
    let ended = false;
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const id = block.match(/^id: (\d+)$/m)?.[1];
          if (id) after = Number(id);
          if (/^event: end$/m.test(block)) ended = true;
          const data = block.match(/^data: (.*)$/m)?.[1];
          if (data && !ended) onEvent(JSON.parse(data));
        }
      }
    } catch {
      failures++;
    }
    if (ended) return;
  }
  throw new Error(`the event stream for job ${jobId} kept failing`);
}

/** One turn, summarised from its events. */
export async function runTurn(call, projectId, body, prompt) {
  const t0 = Date.now();
  const res = await call(`/api/projects/${projectId}/turns`, { method: "POST", headers: json, body: JSON.stringify(body) });
  if (res.status !== 202) return { prompt, status: "error", error: `not queued: ${res.status} ${(await res.text()).slice(0, 200)}`, seconds: 0, usd: 0, strongUsd: 0, fixAttempts: 0, firstTryClean: false, toolChecks: 0, files: 0, steps: [], log: [], reply: "" };
  const { jobId } = await res.json();
  const usage = [];
  const log = [];
  const steps = new Map();
  let done = null;
  let error = null;
  let text = "";
  let version = null;
  await streamJob(call, projectId, jobId, (e) => {
    if (e.type === "usage") usage.push(e);
    else if (e.type === "log") log.push(e.line);
    else if (e.type === "step") steps.set(e.step.id, e.step);
    else if (e.type === "text") text += e.delta;
    else if (e.type === "text_set") text = e.text;
    else if (e.type === "snapshot") {
      text = e.text;
      log.splice(0, log.length, ...e.record.log);
      steps.clear();
      for (const s of e.record.steps) steps.set(s.id, s);
    } else if (e.type === "version") version = e.number;
    else if (e.type === "done") done = e;
    else if (e.type === "error") error = e.message;
  });
  const all = [...steps.values()];
  const usd = usage.reduce((n, u) => n + u.chargedMicro / 1e6, 0);
  const strongUsd = usage.filter((u) => /claude/i.test(u.model)).reduce((n, u) => n + u.chargedMicro / 1e6, 0);
  // The checks at the end of the turn (not the builder's own run_checks, not a fix attempt's).
  const first = all.filter((s) => /^(compile|test|app|types|run)$/.test(s.id));
  const lastRun = all.filter((s) => /^run(:|$)/.test(s.id)).at(-1);
  return {
    prompt,
    status: done?.status ?? "error",
    error,
    seconds: Math.round((Date.now() - t0) / 1000),
    usd,
    strongUsd,
    fixAttempts: all.filter((s) => /^fix:\d+$/.test(s.id)).length,
    firstTryClean: first.length > 0 && first.every((s) => s.status === "done"),
    toolChecks: log.filter((l) => l.startsWith("· run_checks")).length,
    runCheck: lastRun ? `${lastRun.status}: ${lastRun.detail ?? ""}` : "not run",
    typeCheck: log.filter((l) => l.includes("type check:")).at(-1) ?? "not run",
    files: all.filter((s) => s.label?.startsWith("Writing")).length,
    savedVersion: version,
    steps: all.map((s) => `${s.id}:${s.status}${s.detail ? `:${s.detail}` : ""}`),
    log,
    reply: text.trim().slice(0, 600),
  };
}

/** Did the scenario do what its kind asks? Returns the reason it failed, or null. */
export function verdict(kind, turns) {
  if (!turns.length) return "no turns ran";
  if (kind === "refuse") {
    const t = turns[0];
    if (t.status === "error") return `the turn failed: ${t.error ?? "unknown"}`;
    if (t.savedVersion || t.files > 0) return "it wrote files instead of refusing";
    return t.status === "answered" ? null : `expected an answer without a build, got "${t.status}"`;
  }
  for (const [i, t] of turns.entries()) {
    if (t.status !== "ready") return `turn ${i + 1} ended "${t.status}"${t.error ? `: ${t.error}` : ""}`;
    if (t.runCheck.startsWith("error")) return `turn ${i + 1}: the app didn't run (${t.runCheck})`;
  }
  return null;
}

export async function runScenario(scenario) {
  const call = session();
  const turns = [];
  try {
    await signIn(call);
    const created = await call("/api/projects", { method: "POST", headers: json, body: JSON.stringify({ prompt: scenario.turns[0], network: "celo-sepolia" }) });
    if (!created.ok) throw new Error(`couldn't create the project: ${created.status} ${(await created.text()).slice(0, 200)}`);
    const projectId = (await created.json()).id;
    const state = await (await call(`/api/projects/${projectId}`)).json();
    const queued = state.messages.find((m) => m.status === "queued")?.id;
    for (const [i, prompt] of scenario.turns.entries()) {
      // The suite measures building, so the plan-first questions are skipped (D32's own "Skip, just build it").
      const body = i === 0 && queued ? { mode: "build", userMessageId: queued, skipPlan: true } : { mode: "build", prompt, skipPlan: true };
      turns.push(await runTurn(call, projectId, body, prompt));
      if (turns.at(-1).status === "error") break;
    }
    const failure = verdict(scenario.kind, turns);
    return { id: scenario.id, kind: scenario.kind, projectId, pass: !failure, failure, turns };
  } catch (error) {
    return { id: scenario.id, kind: scenario.kind, pass: false, failure: String(error?.message ?? error), turns };
  }
}

export function summarise(results) {
  const turns = results.flatMap((r) => r.turns);
  const builds = results.filter((r) => r.kind !== "refuse");
  const buildTurns = builds.flatMap((r) => r.turns);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const share = (n, d) => (d ? n / d : 0);
  return {
    scenarios: results.length,
    passed: results.filter((r) => r.pass).length,
    passRate: share(results.filter((r) => r.pass).length, results.length),
    firstTryRate: share(buildTurns.filter((t) => t.firstTryClean).length, buildTurns.length),
    fixAttempts: sum(buildTurns.map((t) => t.fixAttempts)),
    toolChecks: sum(buildTurns.map((t) => t.toolChecks)),
    usd: sum(turns.map((t) => t.usd)),
    strongShare: share(sum(turns.map((t) => t.strongUsd)), sum(turns.map((t) => t.usd))),
    seconds: sum(turns.map((t) => t.seconds)),
  };
}

/** Problems that should fail the run, comparing this summary with the baseline's. */
export function regressions(now, before) {
  const out = [];
  if (now.passRate < before.passRate - MAX_PASS_DROP) out.push(`the pass rate fell from ${pct(before.passRate)} to ${pct(now.passRate)}`);
  // Cost per scenario, so a run of part of the suite can still be compared.
  const per = (s) => (s.scenarios ? s.usd / s.scenarios : 0);
  if (per(before) > 0 && per(now) > per(before) * (1 + MAX_COST_RISE)) out.push(`the cost per scenario rose from $${per(before).toFixed(3)} to $${per(now).toFixed(3)}`);
  return out;
}

const pct = (x) => `${Math.round(x * 100)}%`;

export function markdown(results, summary, baseline, problems) {
  const lines = ["## GoodBuild eval suite", ""];
  const cell = (now, before, fmt) => (before === undefined ? fmt(now) : `${fmt(now)} (was ${fmt(before)})`);
  const b = baseline?.summary;
  lines.push("| | This run |", "|---|---|");
  lines.push(`| Scenarios passed | ${summary.passed} of ${summary.scenarios}, ${cell(summary.passRate, b?.passRate, pct)} |`);
  lines.push(`| Clean on the first try | ${cell(summary.firstTryRate, b?.firstTryRate, pct)} |`);
  lines.push(`| Fix attempts | ${cell(summary.fixAttempts, b?.fixAttempts, String)} |`);
  lines.push(`| Checks the builder ran itself | ${cell(summary.toolChecks, b?.toolChecks, String)} |`);
  lines.push(`| Cost | ${cell(summary.usd, b?.usd, (x) => `$${x.toFixed(2)}`)} |`);
  lines.push(`| Share of cost on the fix model | ${cell(summary.strongShare, b?.strongShare, pct)} |`);
  lines.push(`| Time | ${Math.round(summary.seconds / 60)} min of builds |`, "");
  if (problems.length) lines.push(`**Regression:** ${problems.join("; ")}.`, "");
  lines.push("| Scenario | Kind | Result | Fixes | Cost | Time | Note |", "|---|---|---|---|---|---|---|");
  for (const r of results) {
    const fixes = r.turns.reduce((n, t) => n + t.fixAttempts, 0);
    const usd = r.turns.reduce((n, t) => n + t.usd, 0);
    const secs = r.turns.reduce((n, t) => n + t.seconds, 0);
    lines.push(`| ${r.id} | ${r.kind} | ${r.pass ? "pass" : "**fail**"} | ${fixes} | $${usd.toFixed(3)} | ${secs}s | ${(r.failure ?? r.turns.at(-1)?.runCheck ?? "").replace(/\|/g, "/").slice(0, 120)} |`);
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const suite = JSON.parse(readFileSync(suitePath, "utf8"));
  let scenarios = suite.scenarios.filter((s) => !only.length || only.includes(s.id));
  if (limit) scenarios = scenarios.slice(0, limit);
  console.log(`running ${scenarios.length} scenario(s) against ${base}, ${concurrency} at a time`);

  const results = new Array(scenarios.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, scenarios.length) }, async () => {
      while (next < scenarios.length) {
        const i = next++;
        const r = await runScenario(scenarios[i]);
        results[i] = r;
        const usd = r.turns.reduce((n, t) => n + t.usd, 0);
        console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  $${usd.toFixed(3)}  ${r.turns.reduce((n, t) => n + t.seconds, 0)}s${r.failure ? `  ${r.failure}` : ""}`);
      }
    }),
  );

  const summary = summarise(results);
  const baseline = baselinePath && existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
  const problems = baseline && !flag("update-baseline") ? regressions(summary, baseline.summary) : [];
  const report = markdown(results, summary, flag("update-baseline") ? null : baseline, problems);
  console.log(`\n${report}`);

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), base, summary, results }, null, 2));
  if (flag("update-baseline") && baselinePath) {
    // The baseline keeps the numbers, not the transcripts.
    writeFileSync(baselinePath, JSON.stringify({ at: new Date().toISOString(), summary, scenarios: results.map((r) => ({ id: r.id, pass: r.pass, usd: r.turns.reduce((n, t) => n + t.usd, 0) })) }, null, 2) + "\n");
    console.log(`baseline written to ${baselinePath}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  if (baselinePath && !baseline && !flag("update-baseline")) console.log(`no baseline at ${baselinePath} yet: nothing to compare with`);
  process.exit(problems.length ? 1 : 0);
}

// Only when run directly, so the scoring functions can be imported by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) await main();
