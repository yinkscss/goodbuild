// @vitest-environment node
import { chromium, type Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";

import { checkApp, checkContracts } from "../checks";
import { kitById, kitIdsOf, withKit } from "../kits/index";
import { closeRunCheckBrowser, runCheck } from "../run-check";
import { PLATFORM_DIR, contractModule, contractsIndex, starterFiles } from "../template";
import { typeCheck } from "../type-check";

import { parseDataRules } from "@/lib/app-data";

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
      expect(r.ran, r.note).toBe(true);
      expect(r.issues).toEqual([]);
      expect(r.note).toMatch(/played \d+ rounds?/);
      // A room game has no leaderboard: its rounds are against the computer or friends.
      if (t.leaderboard) expect(r.note).toMatch(/a score was posted and shown on the board/);
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

  // A game that drifts by itself and is steered by touch, whose keys do nothing sideways (Space only, say):
  // the arrows doing nothing isn't proof, so the check tries a finger on each side before reporting (D119).
  it.skipIf(!hasBrowser)("Catch and dodge with wind and no arrow steering: touch steering passes the controls check", async () => {
    const windy = (f: Record<string, string>) =>
      edit("src/play/Game.tsx", "    if (keys) g.x = g.target;\n", "")(edit("src/play/Game.tsx", "if (keys) g.target = g.x + keys * 360 * dt;", "g.target += Math.sin(g.t * 3) * 400 * dt;")(f));
    const r = await runCheck(built("catch-dodge", windy));
    expect(r.ran, r.note).toBe(true);
    expect(r.issues.map((i) => i.message).join(" ")).not.toMatch(/controls do nothing/);
    expect(r.note).toMatch(/played \d+ rounds?/);
  });

  // The same, steered only by moving the finger while it's pressed (not toward where it rests).
  it.skipIf(!hasBrowser)("Catch and dodge with wind, steered only by dragging: passes the controls check", async () => {
    const dragged = (f: Record<string, string>) =>
      edit(
        "src/play/Game.tsx",
        "if (input.pointer.down) g.target = input.pointer.x;",
        "const held = g as typeof g & { px?: number };\n    if (input.pointer.down && held.px !== undefined) g.target += input.pointer.x - held.px;\n    held.px = input.pointer.down ? input.pointer.x : undefined;",
      )(edit("src/play/Game.tsx", "    if (keys) g.x = g.target;\n", "")(edit("src/play/Game.tsx", "if (keys) g.target = g.x + keys * 360 * dt;", "g.target += Math.sin(g.t * 3) * 400 * dt;")(f)));
    const r = await runCheck(built("catch-dodge", dragged));
    expect(r.ran, r.note).toBe(true);
    expect(r.issues.map((i) => i.message).join(" ")).not.toMatch(/controls do nothing/);
    expect(r.note).toMatch(/played \d+ rounds?/);
  });

  // Arrows and touch both dead in a windy game: not reported, since a busy checker can't tell that from a
  // slow game, but said in the note (D119). Kart track's dead steering is the case this leaves open (Q46).
  it.skipIf(!hasBrowser)("Catch and dodge with wind and no steering at all: the controls are left unjudged, never reported", async () => {
    const dead = (f: Record<string, string>) =>
      edit("src/play/Game.tsx", "if (input.pointer.down) g.target = input.pointer.x;", "")(edit("src/play/Game.tsx", "    if (keys) g.x = g.target;\n", "")(edit("src/play/Game.tsx", "if (keys) g.target = g.x + keys * 360 * dt;", "g.target += Math.sin(g.t * 3) * 400 * dt;")(f)));
    const r = await runCheck(built("catch-dodge", dead));
    expect(r.ran, r.note).toBe(true);
    expect(r.issues.map((i) => i.message).join(" ")).not.toMatch(/controls do nothing/);
    expect(r.note).toMatch(/the controls weren't judged/);
  });

  it.skipIf(!hasBrowser)("Cave flyer: with a probe that doesn't say where the player is (one from before D118), the controls aren't judged", async () => {
    const old = (files: Record<string, string>) => edit("src/game/probe.ts", "  c.at = { x, y, round: c.rounds.length };\n", "")(files);
    const dead = await runCheck(built("cave-flyer", (f) => old(edit("src/play/Game.tsx", "g.vy += (climbing ? -1500 : 900) * dt;", "g.vy += 900 * dt;")(f))));
    // It must have run: a check that didn't run has no issues either.
    expect(dead.ran, dead.note).toBe(true);
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
      if (gameTemplateById(id)!.leaderboard) expect(files["src/play/Game.tsx"]).toContain("useLeaderboard({ chain: miniPayBoard })");
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
      expect(r.ran, r.note).toBe(true);
      expect(r.issues).toEqual([]);
      expect(r.note).toMatch(/no WebGL on this checker/);
    } finally {
      await browser.close();
    }
  });
});

