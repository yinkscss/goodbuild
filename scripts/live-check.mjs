// Live check: builds real apps with real model keys, then opens each built app in a browser,
// plays it, and records a video. Run it before merging, so a break shows up here and not in production.
//
//   node scripts/live-check.mjs                    asks for the two keys (hidden) if they aren't saved yet
//   node scripts/live-check.mjs --only game-runner,minipay-shop
//   node scripts/live-check.mjs --budget 25        most it may spend, in dollars (default 20)
//   node scripts/live-check.mjs --skip-build       reuse the last `pnpm build`
//   node scripts/live-check.mjs --demo            test the runner itself with the scripted demo model (free)
//   node scripts/live-check.mjs --headed           show the browser while it plays
//
// Results go to docs/evals/live/runs/<time>/: report.md, results.json, a video and screenshots per app.
// It starts its own throwaway server (in-memory database, port 3100) and stops it at the end.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const option = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const port = Number(option("port", "3100"));
const budget = Number(option("budget", "20"));
const only = option("only", "").split(",").filter(Boolean);
const concurrency = Math.max(1, Number(option("concurrency", "2")));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.resolve(option("out", `docs/evals/live/runs/${stamp}`));
mkdirSync(outDir, { recursive: true });
const base = `http://localhost:${port}`;
process.env.BASE_URL = base;
// Imported after BASE_URL is set: the suite reads it when it loads.
const { session, signIn, runTurn, verdict, summarise } = await import("./eval-suite.mjs");
const json = { "content-type": "application/json" };

