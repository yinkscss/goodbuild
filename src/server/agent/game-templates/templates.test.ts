// @vitest-environment node
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";

import { checkApp, checkContracts } from "../checks";
import { kitById, kitIdsOf, withKit } from "../kits/index";
import { playAgain } from "../game-check";
import { closeRunCheckBrowser, runCheck } from "../run-check";
import { PLATFORM_DIR, contractModule, contractsIndex, starterFiles } from "../template";
import { typeCheck } from "../type-check";

import { GAME_TEMPLATES, gameTemplateById, gameTemplateCatalog, withGameTemplate } from "./index";

const hasBrowser =
  Boolean(process.env.CI) ||
  (await chromium
    .launch({ headless: true })
    .then((b) => b.close().then(() => true))
    .catch(() => false));

/** Whether the browser here can draw WebGL: without it a 3D game is left unplayed (and the check says so). */
const hasWebGL =
  hasBrowser &&
  (await chromium
    .launch({ headless: true })
    .then(async (b) => {
      const page = await b.newPage();
      const ok = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl")));
      await b.close();
      return ok;
    })
    .catch(() => false));

const built = (id: string, change?: (files: Record<string, string>) => Record<string, string>) => {
  const files = withGameTemplate(starterFiles(), gameTemplateById(id)!);
  return change ? change(files) : files;
};
const edit = (path: string, from: string | RegExp, to: string) => (files: Record<string, string>) => {
  const next = files[path].replace(from, to);
  expect(next, `${path} changed`).not.toEqual(files[path]);
  return { ...files, [path]: next };
};

