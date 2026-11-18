// @vitest-environment node
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";

import { playAgain } from "../game-check";
import { closeRunCheckBrowser, runCheck } from "../run-check";
import { starterFiles } from "../template";
import { gameTemplateById, withGameTemplate } from "./index";

// This wall-clock benchmark must run in its own invocation, after the functional suite.
// Otherwise other workers' compilers, databases and browsers compete with the throttled page.
const hasBrowser = Boolean(process.env.CI) || (await chromium.launch({ headless: true })
  .then((browser) => browser.close().then(() => true)).catch(() => false));
const built = (id: string) => withGameTemplate(starterFiles(), gameTemplateById(id)!);

describe("isolated game frame-rate benchmark", { timeout: 180_000 }, () => {
  afterAll(() => closeRunCheckBrowser());

  // A cheap phone: a touch screen and a CPU four times slower. The game must still play, post and keep up (D118).
  it.skipIf(!hasBrowser)("Catch and dodge: plays with no issues on a slow touch phone, at full frame rate", async () => {
    let p95 = Infinity;
    let sampleCount = 0;
    const r = await runCheck(built("catch-dodge"), {
      phone: { cpuSlowdown: 4 },
      initScript: "(() => { const d = []; let last = 0; const f = (t) => { if (last) d.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); window.__frameTimes = d; })();",
      afterPlay: async (page) => {
        // Measure a round being played, not the game-over screen: the same round must run from start to end
        // of the sample. Two tries only if a round ends; never retry to improve a measured p95.
        const live = () => page.evaluate(() => { const r = (window as unknown as { __gbGame?: { rounds: { end?: number }[] } }).__gbGame?.rounds ?? []; return r.length && r[r.length - 1].end === undefined ? r.length : 0; });
        for (let attempt = 0; attempt < 2; attempt++) {
          if (!(await live()) && !(await playAgain(page))) return;
          const round = await live();
          if (!round) return;
          await page.evaluate(() => { (window as unknown as { __frameTimes: number[] }).__frameTimes.length = 0; });
          await page.waitForTimeout(1_500);
          const sampled = await page.evaluate(() => { const d = [...(window as unknown as { __frameTimes: number[] }).__frameTimes].sort((a, b) => a - b); return { p95: d[Math.floor(d.length * 0.95)] ?? Infinity, count: d.length }; });
          if ((await live()) === round) {
            p95 = sampled.p95;
            sampleCount = sampled.count;
            return;
          }
        }
      },
    });
    console.info("Slow-phone frame rate", { p95Ms: p95, sampleCount, cpuSlowdown: 4, platform: process.platform, arch: process.arch });
    expect(r.issues).toEqual([]);
    // Not "a score was posted": with the CPU slowed, a round may not end in the window.
    expect(r.note).toMatch(/played \d+ rounds?/);
    expect(sampleCount).toBeGreaterThanOrEqual(30);
    expect(p95).toBeLessThan(34);
  });
});