// 1. Keys: read .env.local, ask (hidden) for what's missing. The values are never printed.
function envFile() {
  const f = path.resolve(".env.local");
  const out = {};
  if (existsSync(f)) for (const l of readFileSync(f, "utf8").split("\n")) { const m = l.match(/^([A-Z][A-Z0-9_]*)=(.*)$/); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
  return out;
}
const demo = flag("demo"); // plumbing test with the scripted demo model: no keys, no cost, always the same app
for (const name of demo ? [] : ["ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"]) {
  if (process.env[name] || envFile()[name]) continue;
  console.log(`\n${name} isn't saved yet.`);
  const r = spawnSync("node", ["scripts/set-secret.mjs", name], { stdio: "inherit" });
  if (r.status !== 0 || !envFile()[name]) { console.error(`No ${name}; nothing was run.`); process.exit(1); }
}
const keys = envFile();
const serverEnv = {
  ...process.env,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? keys.ANTHROPIC_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? keys.DEEPSEEK_API_KEY,
  ALLOW_PGLITE: "true",
  SESSION_SECRET: "live-check-only-session-secret-0123456789abcdef",
  APP_DOMAIN: `localhost:${port}`,
  PUBLISHED_APPS_DOMAIN: "localhost",
  RUN_CHECK: process.env.RUN_CHECK ?? "1",
  TYPE_CHECK: "warn",
  UNVERIFIED_CAP_MICRO: "3000000",
  FREE_AI_BUDGET_MICRO: String(Math.round(budget * 1e6)),
  TURN_CONCURRENCY: String(concurrency),
  PORT: String(port),
};
if (demo) { serverEnv.GOODBUILD_DEMO_MODEL = "1"; serverEnv.GOODBUILD_DEMO_MODEL_IN_PROD = "true"; }
else delete serverEnv.GOODBUILD_DEMO_MODEL;

// The browser has to exist before anything is spent.
const chromePath = process.env.CHROME_PATH || undefined;
if (!chromePath && !existsSync(chromium.executablePath())) {
  console.error("The headless browser isn't installed. Run this once, then run the check again:\n\n  node node_modules/playwright-core/cli.js install chromium-headless-shell\n");
  process.exit(1);
}

// 2. Build and start the server.
const sh = (cmd, a, opt = {}) => spawnSync(cmd, a, { stdio: "inherit", env: serverEnv, ...opt });
if (!flag("skip-build") && !demo) {
  console.log("building (pnpm build)…");
  if (sh("pnpm", ["build"]).status !== 0) { console.error("The build failed; nothing was run."); process.exit(1); }
}
const logFile = path.join(outDir, "server.log");
const logChunks = [];
if (await fetch(`${base}/api/auth/nonce`).then(() => true).catch(() => false)) {
  console.error(`Something is already running on port ${port}. Stop it or pass --port.`);
  process.exit(1);
}
const server = spawn("pnpm", [demo ? "dev" : "start", "-p", String(port)], { env: serverEnv, detached: true });
server.stdout.on("data", (d) => logChunks.push(d));
server.stderr.on("data", (d) => logChunks.push(d));
const stop = () => { try { process.kill(-server.pid, "SIGTERM"); } catch {} writeFileSync(logFile, Buffer.concat(logChunks)); };
process.on("SIGINT", () => { stop(); process.exit(130); });
for (let i = 0; ; i++) {
  if (i > (demo ? 120 : 60)) { stop(); console.error("The server didn't start; see server.log."); process.exit(1); }
  if (await fetch(`${base}/api/auth/nonce`).then((r) => r.ok).catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`server up on ${base}; spending at most $${budget}`);

// 3. A MiniPay-style wallet: what MiniPay injects, answered with fixed values. It proves the app
// reads the wallet the MiniPay way; it does not prove MiniPay's own app accepts the page.
const MINIPAY_SCRIPT = `(() => {
  const addr = "0x1111111111111111111111111111111111111111";
  const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
  window.__sent = [];
  window.ethereum = {
    isMiniPay: true, isMetaMask: false,
    request: async ({ method, params }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [addr];
      if (method === "eth_chainId") return "0xaa044c";
      if (method === "net_version") return "11142220";
      if (method === "eth_getBalance") return "0x" + (5n * 10n ** 18n).toString(16);
      if (method === "eth_call") return word(5n * 10n ** 18n);
      if (method === "eth_blockNumber") return "0x100";
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_gasPrice") return "0x3b9aca00";
      if (method === "eth_sendTransaction") { window.__sent.push(params?.[0]); return "0x" + "ab".repeat(32); }
      if (method === "eth_getTransactionReceipt") return { status: "0x1", blockNumber: "0x101", transactionHash: "0x" + "ab".repeat(32), logs: [] };
      if (method === "personal_sign" || method === "eth_signTypedData_v4") { window.__signed = true; throw new Error("MiniPay does not sign messages"); }
      return null;
    },
    on() {}, removeListener() {},
  };
})();`;

// 4. Play the built app and record it.
async function playApp(browser, scenario, previewUrl) {
  const mobile = scenario.viewport === "mobile";
  const viewport = mobile ? { width: 390, height: 780 } : { width: 1280, height: 800 };
  const videoDir = path.join(outDir, `${scenario.id}-video`);
  const context = await browser.newContext({ viewport, recordVideo: { dir: videoDir, size: viewport }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  if (scenario.minipay) await context.addInitScript(MINIPAY_SCRIPT);
  const page = await context.newPage();
  const problems = [];
  const notes = [];
  page.on("pageerror", (e) => problems.push(`page error: ${String(e.message).slice(0, 160)}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR/.test(m.text())) problems.push(`console error: ${m.text().slice(0, 160)}`); });
  const shot = (n) => page.screenshot({ path: path.join(outDir, `${scenario.id}-${n}.png`) }).catch(() => {});
  try {
    await page.goto(previewUrl, { waitUntil: "load", timeout: 30_000 });
    await page.waitForTimeout(3000);
    const text = (await page.locator("body").innerText().catch(() => "")).trim();
    const hasCanvas = (await page.locator("canvas").count()) > 0;
    if (/Your app is being written/i.test(text)) problems.push("the starter page is showing");
    if (!text && !hasCanvas) problems.push("the page is blank");
    if (/Something went wrong|Application error|Cannot read properties/i.test(text)) problems.push("the page shows an error");
    await shot("1-open");
    if (scenario.minipay) {
      if (/connect wallet|sign in|log ?in|sign message/i.test(text)) problems.push("MiniPay opens the app but it still asks to connect or sign in");
      notes.push("opened with a MiniPay-style wallet");
    }
    if (hasCanvas) notes.push("has a canvas");
    if (scenario.play === "game") {
      const box = (await page.locator("canvas").first().boundingBox().catch(() => null)) ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      for (const label of ["play", "start", "begin", "new game"]) {
        const b = page.getByRole("button", { name: new RegExp(label, "i") }).first();
        if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 2000 }).catch(() => {}); break; }
      }
      const t0 = Date.now();
      while (Date.now() - t0 < 14_000) {
        for (const k of ["Space", "ArrowRight", "ArrowLeft", "ArrowUp", "KeyD", "KeyA"]) { await page.keyboard.press(k).catch(() => {}); await page.waitForTimeout(120); }
        await page.mouse.click(cx + (Math.random() - 0.5) * box.width * 0.6, cy + (Math.random() - 0.5) * box.height * 0.4).catch(() => {});
        await page.mouse.move(cx - 80, cy); await page.mouse.down(); await page.mouse.move(cx + 80, cy + 20, { steps: 6 }); await page.mouse.up();
      }
      await shot("2-played");
      const after = (await page.locator("body").innerText().catch(() => "")).trim();
      if (after && after === text && !hasCanvas) notes.push("nothing on the page changed while playing");
    } else {
      const fields = page.locator("input:visible, textarea:visible");
      for (let i = 0; i < Math.min(await fields.count(), 4); i++) {
        const f = fields.nth(i);
        const type = (await f.getAttribute("type")) ?? "text";
        await f.fill(type === "number" ? "5" : "hello from the live check").catch(() => {});
      }
      const buttons = page.locator("button:visible");
      const n = Math.min(await buttons.count(), 8);
      for (let i = 0; i < n; i++) {
        await buttons.nth(i).click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(700);
      }
      await page.mouse.wheel(0, 900); await page.waitForTimeout(500);
      await shot("2-used");
      if (scenario.minipay) {
        const sent = await page.evaluate(() => window.__sent ?? []).catch(() => []);
        const signed = await page.evaluate(() => !!window.__signed).catch(() => false);
        if (signed) problems.push("the app asked MiniPay to sign a message, which MiniPay doesn't allow");
        for (const tx of sent) {
          if (tx?.type && tx.type !== "0x0") problems.push(`a payment used transaction type ${tx.type}; MiniPay needs a legacy one`);
          if (tx?.maxFeePerGas) problems.push("a payment set maxFeePerGas; MiniPay needs a legacy gas price");
        }
        notes.push(`${sent.length} payment(s) sent to the wallet`);
      }
    }
  } catch (e) {
    problems.push(`couldn't play it: ${String(e.message).slice(0, 160)}`);
  }
  const video = page.video();
  await context.close();
  let videoFile = null;
  try { const p = await video?.path(); if (p) { videoFile = `${scenario.id}.webm`; renameSync(p, path.join(outDir, videoFile)); } } catch {}
  return { problems: [...new Set(problems)], notes, video: videoFile };
}

async function runOne(browser, scenario) {
  const call = session();
  const turns = [];
  try {
    await signIn(call);
    const created = await call("/api/projects", { method: "POST", headers: json, body: JSON.stringify({ prompt: scenario.turns[0], network: "celo-sepolia" }) });
    if (!created.ok) throw new Error(`couldn't create the project: ${created.status} ${(await created.text()).slice(0, 200)}`);
    const projectId = (await created.json()).id;
    for (const u of scenario.uploads ?? []) {
      const body = new FormData();
      body.set("file", new Blob([readFileSync(u.file)]), path.basename(u.file));
      body.set("kind", u.kind);
      const res = await call(`/api/projects/${projectId}/assets`, { method: "POST", body });
      if (!res.ok) throw new Error(`upload of ${u.file} failed: ${res.status} ${(await res.text()).slice(0, 160)}`);
    }
    const state = await (await call(`/api/projects/${projectId}`)).json();
    const queued = state.messages.find((m) => m.status === "queued")?.id;
    for (const [i, prompt] of scenario.turns.entries()) {
      const body = i === 0 && queued ? { mode: "build", userMessageId: queued, skipPlan: true } : { mode: "build", prompt, skipPlan: true };
      turns.push(await runTurn(call, projectId, body, prompt));
      if (turns.at(-1).status === "error") break;
    }
    let failure = verdict(scenario.kind, turns);
    let played = null;
    if (!failure && scenario.kind !== "refuse") {
      const res = await call(`/api/projects/${projectId}/preview`, { method: "POST" });
      const info = await res.json().catch(() => ({}));
      if (!res.ok || !info.url) failure = `the preview didn't build: ${res.status} ${JSON.stringify(info).slice(0, 160)}`;
      else {
        played = await playApp(browser, scenario, info.url);
        if (played.problems.length) failure = `played: ${played.problems.join("; ")}`;
      }
    }
    return { id: scenario.id, kind: scenario.kind, projectId, pass: !failure, failure, turns, played };
  } catch (error) {
    return { id: scenario.id, kind: scenario.kind, pass: false, failure: String(error?.message ?? error), turns };
  }
}

const suite = JSON.parse(readFileSync("docs/evals/live/scenarios.json", "utf8"));
const scenarios = suite.scenarios.filter((s) => !only.length || only.includes(s.id));
const browser = await chromium.launch({ headless: !flag("headed"), executablePath: chromePath, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"] });
const results = new Array(scenarios.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, scenarios.length) }, async () => {
  while (next < scenarios.length) {
    const i = next++;
    const r = await runOne(browser, scenarios[i]);
    results[i] = r;
    const usd = r.turns.reduce((n, t) => n + t.usd, 0);
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  $${usd.toFixed(3)}${r.failure ? `  ${r.failure}` : ""}${r.played?.video ? `  video: ${r.played.video}` : ""}`);
  }
}));
await browser.close();
stop();

const summary = summarise(results);
const lines = [`# Live check ${stamp}`, "", `${summary.passed} of ${summary.scenarios} passed. Cost $${summary.usd.toFixed(2)} of $${budget}. Fix attempts ${summary.fixAttempts}. Clean first try ${Math.round(summary.firstTryRate * 100)}%.`, "",
  "| App | Result | Fixes | Cost | What happened | Video |", "|---|---|---|---|---|---|"];
for (const r of results) {
  lines.push(`| ${r.id} | ${r.pass ? "pass" : "**fail**"} | ${r.turns.reduce((n, t) => n + t.fixAttempts, 0)} | $${r.turns.reduce((n, t) => n + t.usd, 0).toFixed(3)} | ${(r.failure ?? r.played?.notes?.join(", ") ?? "").replace(/\|/g, "/").slice(0, 160)} | ${r.played?.video ?? ""} |`);
}
lines.push("", "MiniPay scenarios use a stand-in wallet that answers like MiniPay. They do not replace opening the app in the real MiniPay app (Developer Mode).");
writeFileSync(path.join(outDir, "report.md"), lines.join("\n") + "\n");
writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ at: new Date().toISOString(), summary, results }, null, 2));
console.log(`\n${lines.join("\n")}\n\nEverything is in ${outDir}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