describe("game templates (D114)", { timeout: 180_000 }, () => {
  afterAll(() => closeRunCheckBrowser());

  it("are original, named for how they play, and listed for the planner", () => {
    expect(new Set(GAME_TEMPLATES.map((t) => t.id)).size).toBe(GAME_TEMPLATES.length);
    for (const t of GAME_TEMPLATES) expect(gameTemplateCatalog()).toContain(`- ${t.id} (`);
    // No existing game's name in any template.
    const all = GAME_TEMPLATES.flatMap((t) => Object.values(t.files)).join("\n");
    expect(all).not.toMatch(/\b(tetris|flappy|pac-?man|mario|sonic|candy crush|subway surfers|temple run|angry birds|kahoot|breakout|arkanoid|bejeweled|mario kart|helicopter game)\b/i);
  });

  it("turn their kits on, write their files and add the leaderboard's rule, leaving other rules alone", () => {
    const start = { ...starterFiles(), "src/lib/dataRules.json": JSON.stringify({ collections: { notes: "owner-only" } }) };
    const files = withGameTemplate(start, gameTemplateById("lane-racer")!);
    expect(kitIdsOf(files)).toContain("game-2d");
    expect(files["src/play/Game.tsx"]).toContain("declareGame");
    const rules = JSON.parse(files["src/lib/dataRules.json"]);
    expect(rules.collections.notes).toBe("owner-only");
    expect(rules.collections.scores).toBeTruthy();
  });

  for (const t of GAME_TEMPLATES) {
    it(`${t.name}: passes the app check and the type check as shipped`, async () => {
      const files = built(t.id);
      expect(checkApp(files).errors).toEqual([]);
      const types = await typeCheck(files);
      expect(types.ran).toBe(true);
      expect(types.issues).toEqual([]);
    });

    it.skipIf(!hasBrowser || (t.dims === "3d" && !hasWebGL))(`${t.name}: is played by the run check with no issues, leaderboard posting included`, async () => {
      const r = await runCheck(built(t.id));
      expect(r.ran).toBe(true);
      expect(r.issues).toEqual([]);
      expect(r.note).toMatch(/played \d+ rounds?/);
      expect(r.note).toMatch(/a score was posted and shown on the board/);
    });
  }

  it.skipIf(!hasBrowser)("Lane racer: every kind it declares is seen, and a copy that never spawns oil is caught", async () => {
    const ok = await runCheck(built("lane-racer"));
    expect(ok.note).toMatch(/saw .*slowCar.*/);
    for (const kind of ["slowCar", "oncoming", "rival", "oil", "nitro", "shield"]) expect(ok.note).toContain(kind);
    // The bot often crashes before a round lasts 15 seconds, and then the check says it couldn't judge: never a false "fine".
    const noOil = await runCheck(built("lane-racer", edit("src/play/Game.tsx", /\n\s*spawned\("oil"\);/, "")));
    const said = noOil.issues.map((i) => i.message).join(" ") + " " + noOil.note;
    expect(said).toMatch(/never appeared in the first 15: "oil"|not long enough to judge oil/);
    expect(/saw ([^;(]*)/.exec(noOil.note)?.[1] ?? "").not.toMatch(/\boil\b/);
  });

  // A cheap phone: a touch screen and a CPU four times slower. The game must still play, post and keep up (D118).
  it.skipIf(!hasBrowser)("Catch and dodge: plays with no issues on a slow touch phone, at full frame rate", async () => {
    let p95 = Infinity;
    const r = await runCheck(built("catch-dodge"), {
      phone: { cpuSlowdown: 4 },
      initScript: "(() => { const d = []; let last = 0; const f = (t) => { if (last) d.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); window.__frameTimes = d; })();",
      afterPlay: async (page) => {
        // Measure a round being played, not the game-over screen: start one if the last has ended.
        const playing = () => page.evaluate(() => (window as unknown as { __gbGame?: { rounds: { end?: number }[] } }).__gbGame?.rounds.at(-1)?.end === undefined);
        if (!(await playing()) && !(await playAgain(page))) return;
        if (!(await playing())) return;
        await page.evaluate(() => { (window as unknown as { __frameTimes: number[] }).__frameTimes.length = 0; });
        await page.waitForTimeout(1_500);
        p95 = await page.evaluate(() => { const d = [...(window as unknown as { __frameTimes: number[] }).__frameTimes].sort((a, b) => a - b); return d[Math.floor(d.length * 0.95)] ?? Infinity; });
      },
    });
    expect(r.issues).toEqual([]);
    // Not "a score was posted": with the CPU slowed and other tests running, a round may not end in the window.
    expect(r.note).toMatch(/played \d+ rounds?/);
    expect(p95).toBeLessThan(34);
  });

  // Older phones (iOS 15 Safari) have no canvas roundRect: the score panel must not crash the game there.
  it.skipIf(!hasBrowser)("Catch and dodge: plays with no issues on a browser without canvas roundRect", async () => {
    const r = await runCheck(built("catch-dodge"), { initScript: "delete CanvasRenderingContext2D.prototype.roundRect;" });
    expect(r.issues).toEqual([]);
    expect(r.note).toMatch(/played \d+ rounds?/);
  });

  it.skipIf(!hasBrowser)("Lane racer: a copy whose steering does nothing is caught", async () => {
    const stuck = await runCheck(built("lane-racer", edit("src/play/Game.tsx", "g.x += (LANES[g.lane] - g.x) * Math.min(1, dt * 12);", "")));
    expect(stuck.issues.map((i) => i.message).join(" ")).toMatch(/never moved the player/);
  });

  it.skipIf(!hasBrowser)("Quick quiz: judged as a turns game by its answers, and a copy whose answers do nothing is caught", async () => {
    const ok = await runCheck(built("quick-quiz"));
    expect(ok.note).toMatch(/turns game, \d+ moves/);
    const dead = await runCheck(built("quick-quiz", edit("src/play/Game.tsx", "onClick={() => answer(i)}", "onClick={() => undefined}")));
    expect(dead.issues.map((i) => i.message).join(" ")).toMatch(/never accepted a move/);
  });

  // D117: one broken copy per kind of control the new templates add, so the check is shown to catch each.
  it.skipIf(!hasBrowser)("Match grid: judged as a puzzle by its taps, and a copy whose tiles do nothing is caught", async () => {
    const ok = await runCheck(built("match-grid"));
    expect(ok.note).toMatch(/puzzle game, \d+ moves/);
    const dead = await runCheck(built("match-grid", edit("src/play/Game.tsx", "onClick={() => tap(i)}", "onClick={() => undefined}")));
    expect(dead.issues.map((i) => i.message).join(" ")).toMatch(/never accepted a move/);
  });

  it.skipIf(!hasBrowser)("Catch and dodge: a copy whose basket never follows the player is caught", async () => {
    const stuck = await runCheck(built("catch-dodge", (f) => edit("src/play/Game.tsx", "    if (keys) g.x = g.target;\n", "")(edit("src/play/Game.tsx", "g.x += (g.target - g.x) * Math.min(1, dt * 14);", "")(f))));
    expect(stuck.issues.map((i) => i.message).join(" ")).toMatch(/never moved the player/);
  });

  it.skipIf(!hasBrowser)("Brick breaker: a copy whose paddle never follows the player is caught", async () => {
    const stuck = await runCheck(built("brick-breaker", (f) => edit("src/play/Game.tsx", "    if (keys) g.x = g.target;\n", "")(edit("src/play/Game.tsx", "g.x += (g.target - g.x) * Math.min(1, dt * 16);", "")(f))));
    expect(stuck.issues.map((i) => i.message).join(" ")).toMatch(/never moved the player/);
  });

  // Cave flyer moves the player by itself (gravity), so "the player moved" proves nothing there: the check holds
  // one input, then the opposite, and sees whether the movement follows (D118). Not Kart track: its kart moves by
  // itself only when it hits a tyre wall, too rarely for the check to see in a moment (OPEN_QUESTIONS.md Q46).
  it.skipIf(!hasBrowser)("Cave flyer: a copy whose hold does nothing is caught, though gravity still moves the craft", async () => {
    const dead = await runCheck(built("cave-flyer", edit("src/play/Game.tsx", "g.vy += (climbing ? -1500 : 900) * dt;", "g.vy += 900 * dt;")));
    // Under heavy load the rounds can end before the check gets a clean stretch: then it says so, never "fine" in silence.
    expect(dead.issues.map((i) => i.message).join(" ") + " " + dead.note).toMatch(/the hold does nothing|the controls weren't judged/);
  });

  it.skipIf(!hasBrowser)("Cave flyer: with a probe that doesn't say where the player is (one from before D118), the controls aren't judged", async () => {
    const old = (files: Record<string, string>) => edit("src/game/probe.ts", "  c.at = { x, y, round: c.rounds.length };\n", "")(files);
    const dead = await runCheck(built("cave-flyer", (f) => old(edit("src/play/Game.tsx", "g.vy += (climbing ? -1500 : 900) * dt;", "g.vy += 900 * dt;")(f))));
    // It must have run: a check that didn't run has no issues either.
    expect(dead.ran).toBe(true);
    expect(dead.note).toMatch(/played \d+ rounds?/);
    expect(dead.issues).toEqual([]);
  });

  it.skipIf(!hasBrowser || !hasWebGL)("Sky rings: a copy whose steering does nothing is caught", async () => {
    const stuck = await runCheck(built("sky-rings", edit("src/play/Game.tsx", "g.x += dx;\n              g.y += dy;", "")));
    expect(stuck.issues.map((i) => i.message).join(" ")).toMatch(/never moved the player/);
  });

  it.skipIf(!hasBrowser || !hasWebGL)("Maze escape: a copy whose swipes and keys never take a step is caught", async () => {
    const stuck = await runCheck(built("maze-escape", edit("src/play/Game.tsx", "              g.x = x;\n              g.z = z;\n", "")));
    expect(stuck.issues.map((i) => i.message).join(" ")).toMatch(/never moved the player/);
  });
});

describe("game templates in MiniPay (D114)", { timeout: 180_000 }, () => {
  for (const id of GAME_TEMPLATES.map((t) => t.id)) {
    it(`${id}: with the MiniPay and board kits, the pages, footer and board contract are wired, and it type-checks`, async () => {
      let files = withKit(withKit(withKit(starterFiles(), kitById("game-2d")!), kitById("mini-app")!), kitById("game-board")!);
      files = withGameTemplate(files, gameTemplateById(id)!);
      const report = await checkContracts(files);
      expect(report.errors).toEqual([]);
      for (const c of report.contracts) files[`${PLATFORM_DIR}${c.name}.ts`] = contractModule(c.name, c.abi, { 11142220: "0x00000000000000000000000000000000000000b0" });
      files[`${PLATFORM_DIR}index.ts`] = contractsIndex(report.contracts.map((c) => c.name));
      // MINI_APP's wording is the person's, filled in by the builder; everything else passes.
      expect(checkApp(files).errors.filter((e) => e.file !== "src/minipay/app.ts")).toEqual([]);
      expect(files["src/play/Game.tsx"]).toContain("useLeaderboard({ chain: miniPayBoard })");
      const types = await typeCheck(files);
      expect(types.ran).toBe(true);
      expect(types.issues).toEqual([]);
    });
  }
});

describe("the 3D runner template (D116)", { timeout: 180_000 }, () => {
  it.skipIf(!hasWebGL)("is played as a 3D game: every kind seen, and a copy whose steering does nothing is caught", async () => {
    const ok = await runCheck(built("runner-3d"));
    for (const kind of ["crate", "barrier", "drone", "coin", "shield"]) expect(ok.note).toContain(kind);
    const stuck = await runCheck(built("runner-3d", edit("src/play/Game.tsx", "g.x += (LANES[g.lane] - g.x) * Math.min(1, dt * 12);", "")));
    expect(stuck.issues.map((i) => i.message).join(" ")).toMatch(/never moved the player[\s\S]*x and z/);
  });

  it("turns on the 3D and games kits", () => {
    expect(kitIdsOf(built("runner-3d"))).toEqual(expect.arrayContaining(["three-d", "game-2d"]));
  });
});

describe("a 3D game on a checker with no WebGL (D116)", { timeout: 180_000 }, () => {
  it.skipIf(!hasBrowser)("is left alone, not sent to be fixed", async () => {
    const browser = await chromium.launch({ headless: true, args: ["--disable-3d-apis", "--disable-webgl"] });
    try {
      const r = await runCheck(built("runner-3d"), { browser });
      expect(r.ran).toBe(true);
      expect(r.issues).toEqual([]);
      expect(r.note).toMatch(/no WebGL on this checker/);
    } finally {
      await browser.close();
    }
  });
});