/** A browser wallet for one player of a room test: says yes to everything, with its own address. */
const walletFor = (account: string) => `(() => {
  window.ethereum = {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [${JSON.stringify("ACCOUNT")}];
      if (method === "eth_chainId") return "0xaa044c";
      if (method === "net_version") return "11142220";
      if (method === "personal_sign") return "0x" + "11".repeat(65);
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      throw Object.assign(new Error("Not available."), { code: 4200 });
    },
    on() {},
    removeListener() {},
  };
})();`.replace('"ACCOUNT"', JSON.stringify(account));

/** Open the game as one player and sign in to the room with that player's wallet. */
async function player(first: Page, account: string, name: string): Promise<Page> {
  const page = await first.context().newPage();
  await page.addInitScript(walletFor(account));
  await page.goto(first.url(), { waitUntil: "load" });
  await page.getByRole("button", { name: "Sign in with wallet" }).click();
  await page.locator("[data-goodbuild-wallets] .gbw-row", { hasText: /Browser wallet|MetaMask/ }).first().click({ timeout: 2_000 }).catch(() => undefined);
  await page.getByLabel("Your name").fill(name, { timeout: 5_000 });
  return page;
}

/** Ada makes a room, Bo joins by its code and readies up, and Ada starts. The rooms poll every 3 seconds. */
async function startRoom(first: Page): Promise<{ ada: Page; bo: Page; code: string }> {
  const ada = await player(first, "0x00000000000000000000000000000000000000a1", "Ada");
  const bo = await player(first, "0x00000000000000000000000000000000000000b2", "Bo");
  await ada.getByRole("button", { name: "Make a room" }).click();
  const code = (await ada.locator("[data-room-code]").innerText({ timeout: 5_000 })).trim();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  await bo.getByLabel("Room code").fill(code.toLowerCase());
  await bo.getByRole("button", { name: "Join" }).click();
  await bo.getByRole("button", { name: "I'm ready" }).click({ timeout: 8_000 });
  await ada.getByRole("button", { name: "Start the game" }).click({ timeout: 10_000 });
  return { ada, bo, code };
}

