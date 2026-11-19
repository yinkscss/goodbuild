// @vitest-environment node
import { chromium, type Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";

import { checkApp, checkContracts } from "../checks";
import { kitById, kitIdsOf, withKit } from "../kits/index";
import { closeRunCheckBrowser, runCheck } from "../run-check";
import { CHECK_SEED, gameCheckScript } from "../game-check";
import { EXTRAS } from "../kits/game-extras";
import { PLATFORM_DIR, contractModule, contractsIndex, starterFiles } from "../template";
import { typeCheck } from "../type-check";

import { parseDataRules } from "@/lib/app-data";

import ts from "typescript";

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

  // D150: the genre templates, each with a broken copy the check must catch.
  it.skipIf(!hasBrowser)("Word hunt: judged as a puzzle by its letters, and a copy whose letters do nothing is caught", async () => {
    const ok = await runCheck(built("word-hunt"));
    expect(ok.note).toMatch(/puzzle game, \d+ moves/);
    const dead = await runCheck(built("word-hunt", edit("src/play/Game.tsx", "onClick={() => tap(i)}", "onClick={() => undefined}")));
    expect(dead.issues.map((i) => i.message).join(" ")).toMatch(/never accepted a move/);
  });

  it.skipIf(!hasBrowser)("Rhythm lanes: every kind it declares is seen, and a copy whose pad never moves is caught", async () => {
    const ok = await runCheck(built("rhythm-lanes"));
    for (const kind of ["bomb", "double", "slow"]) expect(ok.note).toContain(kind);
    const stuck = await runCheck(built("rhythm-lanes", edit("src/play/Game.tsx", "g.x += (laneX(g.lane) - g.x) * Math.min(1, dt * 22);", "")));
    expect(stuck.issues.map((i) => i.message).join(" ")).toMatch(/never moved the player/);
  });

  it.skipIf(!hasBrowser)("Platform hop: every kind it declares is seen", async () => {
    const ok = await runCheck(built("platform-hop"));
    expect(ok.issues).toEqual([]);
    for (const kind of ["gap", "spike", "beetle", "shield", "double"]) expect(ok.note).toContain(kind);
  });

  it.skipIf(!hasBrowser)("Crane stack: every kind it declares is seen, and a copy whose tap never drops a block is caught", async () => {
    const ok = await runCheck(built("crane-stack"));
    expect(ok.issues).toEqual([]);
    for (const kind of ["wind", "wide", "slow"]) expect(ok.note).toContain(kind);
    const stuck = await runCheck(built("crane-stack", edit("src/play/Game.tsx", "if (input.actionPressed) {", "if (input.actionPressed && false) {")));
    expect(stuck.issues.map((i) => i.message).join(" ")).toMatch(/never moved the player/);
  });

  it.skipIf(!hasBrowser)("Market stall: judged as a game of moves by its buttons, and a copy whose Serve does nothing is caught", async () => {
    const ok = await runCheck(built("market-stall"));
    expect(ok.note).toMatch(/puzzle game, \d+ moves/);
    const dead = await runCheck(built("market-stall", edit("src/play/Game.tsx", "<button type=\"button\" onClick={serve}", "<button type=\"button\" onClick={() => undefined}")));
    expect(dead.issues.map((i) => i.message).join(" ")).toMatch(/never accepted a move/);
  });

  it.skipIf(!hasBrowser)("Path guard: every kind it declares is seen, and a copy whose taps never build is caught", async () => {
    const ok = await runCheck(built("path-guard"));
    expect(ok.issues).toEqual([]);
    for (const kind of ["crawler", "runner", "frost"]) expect(ok.note).toContain(kind);
    const stuck = await runCheck(built("path-guard", edit("src/play/Game.tsx", "if (input.actionPressed) tapAt(input.pointer.x, input.pointer.y);", "")));
    expect(stuck.issues.map((i) => i.message).join(" ")).toMatch(/never moved the player/);
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
      timeoutMs: 240_000,
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
      timeoutMs: 240_000,
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

/** A template's file with no imports, loaded as a module to test its rules on their own. */
async function moduleOf(source: string) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}

describe("the crew and saboteur party game (D142)", { timeout: 300_000 }, () => {
  afterAll(() => closeRunCheckBrowser());

  it("works out the phases from the records: a knock-out calls a meeting, the vote puts someone out, and the right side wins", async () => {
    const rules = await moduleOf(gameTemplateById("saboteur-party")!.files["src/play/rules.ts"]);
    const T = rules.ONLINE;
    const p = ["a", "b", "c", "d", "e"];
    const s0 = 1_000_000;
    const at = (sec: number) => s0 + sec * 1000;
    // Too early to knock (cooldown from the start): nothing happens.
    expect(rules.station(p, [{ kind: "knock", target: "b", at: at(5) }], [], s0, at(6), T).alive).toEqual(p);
    // A knock-out calls a meeting; everyone left votes for "a"; "a" is out and shows saboteur: the crew wins.
    const acts = [{ kind: "knock", target: "b", at: at(40) }];
    const meeting = rules.station(p, acts, [], s0, at(41), T);
    expect(meeting.phase).toBe("meeting");
    expect(meeting.meeting.victim).toBe("b");
    const votes = ["a", "c", "d", "e"].map((w, i) => ({ wallet: w, kind: "vote", target: w === "a" ? "c" : "a", at: at(50 + i) }));
    const voted = rules.station(p, acts, votes, s0, at(55), T);
    expect(voted.phase).toBe("tasks");
    expect(voted.ejected).toEqual(["a"]);
    expect(voted.winner).toBeNull();
    const revealed = rules.station(p, acts, [...votes, { wallet: "a", kind: "reveal", target: "saboteur", at: at(56) }], s0, at(57), T);
    expect(revealed.winner).toBe("crew");
    // "a" shows crew instead: one saboteur is still in, with 3 left against... the game goes on.
    const wrong = rules.station(p, acts, [...votes, { wallet: "a", kind: "reveal", target: "crew", at: at(56) }], s0, at(57), T);
    expect(wrong.winner).toBeNull();
    // A tie puts nobody out.
    const tie = ["a", "c", "d", "e"].map((w, i) => ({ wallet: w, kind: "vote", target: i < 2 ? "d" : "a", at: at(50 + i) }));
    expect(rules.station(p, acts, tie, s0, at(55), T).ejected).toEqual([]);
    // Oxygen sabotaged and never fixed: the saboteurs win when it runs out; fixed in time, nothing happens.
    const sab = [{ kind: "sabotage", target: "", at: at(45) }];
    expect(rules.station(p, sab, [], s0, at(45 + T.crisis + 1), T).winner).toBe("saboteurs");
    expect(rules.station(p, [...sab, { kind: "fix", target: "", at: at(50) }], [], s0, at(45 + T.crisis + 1), T).winner).toBeNull();
    // Every task done: the crew wins.
    const tasks = Array.from({ length: T.tasksEach * 4 }, (_, i) => ({ kind: "task", target: "", at: at(10 + i) }));
    expect(rules.station(p, tasks, [], s0, at(100), T).winner).toBe("crew");
    // Knock-outs until the saboteur equals the crew: the saboteurs win.
    const knocks = [
      { kind: "knock", target: "b", at: at(40) },
      { kind: "knock", target: "c", at: at(40 + T.meeting + T.knockCooldown + 1) },
      { kind: "knock", target: "d", at: at(40 + 2 * (T.meeting + T.knockCooldown + 1)) },
    ];
    expect(rules.station(p, knocks, [], s0, at(400), T).winner).toBe("saboteurs");
    expect(rules.rolesDeck(4).filter((r: string) => r === "saboteur")).toHaveLength(1);
    expect(rules.rolesDeck(7).filter((r: string) => r === "saboteur")).toHaveLength(2);
  });

  it("adds the room's rules, a dealt roles collection and anonymous events, all valid", () => {
    const files = withGameTemplate(starterFiles(), gameTemplateById("saboteur-party")!);
    const parsed = parseDataRules(files["src/lib/dataRules.json"]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rules.roles.dealt).toBe(true);
    expect(parsed.rules.events.read).toEqual(["writer"]);
    expect(parsed.rules.events.public).toEqual(["code", "round", "kind", "target"]);
    // Nothing from the genre's best-known game.
    expect(Object.values(gameTemplateById("saboteur-party")!.files).join("\n")).not.toMatch(/among us|impostor|imposter|amogus|emergency meeting/i);
  });

  it.skipIf(!hasBrowser)("four players in a room: one saboteur is dealt, each sees only their own role, a knock-out calls a meeting on every screen, and voting the saboteur out wins it for the crew", async () => {
    let checked = false;
    let failed: unknown = null;
    const r = await runCheck(built("saboteur-party"), {
      afterPlay: async (first) => { try {
        const names = ["Ada", "Bo", "Cy", "Di"];
        const pages: Page[] = [];
        for (const [i, name] of names.entries()) pages.push(await player(first, "0x00000000000000000000000000000000000000a" + i, name));
        await pages[0].getByRole("button", { name: "Make a room" }).click();
        const code = (await pages[0].locator("[data-room-code]").innerText({ timeout: 5_000 })).trim();
        for (const p of pages.slice(1)) {
          await p.getByLabel("Room code").fill(code);
          await p.getByRole("button", { name: "Join" }).click();
          await p.getByRole("button", { name: "I'm ready" }).click({ timeout: 8_000 });
        }
        await pages[0].getByRole("button", { name: "Start the game" }).click({ timeout: 15_000 });
        const roles: string[] = [];
        for (const p of pages) roles.push(await p.getByText(/^You are (a saboteur|crew)$/).innerText({ timeout: 15_000 }));
        expect(roles.filter((x) => x === "You are a saboteur")).toHaveLength(1);
        const bad = roles.indexOf("You are a saboteur");
        const victim = (bad + 1) % 4;
        // The knock-out opens after the cooldown.
        const knock = pages[bad].getByRole("button", { name: names[victim], exact: true });
        await expect.poll(() => knock.isEnabled(), { timeout: 40_000, interval: 1_000 }).toBe(true);
        await knock.click();
        for (const p of pages) await p.getByText("Meeting: " + names[victim] + " was knocked out").waitFor({ timeout: 10_000 });
        for (const [i, p] of pages.entries()) {
          if (i === victim) continue;
          await p.getByRole("button", { name: "Vote " + names[i === bad ? (bad + 2) % 4 : bad] }).click();
        }
        for (const p of pages) await p.getByText("The crew wins").waitFor({ timeout: 20_000 });
        checked = true;
      } catch (e) { failed = e; } },
      timeoutMs: 240_000,
    });
    expect(failed).toBeNull();
    expect(r.issues).toEqual([]);
    expect(checked).toBe(true);
  });

  it.skipIf(!hasBrowser)("plays with no issues on a slow touch phone", async () => {
    const r = await runCheck(built("saboteur-party"), { phone: { cpuSlowdown: 4 } });
    expect(r.ran, r.note).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.note).toMatch(/turns game, \d+ moves, played \d+ rounds?/);
  });

  it.skipIf(!hasBrowser)("a copy whose task tiles do nothing is caught", async () => {
    const dead = await runCheck(built("saboteur-party", edit("src/play/TaskPanel.tsx", "onClick={() => tap(n)}", "onClick={() => undefined}")));
    expect(dead.issues.map((i) => i.message).join(" ")).toMatch(/never accepted a move/);
  });
});

/** A card template's rules file with the shared cards module in front of it, loaded on its own. */
async function cardRules(id: string) {
  const files = gameTemplateById(id)!.files;
  const rules = files["src/play/rules.ts"].replace(/^import .* from "\.\.\/cards\/cards";$/m, "");
  return moduleOf(files["src/cards/cards.ts"] + "\n" + rules);
}

describe("the card games (D143)", { timeout: 300_000 }, () => {
  afterAll(() => closeRunCheckBrowser());

  it("Solitaire deals Klondike, moves by the rules, scores, and knows when it's stuck or won", async () => {
    const r = await cardRules("solitaire");
    const t = r.deal();
    expect(t.piles.map((p: { down: string[]; up: string[] }) => p.down.length + p.up.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(t.piles.every((p: { up: string[] }) => p.up.length === 1)).toBe(true);
    expect(t.stock).toHaveLength(24);
    expect(r.draw(t).waste).toHaveLength(3);
    // Three passes through the stock, then no more.
    let d = t;
    for (let i = 0; i < 8 * r.PASSES + (r.PASSES - 1); i++) d = r.draw(d) ?? d;
    expect(r.draw(d)).toBeNull();
    // An ace goes home (10) and the card under it turns (5); a red 6 goes on a black 7; a king takes an empty column.
    const table = { stock: [], waste: ["AH"], found: [[], [], [], []], pass: 3, score: 0, piles: [{ down: ["2C"], up: ["7S"] }, { down: [], up: ["6H"] }, { down: [], up: [] }, { down: ["3D"], up: ["KS"] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }] };
    const home = r.move(table, { from: "waste" });
    expect(home.found[1]).toEqual(["AH"]);
    expect(home.score).toBe(10);
    const six = r.move(table, { from: "pile", pile: 1, index: 0 });
    expect(six.piles[0].up).toEqual(["7S", "6H"]);
    const king = r.move(table, { from: "pile", pile: 3, index: 0 });
    expect(king.piles[3].up).toEqual(["3D"]);
    expect(king.score).toBe(5);
    expect(r.move({ ...table, waste: ["5H"] }, { from: "waste" })).toBeNull();
    expect(r.stuck({ ...table, waste: ["5C"], piles: [{ down: ["2C"], up: ["9S"] }, ...table.piles.slice(1, 2).map(() => ({ down: [], up: ["4D"] })), ...Array.from({ length: 5 }, () => ({ down: ["QC"], up: ["QH"] }))] })).toBe(true);
    expect(r.won({ ...table, found: [0, 1, 2, 3].map(() => Array(13).fill("x")) })).toBe(true);
  });

  it("Solitaire deals the run check a fixed deal that has aces to score with, and real players a random one", async () => {
    const r = await cardRules("solitaire");
    const { seededRandom } = await moduleOf(EXTRAS);
    const checked = r.deal(r.shuffle(r.fullDeck(), seededRandom(CHECK_SEED)));
    expect(checked).toEqual(r.deal(r.shuffle(r.fullDeck(), seededRandom(CHECK_SEED))));
    // The check's bot taps at random; aces face up give it a scoring move from the first tap.
    expect(checked.piles.filter((p: { up: string[] }) => /^A/.test(p.up[0])).length).toBeGreaterThanOrEqual(2);
    expect(gameCheckScript()).toContain(`seed: ${CHECK_SEED}`);
    const game = gameTemplateById("solitaire")!.files["src/play/Game.tsx"];
    expect(game.match(/\bdeal\(/g)).toHaveLength(1);
    expect(game).toContain("checkSeed()");
  });

  it("Last card out replays the moves the same way on every screen", async () => {
    const r = await cardRules("last-card");
    const players = ["a", "b"];
    const m = (wallet: string, n: number, data: Record<string, unknown>) => ({ wallet, n, data });
    const start = m("a", 0, { kind: "start", card: "5H", deal: "d1" });
    // Turn 1 is a's: b out of turn is left out, a wrong card is left out, a matching suit goes.
    let p = r.replay([start, m("b", 1, { kind: "play", card: "5S" }), m("a", 1, { kind: "play", card: "9C" }), m("a", 1, { kind: "play", card: "9H" })], players, "a");
    expect(p.top).toBe("9H");
    expect(p.turn).toBe(2);
    expect(p.counts).toEqual([6, 7]);
    expect(p.deal).toBe("d1");
    // An 8 calls the suit; drawing adds a card and ends the turn.
    p = r.replay([start, m("a", 1, { kind: "play", card: "8D", suit: "S" }), m("b", 2, { kind: "play", card: "2S" }), m("a", 3, { kind: "draw" })], players, "a");
    expect(p.called).toBe("S");
    expect(p.counts).toEqual([7, 6]);
    // The same card can't be played twice.
    expect(r.replay([start, m("a", 1, { kind: "play", card: "5D" }), m("b", 2, { kind: "play", card: "5D" })], players, "a").turn).toBe(2);
    // Every player passes with an empty deck: fewest cards wins.
    p = r.replay([start, m("a", 1, { kind: "play", card: "6H" }), m("b", 2, { kind: "pass" }), m("a", 3, { kind: "pass" })], players, "a");
    expect(p.winner).toBe(0);
    expect(r.handSize(2)).toBe(7);
    expect(r.handSize(4)).toBe(5);
  });

  it("card games add their rules: the shedding game a dealt hands collection beside the room's", () => {
    const parsed = parseDataRules(withGameTemplate(starterFiles(), gameTemplateById("last-card")!)["src/lib/dataRules.json"]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rules.hands.dealt).toBe(true);
    expect(Object.keys(parsed.rules)).toEqual(expect.arrayContaining(["rooms", "seats", "moves", "hands", "scores"].filter((c) => c !== "scores")));
    // No betting words in any card game.
    const all = ["solitaire", "higher-lower", "memory-pairs", "last-card"].flatMap((id) => Object.values(gameTemplateById(id)!.files)).join("\n");
    expect(all).not.toMatch(/\b(bet|wager|stake|jackpot|casino|chips?)\b/i);
  });

  it.skipIf(!hasBrowser)("Last card out: two players in a room get dealt hands they alone see, the same top card, and a move reaches the other screen", async () => {
    let checked = false;
    let failed: unknown = null;
    const r = await runCheck(built("last-card"), {
      afterPlay: async (first) => {
        try {
          const { ada, bo } = await startRoom(first);
          const hand = (p: Page) => p.locator("[data-game-area] button[aria-label$=' of hearts'], [data-game-area] button:has([aria-label*=' of '])");
          await ada.getByText("You: 7").waitFor({ timeout: 15_000 });
          await bo.getByText("You: 7").waitFor({ timeout: 15_000 });
          expect(await hand(ada).count()).toBe(7);
          expect(await hand(bo).count()).toBe(7);
          const top = async (p: Page) => (await p.locator("[aria-label*=' of ']").first().getAttribute("aria-label"))!;
          const adaCards = await ada.locator("[data-game-area] [aria-label*=' of ']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
          const boCards = await bo.locator("[data-game-area] [aria-label*=' of ']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
          expect(adaCards.filter((c) => boCards.includes(c))).toEqual([]);
          expect(await top(ada)).toBe(await top(bo));
          // Ada (the host) goes first: a card if one goes, else a draw. Bo's screen shows it's his turn.
          await ada.getByText("Your turn: play a card or draw").waitFor({ timeout: 10_000 });
          const playable = ada.locator("[data-game-area] button:not([disabled]):has([aria-label*=' of '])");
          if (await playable.count()) {
            await playable.first().click();
            const suit = ada.getByRole("button", { name: "Call S" });
            if (await suit.isVisible().catch(() => false)) await suit.click();
            await bo.getByText("Bo: 7").or(bo.getByText("You: 7")).first().waitFor({ timeout: 5_000 });
            await bo.getByText("Ada: 6").waitFor({ timeout: 10_000 });
          } else {
            await ada.getByRole("button", { name: "Draw a card" }).click();
            await bo.getByText("Ada: 8").waitFor({ timeout: 10_000 });
          }
          await bo.getByText("Your turn: play a card or draw").waitFor({ timeout: 10_000 });
          checked = true;
        } catch (e) {
          failed = e;
        }
      },
      timeoutMs: 240_000,
    });
    expect(failed).toBeNull();
    expect(r.issues).toEqual([]);
    expect(checked).toBe(true);
  });

  for (const id of ["solitaire", "higher-lower", "memory-pairs", "last-card"]) {
    it.skipIf(!hasBrowser)(`${id}: plays with no issues on a slow touch phone`, async () => {
      const r = await runCheck(built(id), { phone: { cpuSlowdown: 4 } });
      expect(r.ran, r.note).toBe(true);
      expect(r.issues).toEqual([]);
      expect(r.note).toMatch(/(turns|puzzle) game, \d+ moves, played \d+ rounds?/);
    });
  }

  it.skipIf(!hasBrowser)("Higher or lower: a copy whose guesses do nothing is caught", async () => {
    const dead = await runCheck(built("higher-lower", (f) => edit("src/play/Game.tsx", "onClick={() => guess(false)}", "onClick={() => undefined}")(edit("src/play/Game.tsx", "onClick={() => guess(true)}", "onClick={() => undefined}")(f))));
    expect(dead.issues.map((i) => i.message).join(" ")).toMatch(/never accepted a move/);
  });
});
