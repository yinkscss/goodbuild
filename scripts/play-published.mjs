// Opens a published app, plays it for ~20 s with taps, drags and keys, records a video and screenshots.
//   node scripts/play-published.mjs <url> <outdir>
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
const [url, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const vp = { width: 420, height: 860 };
const ctx = await b.newContext({ viewport: vp, hasTouch: true, isMobile: true, recordVideo: { dir: path.join(out, "video"), size: vp } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
await page.goto(url, { waitUntil: "load" }); await page.waitForTimeout(3000);
const stats = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160);
console.log("before:", await stats());
console.log("canvases:", await page.locator("canvas").count(), "buttons:", await page.locator("button:visible").evaluateAll((e) => e.map((x) => x.innerText.trim() || x.ariaLabel)));
await page.screenshot({ path: path.join(out, "a-open.png") });
for (const label of ["Play", "Start", "Begin", "New game"]) {
  const btn = page.getByRole("button", { name: new RegExp(`^${label}`, "i") }).first();
  if (await btn.isVisible().catch(() => false)) { await btn.evaluate((el) => el.click()); console.log("pressed", label, "(via script: the GoodBuild bar covers it)"); break; }
}
await page.waitForTimeout(1000);
const c = page.locator("canvas").first();
const box = (await c.boundingBox()) ?? { x: 0, y: 150, width: 420, height: 600 };
for (let i = 0; i < 40; i++) {
  const x = box.x + 30 + ((i * 67) % (box.width - 60));
  await page.touchscreen.tap(x, box.y + box.height - 60).catch(() => {});
  await page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight").catch(() => {});
  await page.waitForTimeout(450);
  if (i === 10) await page.screenshot({ path: path.join(out, "b-playing.png") });
}
await page.screenshot({ path: path.join(out, "c-after.png") });
console.log("after:", await stats());
console.log("errors:", errs.length ? errs.join(" | ") : "none");
await ctx.close(); await b.close();
