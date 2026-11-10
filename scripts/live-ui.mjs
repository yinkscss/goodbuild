// Drives GoodBuild's own website like a person would, in a real browser with a video: prompt the
// builder, watch it build, play the app, ask for a change, and open Publish. Step screenshots land
// next to the video. Needs a server on BASE_URL (default http://localhost:3100).
//   node scripts/live-ui.mjs "A phone game where I catch falling mangoes" "Make it faster every 10 seconds" [--out dir] [--mobile]
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const argv = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] ?? "").startsWith("--out"));
const [prompt = "A phone game where I catch falling mangoes in a basket", change = "Make it get faster every 10 seconds"] = argv;
const outIdx = process.argv.indexOf("--out");
const out = path.resolve(outIdx > 0 ? process.argv[outIdx + 1] : path.join(os.tmpdir(), "goodbuild-live-ui")) // outside the repo: a dev server reloads the page when files in the project change;
const mobile = process.argv.includes("--mobile");
mkdirSync(out, { recursive: true });
const base = process.env.BASE_URL ?? "http://localhost:3100";
const host = new URL(base).hostname;
const jar = {};
async function call(p, init = {}) {
  const r = await fetch(base + p, { ...init, headers: { ...(init.headers ?? {}), cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") } });
  for (const c of r.headers.getSetCookie()) { const [k, ...v] = c.split(";")[0].split("="); if (v.join("=")) jar[k] = v.join("="); }
  return r;
}
// A throwaway wallet signs in; nothing real is touched.
const wallet = privateKeyToAccount(generatePrivateKey());
const { nonce } = await (await call("/api/auth/nonce")).json();
const message = createSiweMessage({ address: wallet.address, chainId: 11142220, domain: new URL(base).host, uri: base, version: "1", nonce, issuedAt: new Date() });
const signed = await call("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature: await wallet.signMessage({ message }), walletKind: "external", attestation: { ageOk: true, notUsPerson: true } }) });
if (!signed.ok) throw new Error(`sign-in failed: ${signed.status}`);

const viewport = mobile ? { width: 420, height: 860 } : { width: 1440, height: 900 };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: !process.argv.includes("--headed"), slowMo: process.argv.includes("--headed") ? 350 : 0, args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-position=40,40"] });
const context = await browser.newContext({ viewport, recordVideo: { dir: path.join(out, "video"), size: viewport } });
await context.addCookies(Object.entries(jar).map(([name, value]) => ({ name, value, domain: host, path: "/" })));
const page = await context.newPage();
const log = [];
page.on("pageerror", (e) => log.push(`page error: ${e.message.slice(0, 200)}`));
let n = 0;
const shot = async (name) => { await page.screenshot({ path: path.join(out, `${String(++n).padStart(2, "0")}-${name}.png`) }); console.log(`step ${n}: ${name}`); };

// The project is created through the API (the home page's Build button is a separate check); the workspace is
// then driven in the browser like a person would.
const json = { "content-type": "application/json" };
const created = await call("/api/projects", { method: "POST", headers: json, body: JSON.stringify({ prompt, network: "celo-sepolia" }) });
if (!created.ok) throw new Error(`couldn't create the project: ${created.status} ${(await created.text()).slice(0, 200)}`);
const projectId = (await created.json()).id;
const state = await (await call(`/api/projects/${projectId}`)).json();
const queued = state.messages.find((m) => m.status === "queued")?.id;
const started = await call(`/api/projects/${projectId}/turns`, { method: "POST", headers: json, body: JSON.stringify({ mode: "build", userMessageId: queued, skipPlan: true }) });
console.log("build started:", started.status);
await page.goto(`${base}/p/${projectId}`);
await page.waitForTimeout(3000);
await shot("workspace-building");

/** Wait until the builder stops: no "stop" control and no streaming message. */
async function settle(label, ms = 600_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await page.waitForTimeout(3000);
    const skip = page.getByText(/Skip, just build it/i).first();
    if (await skip.isVisible().catch(() => false)) { await shot("plan-questions"); await skip.click(); continue; }
    const busy = await page.getByLabel("Stop the build").isVisible().catch(() => false);
    if (!busy && Date.now() - t0 > 8000) break;
  }
  await shot(label);
}
await settle("first-build-done");

// The app in the preview frame.
const frame = page.frameLocator('iframe[title="App preview"]');
await frame.locator("body").waitFor({ timeout: 60_000 }).catch(() => log.push("no preview frame"));
await page.waitForTimeout(4000);
await shot("preview");

// Play it: keys and taps inside the frame.
const canvas = frame.locator("canvas").first();
for (const label of ["play", "start"]) {
  const b = frame.getByRole("button", { name: new RegExp(label, "i") }).first();
  if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
}
for (let i = 0; i < 25; i++) {
  for (const k of ["Space", "ArrowLeft", "ArrowRight"]) { await page.keyboard.press(k).catch(() => {}); await page.waitForTimeout(100); }
  if (await canvas.isVisible().catch(() => false)) await canvas.click({ position: { x: 40 + ((i * 53) % 200), y: 200 }, timeout: 1000 }).catch(() => {});
}
await shot("played");

// Ask for a change in the chat.
const chat = page.locator('section[aria-label="Chat"] textarea').last();
await chat.fill(change);
await shot("change-typed");
await page.keyboard.press("Enter");
await settle("change-done");
await page.waitForTimeout(3000);
await shot("after-change");

// Publish.
const publish = page.getByRole("button", { name: /^Publish/i }).first();
if (await publish.isVisible().catch(() => false)) {
  await publish.click();
  await page.waitForTimeout(3000);
  await shot("publish-opened");
  await page.getByRole("checkbox").first().check().catch(() => log.push("no consent checkbox"));
  await page.getByRole("dialog").getByRole("button", { name: /^Publish$/ }).click().catch(() => log.push("couldn't click Publish in the dialog"));
  await page.waitForTimeout(15_000);
  await shot("publish-result");
  const link = await page.locator('a[href*="://"]').evaluateAll((as) => as.map((a) => a.href).find((h) => new URL(h).hostname.endsWith(`.${new URL(location.href).hostname}`)) ?? null);
  console.log("published address:", link);
  if (link) {
    const live = await context.newPage();
    const res = await live.goto(link, { waitUntil: "load", timeout: 30_000 }).catch((e) => { log.push(`published page: ${e.message.slice(0, 120)}`); return null; });
    await live.waitForTimeout(3000);
    await live.screenshot({ path: path.join(out, `${String(++n).padStart(2, "0")}-published-page.png`) });
    console.log("published page status:", res?.status(), "|", (await live.locator("body").innerText().catch(() => "")).slice(0, 120).replace(/\s+/g, " "));
  } else log.push("no published address found");
} else log.push("no Publish button");

console.log("problems:", log.length ? log.join("; ") : "none");
const v = page.video();
await context.close();
console.log("video:", await v?.path());
await browser.close();
