// @vitest-environment node
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";

import { checkApp, checkContracts } from "../checks";
import { kitById, kitIdsOf, withKit } from "../kits/index";
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
    expect(all).not.toMatch(/\b(tetris|flappy|pac-?man|mario|sonic|candy crush|subway surfers|temple run|angry birds|kahoot)\b/i);
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

    it.skipIf(!hasBrowser)(`${t.name}: is played by the run check with no issues, leaderboard posting included`, async () => {
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
});

describe("game templates in MiniPay (D114)", { timeout: 180_000 }, () => {
  for (const id of ["lane-racer", "quick-quiz", "runner-3d"]) {
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
  it.skipIf(!hasBrowser)("is played as a 3D game: every kind seen, and a copy whose steering does nothing is caught", async () => {
    const ok = await runCheck(built("runner-3d"));
    for (const kind of ["crate", "barrier", "drone", "coin", "shield"]) expect(ok.note).toContain(kind);
    const stuck = await runCheck(built("runner-3d", edit("src/play/Game.tsx", "g.x += (LANES[g.lane] - g.x) * Math.min(1, dt * 12);", "")));
    expect(stuck.issues.map((i) => i.message).join(" ")).toMatch(/never moved the player[\s\S]*x and z/);
  });

  it("turns on the 3D and games kits", () => {
    expect(kitIdsOf(built("runner-3d"))).toEqual(expect.arrayContaining(["three-d", "game-2d"]));
  });
});
