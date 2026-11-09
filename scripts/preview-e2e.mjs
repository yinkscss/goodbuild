// End-to-end check of GoodBuild's own preview (D69) against a running server, in a real browser.
// Usage: GOODBUILD_DEMO_MODEL=1 pnpm dev --port 3311, then
//        BASE_URL=http://localhost:3311 [OUT=dir-for-screenshots] node scripts/preview-e2e.mjs
// It signs in a throwaway wallet, builds the demo app, and checks three things in the workspace:
// the own build when the owner asks for it, Sandpack by default, and the automatic switch to the
// own build when CodeSandbox can't be reached.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const base = process.env.BASE_URL ?? "http://localhost:3311";
const out = process.env.OUT ?? "";
if (out) mkdirSync(out, { recursive: true });
const jar = {};
async function call(p, init = {}) {
  const res = await fetch(base + p, { ...init, headers: { ...(init.headers ?? {}), cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") } });
  for (const c of res.headers.getSetCookie()) {
    const [k, ...v] = c.split(";")[0].split("=");
    if (v.join("=")) jar[k] = v.join("=");
  }
  return res;
}
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const json = { "content-type": "application/json" };

// Sign in.
const account = privateKeyToAccount(generatePrivateKey());
const { nonce } = await (await call("/api/auth/nonce")).json();
const message = createSiweMessage({ address: account.address, chainId: 11142220, domain: new URL(base).host, uri: base, version: "1", nonce, issuedAt: new Date() });
const signed = await call("/api/auth/verify", { method: "POST", headers: json, body: JSON.stringify({ message, signature: await account.signMessage({ message }), walletKind: "external", attestation: { ageOk: true, notUsPerson: true } }) });
if (!signed.ok) throw new Error(`sign-in failed: ${signed.status} ${await signed.text()}`);

// A project with a built app (the demo model: questions first, then the scripted build).
const projectId = (await (await call("/api/projects", { method: "POST", headers: json, body: JSON.stringify({ prompt: "A tip jar for our football club", network: "celo-sepolia" }) })).json()).id;
const state = async () => (await call(`/api/projects/${projectId}`)).json();
const idle = async () => {
  for (let i = 0; i < 120; i++) {
    const s = await state();
    if (!s.jobs?.length && !s.messages.some((m) => ["queued", "streaming"].includes(m.status))) return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("the build didn't finish in 2 minutes");
};
const queued = (await state()).messages.find((m) => m.status === "queued")?.id;
if (queued) await call(`/api/projects/${projectId}/turns`, { method: "POST", headers: json, body: JSON.stringify({ mode: "build", userMessageId: queued }) });
let s = await idle();
// The first turn only asks the plan's questions (D32); the build is the next one.
if (!s.project.currentVersion) {
  const res = await call(`/api/projects/${projectId}/turns`, { method: "POST", headers: json, body: JSON.stringify({ mode: "build", prompt: "Start building" }) });
  if (res.status !== 202) console.log(`build turn: ${res.status} ${await res.text()}`);
  s = await idle();
}
check("the demo app was built", s.project.currentVersion > 0, `${Object.keys(s.files ?? {}).length} files, version ${s.project.currentVersion}, last message: ${s.messages.at(-1)?.status}`);
if (!s.project.currentVersion) process.exit(1);

// The build endpoint.
const first = await call(`/api/projects/${projectId}/preview`, { method: "POST" });
const info = await first.json();
check("POST /preview builds and returns a preview host", first.ok && /^http:\/\/pv-[0-9a-f]{32}\./.test(info.origin ?? ""), `${first.status} ${info.origin}`);
const again = await (await call(`/api/projects/${projectId}/preview`, { method: "POST" })).json();
check("the same files reuse the build", again.rebuilt === false && again.buildId === info.buildId);
const page0 = await fetch(info.url);
check("the preview host serves the app, framed only by the workspace", page0.ok && (page0.headers.get("content-security-policy") ?? "").includes(`frame-ancestors ${base}`), page0.headers.get("content-security-policy")?.split(";").at(-1)?.trim());
check("a stranger can't build someone else's preview", (await fetch(`${base}/api/projects/${projectId}/preview`, { method: "POST" })).status === 401);
check("the main host doesn't serve preview files", (await fetch(`${base}/preview-app/${new URL(info.origin).hostname.slice(3, 35)}`)).status === 404);

// The workspace, in a real browser.
const browser = await chromium.launch({ headless: true });
const host = new URL(base).hostname;
const cookies = Object.entries(jar).map(([name, value]) => ({ name, value, domain: host, path: "/" }));
async function open(query, { blockSandpack = false, wait = 15_000 } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(cookies);
  if (blockSandpack) await context.route(/codesandbox\.io|csb\.app|jsdelivr\.net/, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${base}/p/${projectId}${query}`);
  const frame = page.locator('iframe[title="App preview"]');
  const shown = await frame.waitFor({ state: "attached", timeout: wait }).then(() => true, () => false);
  let text = "";
  if (shown) {
    const inner = page.frameLocator('iframe[title="App preview"]');
    await inner.locator("#root > *").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    text = (await inner.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 120);
    // The cover goes once the app says it is up.
    await page.getByText("Starting the preview").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
  }
  return { context, page, shown, text, src: shown ? await frame.getAttribute("src") : null };
}

let r = await open("?preview=own");
check("with ?preview=own the workspace frames the own build", r.shown && (r.src ?? "").startsWith(info.origin), r.src);
check("the app renders inside it", r.text.length > 0, r.text);
check("the cover is gone once the app is up", !(await r.page.getByText("Starting the preview").isVisible()));
if (out) await r.page.screenshot({ path: path.join(out, "own-build.png") });
await r.page.getByLabel("Mobile").click();
await r.page.waitForTimeout(400);
if (out) await r.page.screenshot({ path: path.join(out, "own-build-mobile.png") });
await r.page.getByLabel("Refresh preview").click();
await r.page.waitForTimeout(1500);
check("refresh reloads the same build", (await r.page.locator('iframe[title="App preview"]').getAttribute("src")) === r.src);
await r.context.close();

r = await open("?preview=auto", { wait: 6_000 });
check("by default an ordinary project stays on Sandpack", !r.shown);
await r.context.close();

r = await open("?preview=auto", { blockSandpack: true, wait: 40_000 });
check("when CodeSandbox can't be reached, the workspace switches to the own build by itself", r.shown && r.text.length > 0, r.text);
if (out) await r.page.screenshot({ path: path.join(out, "fallback.png") });
await r.context.close();

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