describe("room games in the preview, with two players (D139)", { timeout: 240_000 }, () => {
  afterAll(() => closeRunCheckBrowser());

  it("add the room's three collections with valid rules, keeping the person's own", () => {
    const start = { ...starterFiles(), "src/lib/dataRules.json": JSON.stringify({ collections: { notes: "private", moves: "public-read" } }) };
    for (const id of ["four-in-a-row", "trivia-battle"]) {
      const files = withGameTemplate(start, gameTemplateById(id)!);
      const parsed = parseDataRules(files["src/lib/dataRules.json"]);
      expect(parsed.issues).toEqual([]);
      expect(Object.keys(parsed.rules)).toEqual(expect.arrayContaining(["notes", "rooms", "seats", "moves"]));
      // A collection the person already had keeps its rule.
      expect(JSON.parse(files["src/lib/dataRules.json"]).collections.moves).toBe("public-read");
      expect(parsed.rules.rooms.unique).toEqual(["code"]);
    }
  });

  it.skipIf(!hasBrowser)("Four in a row: a room is made, joined by code and started, turns alternate, the winner shows on both screens, and Rematch goes back to the lobby", async () => {
    let checked = false;
    const r = await runCheck(built("four-in-a-row"), {
      afterPlay: async (first) => {
        const { ada, bo } = await startRoom(first);
        const drop = async (who: Page, col: number) => {
          await who.getByText("Your turn").waitFor({ timeout: 10_000 });
          await who.getByRole("button", { name: "Drop in column " + col }).click();
        };
        // Ada goes first (the host), and wins down column 1.
        for (let i = 0; i < 3; i++) {
          await drop(ada, 1);
          // Bo's columns wait for his turn, which comes from Ada's move on his screen.
          await drop(bo, 2);
        }
        await drop(ada, 1);
        await ada.getByText("You win!").waitFor({ timeout: 10_000 });
        await bo.getByText("Ada wins").waitFor({ timeout: 10_000 });
        await ada.getByRole("button", { name: "Rematch" }).click();
        await bo.getByRole("button", { name: "I'm ready" }).waitFor({ timeout: 10_000 });
        checked = true;
      },
    });
    expect(r.issues).toEqual([]);
    expect(checked).toBe(true);
  });

  it.skipIf(!hasBrowser)("Trivia battle: two players get the same questions, both scores show live, and the round ends with a winner", async () => {
    let checked = false;
    const r = await runCheck(built("trivia-battle"), {
      afterPlay: async (first) => {
        const { ada, bo } = await startRoom(first);
        const firstQuestion = async (p: Page) => (await p.locator("[data-game-area]").locator("..").locator("p.text-lg").innerText({ timeout: 10_000 })).trim();
        expect(await firstQuestion(ada)).toBe(await firstQuestion(bo));
        // Ada answers everything first; Bo sees her score move before answering.
        for (let q = 1; q <= 10; q++) {
          await ada.getByText("Question " + q + "/10").waitFor({ timeout: 5_000 });
          await ada.locator("[data-game-area] button").first().click();
        }
        await ada.getByText(/Waiting for the others/).waitFor({ timeout: 5_000 });
        await bo.locator("li", { hasText: "Ada" }).getByText(/done/).waitFor({ timeout: 10_000 });
        for (let q = 1; q <= 10; q++) {
          await bo.getByText("Question " + q + "/10").waitFor({ timeout: 5_000 });
          await bo.locator("[data-game-area] button").nth(1).click();
        }
        await ada.getByText(/You win!|Bo wins/).waitFor({ timeout: 10_000 });
        await bo.getByText(/You win!|Ada wins/).waitFor({ timeout: 10_000 });
        await ada.getByRole("button", { name: "Rematch" }).waitFor({ timeout: 5_000 });
        checked = true;
      },
    });
    expect(r.issues).toEqual([]);
    expect(checked).toBe(true);
  });

  // A cheap phone: a touch screen and a CPU four times slower. The room games must still play and judge cleanly.
  for (const id of ["four-in-a-row", "trivia-battle"]) {
    it.skipIf(!hasBrowser)(`${id}: plays with no issues on a slow touch phone`, async () => {
      const r = await runCheck(built(id), { phone: { cpuSlowdown: 4 } });
      expect(r.ran, r.note).toBe(true);
      expect(r.issues).toEqual([]);
      expect(r.note).toMatch(/turns game, \d+ moves, played \d+ rounds?/);
    });
  }

  it.skipIf(!hasBrowser)("Four in a row: a copy whose columns do nothing is caught", async () => {
    const dead = await runCheck(built("four-in-a-row", edit("src/play/Board.tsx", "onClick={() => onDrop(col)}", "onClick={() => undefined}")));
    expect(dead.issues.map((i) => i.message).join(" ")).toMatch(/never accepted a move/);
  });
});
