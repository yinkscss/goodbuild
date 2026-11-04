// Live harness eval driver (docs/evals/HARNESS.md). Signs in a throwaway wallet against a
// running dev server, creates a project, uploads assets, runs prompts as turns and records what
// happened per turn: status, fix attempts, reads and searches, context picks, cost per model.
// Usage: BASE_URL=http://localhost:3001 node scripts/eval-harness.mjs <scenario.json> [out.json]
// Scenario: { "name": "...", "uploads": [{ "file": "path", "kind": "logo" }], "turns": ["prompt", ...],
//             "project": "<existing project id, optional>", "cookie": "<gb_session, optional>" }
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const base = process.env.BASE_URL ?? "http://localhost:3001";
const [scenarioPath, outPath] = process.argv.slice(2);
const scenario = JSON.parse(await readFile(scenarioPath, "utf8"));
const jar = {};
if (scenario.cookie) jar.gb_session = scenario.cookie;

async function call(p, init = {}) {
  const res = await fetch(base + p, { ...init, headers: { ...(init.headers ?? {}), cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") } });
  for (const c of res.headers.getSetCookie()) {
    const [k, ...v] = c.split(";")[0].split("=");
    if (v.join("=")) jar[k] = v.join("=");
  }
  return res;
}

if (!jar.gb_session) {
  const account = privateKeyToAccount(generatePrivateKey());
  const { nonce } = await (await call("/api/auth/nonce")).json();
  const message = createSiweMessage({ address: account.address, chainId: 11142220, domain: new URL(base).host, uri: base, version: "1", nonce, issuedAt: new Date() });
  const signature = await account.signMessage({ message });
  const res = await call("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
}

let projectId = scenario.project;
let queued = null;
if (!projectId) {
  const res = await call("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: scenario.turns[0], network: "celo-sepolia" }) });
  projectId = (await res.json()).id;
  const state = await (await call(`/api/projects/${projectId}`)).json();
  queued = state.messages.find((m) => m.status === "queued")?.id ?? null;
}

const uploads = [];
for (const u of scenario.uploads ?? []) {
  const body = new FormData();
  body.set("file", new Blob([await readFile(u.file)]), path.basename(u.file));
  body.set("kind", u.kind);
  const t0 = Date.now();
  const res = await call(`/api/projects/${projectId}/assets`, { method: "POST", body });
  const j = await res.json();
  uploads.push({ file: u.file, status: res.status, ms: Date.now() - t0, asset: j.asset ?? j });
  console.log(`upload ${u.file}: ${res.status} ${j.asset ? `${j.asset.name} ${j.asset.width}x${j.asset.height} ${j.asset.palette.join(" ")}` : JSON.stringify(j)}`);
}

const turns = [];
for (const [i, prompt] of scenario.turns.entries()) {
  const t0 = Date.now();
  const body = i === 0 && queued ? { mode: "build", userMessageId: queued } : { mode: "build", prompt };
  const res = await call(`/api/projects/${projectId}/turns`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const usage = [];
  let done = null;
  let error = null;
  let text = "";
  const log = [];
  const steps = new Map();
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/^data: /, "");
      buf = buf.slice(idx + 2);
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.type === "usage") usage.push({ model: e.model, in: e.inputTokens, out: e.outputTokens, cached: e.cachedInputTokens, micro: e.chargedMicro });
      else if (e.type === "log") log.push(e.line);
      else if (e.type === "step") steps.set(e.step.id, e.step);
      else if (e.type === "text") text += e.delta;
      else if (e.type === "text_set") text = e.text;
      else if (e.type === "done") done = e;
      else if (e.type === "error") error = e.message;
    }
  }
  const byModel = {};
  for (const u of usage) {
    byModel[u.model] ??= { calls: 0, in: 0, out: 0, usd: 0 };
    byModel[u.model].calls++;
    byModel[u.model].in += u.in;
    byModel[u.model].out += u.out;
    byModel[u.model].usd += u.micro / 1e6;
  }
  const access = log.filter((l) => l.startsWith("· "));
  const fixes = [...steps.keys()].filter((k) => /^fix:\d+$/.test(k)).length;
  const firstChecks = [...steps.values()].filter((s) => ["compile", "app", "test"].includes(s.id));
  const turn = {
    prompt,
    status: done?.status ?? "error",
    error,
    seconds: Math.round((Date.now() - t0) / 1000),
    firstTryClean: firstChecks.every((s) => s.status === "done"),
    fixAttempts: fixes,
    reads: access.filter((l) => l.startsWith("· read_file")).length,
    searches: access.filter((l) => /^· (search_code|find_symbol|list_files)/.test(l)).length,
    access,
    context: log.find((l) => l.startsWith("context:")),
    guides: log.filter((l) => l.startsWith("guides:")),
    memory: log.find((l) => l.startsWith("memory:")),
    byModel,
    reply: text.trim(),
    changes: [...steps.values()].filter((s) => s.label?.startsWith("Writing")).map((s) => s.label.replace("Writing ", "")),
    checks: [...steps.values()].filter((s) => /^(compile|app|test)/.test(s.id)).map((s) => `${s.id}:${s.status}:${s.detail ?? ""}`),
  };
  turns.push(turn);
  const usd = Object.values(byModel).reduce((n, m) => n + m.usd, 0);
  console.log(`\nturn ${i + 1}: ${turn.status} in ${turn.seconds}s, $${usd.toFixed(4)}, first-try ${turn.firstTryClean}, fixes ${fixes}, reads ${turn.reads}, searches ${turn.searches}`);
  console.log(`  ${turn.context ?? ""}`);
  for (const a of access) console.log(`  ${a}`);
  for (const g of turn.guides) console.log(`  ${g}`);
  if (turn.memory) console.log(`  ${turn.memory}`);
  console.log(`  reply: ${turn.reply.slice(0, 300)}`);
  if (error) console.log(`  ERROR: ${error}`);
}

const out = { scenario: scenario.name, base, projectId, cookie: jar.gb_session, uploads, turns, at: new Date().toISOString() };
if (outPath) await writeFile(outPath, JSON.stringify(out, null, 2));
console.log(`\nproject ${projectId}\nworkspace ${base}/p/${projectId}\ncookie gb_session=${jar.gb_session}`);
