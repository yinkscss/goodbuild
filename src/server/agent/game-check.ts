import "server-only";

import type { Page } from "playwright-core";

/**
 * Playing a 2D game in the run check (D94). The game kit's probe (src/game/probe.ts) records what
 * happened while a restless bot plays: rounds, the score, where the player went, the speed, and each
 * kind of obstacle, power-up and character as it appears. This reads that and says what's wrong, in
 * words the builder can act on. It also posts a score to the leaderboard and connects a stand-in wallet,
 * in a browser and as MiniPay.
 *
 * Every finding is something a player would hit. Where the bot can't tell (it never survived long enough
 * to meet everything, or no round ended), it says nothing rather than guess: a false finding costs a fix.
 */

/** Game steps per screen frame while checking: 7 seconds of play cover about 28 seconds of game. */
export const GAME_CHECK_SPEED = 4;
export const PLAY_MS = 7_000;
/** The stand-in wallet's account, and how the app shows it (shortAddress). */
export const CHECK_WALLET = "0x00000000000000000000000000000000000000c1";
export const CHECK_WALLET_SHORT = "0x0000…00c1";

/** Seconds of play: the first obstacle must come by then, with a little slack for the frame it was made in. */
const FIRST_HAZARD_S = 3.5;
/** A round this long must have shown every declared kind. */
const ALL_KINDS_S = 15;
/** A round this long must have got harder. */
const HARDER_S = 10;
/** A puzzle or turn-based game played this long must have accepted a move. */
const MOVE_S = 4;
/** After this many moves, a puzzle or turn-based game's score must have gone up. */
const SCORE_MOVES = 16;

export interface ProbeRound {
  start: number;
  end?: number;
  frames: number;
  score0?: number;
  scoreMax?: number;
  speed0?: number;
  speedMax?: number;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  firstHazard?: number;
  /** Each kind's first appearance in this round, in seconds since it started. */
  kinds?: Record<string, number>;
  /** Moves the game accepted (puzzle and turn-based games call moved()). */
  moves?: number;
}

export type GameStyle = "action" | "puzzle" | "turns";
export type GameControl = "tap" | "sides" | "keys" | "swipe" | "drag" | "hold" | "buttons";

export interface ProbeReport {
  time: number;
  rounds: ProbeRound[];
  seen: Record<string, number>;
  declared?: { style?: GameStyle; controls?: GameControl[]; obstacles?: string[]; powerups?: string[]; npcs?: string[] };
  probes: number;
  /** Game frames GameCanvas marked: zero for a game without one, or with a GameCanvas from before D112. */
  frames?: number;
  /** Declared kinds made outside a game frame, on a timer, while a round ran. */
  offFrame?: string[];
  /** Where the player is now, and in which round (a probe from D118 on). */
  at?: { x: number; y: number; round: number };
}

/** How the game is judged: what it said it is, or an action game when it didn't say (every game before D112). */
export function styleOf(report: ProbeReport | null): GameStyle {
  const s = report?.declared?.style;
  return s === "puzzle" || s === "turns" ? s : "action";
}

/** Turns the probe on before the app's own scripts run. */
export function gameCheckScript(speed = GAME_CHECK_SPEED): string {
  return `window.__gbGame = { on: true, speed: ${Number(speed)}, time: 0, rounds: [], seen: {}, probes: 0 };`;
}

/**
 * A browser wallet that says yes to everything and remembers what it was asked, as window.ethereum.
 * As MiniPay it also says isMiniPay, which the wallet layer connects on its own.
 */
export function standInWalletScript(options: { miniPay: boolean; chainId: number }): string {
  const chain = "0x" + options.chainId.toString(16);
  return `(() => {
  const calls = [];
  window.__gbWalletCalls = calls;
  const account = ${JSON.stringify(CHECK_WALLET)};
  window.ethereum = {
    ${options.miniPay ? "isMiniPay: true," : ""}
    request: async ({ method }) => {
      calls.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return ${JSON.stringify(chain)};
      if (method === "net_version") return ${JSON.stringify(String(options.chainId))};
      if (method === "personal_sign" || method === "eth_sign" || method.startsWith("eth_signTypedData")) return "0x" + "11".repeat(65);
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain" || method === "wallet_revokePermissions") return null;
      throw Object.assign(new Error("Not available in GoodBuild's check."), { code: 4200 });
    },
    on() {},
    removeListener() {},
  };
})();`;
}

export async function probeReport(page: Page): Promise<ProbeReport | null> {
  return page.evaluate(() => (window as unknown as { __gbGame?: ProbeReport }).__gbGame ?? null).catch(() => null);
}

/** The game's own canvas (GameCanvas marks it), or the first canvas for a game drawn without it. */
export async function gameCanvas(page: Page) {
  const marked = page.locator("canvas[data-game-canvas]").first();
  return (await marked.count().catch(() => 0)) > 0 ? marked : page.locator("canvas").first();
}

/** If the wallet list opened (published apps with WalletConnect list several), pick the browser wallet. */
async function pickBrowserWallet(page: Page): Promise<void> {
  await page.locator("[data-goodbuild-wallets] .gbw-row", { hasText: /Browser wallet|MetaMask/ }).first().click({ timeout: 800 }).catch(() => undefined);
}

/** Buttons that belong to the page around the game, never pressed as a move. */
const NOT_A_MOVE = /\b(connect|wallet|mute|sound|music|vibrat|share|post|menu|settings?|leaderboard|board|store|shop|buy|pause|resume|back|home|close|help|how to|about|terms|privacy)\b/i;

/** Where the game is played: its canvas, or the area a game without one marks with data-game-area. */
async function playArea(page: Page) {
  const area = page.locator("[data-game-area]").first();
  if ((await area.count().catch(() => 0)) > 0) return area;
  return gameCanvas(page);
}

/** The controls the game declared, or tapping the sides and the keys for a game that declared none. */
async function declaredControls(page: Page): Promise<GameControl[]> {
  const controls = (await probeReport(page))?.declared?.controls ?? [];
  return controls.length ? controls : ["sides", "keys"];
}

/** One restless move, made with one of the game's own controls. */
async function fidget(page: Page, controls: GameControl[] = ["sides", "keys"]): Promise<void> {
  const control = controls[Math.floor(Math.random() * controls.length)];
  if (control === "keys") {
    await page.keyboard.press(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"][Math.floor(Math.random() * 5)]).catch(() => undefined);
    return;
  }
  if (control === "buttons") {
    await pressAMove(page);
    return;
  }
  const area = await playArea(page);
  // A short wait: after a game over the canvas may be gone, and the default wait is 30 seconds.
  const box = await area.boundingBox({ timeout: 300 }).catch(() => null);
  if (!box) {
    await page.keyboard.press("Space").catch(() => undefined);
    return;
  }
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
  // Clicks go through the area itself, so something over it (a game-over panel) is never pressed by accident.
  if (control === "sides" || control === "tap") {
    const fx = control === "sides" ? (Math.random() < 0.5 ? 0.2 : 0.8) : rnd(0.3, 0.7);
    const fy = control === "sides" ? 0.7 : rnd(0.3, 0.8);
    await area.click({ position: { x: box.width * fx, y: box.height * fy }, timeout: 800 }).catch(() => undefined);
    return;
  }
  // A press that moves goes straight to the mouse, so first make sure the point is on the game and not on something over it.
  const free = async (p: { x: number; y: number }) =>
    area.evaluate((el, q) => {
      const top = document.elementFromPoint(q.x, q.y);
      return Boolean(top && (top === el || el.contains(top)));
    }, p).catch(() => false);
  if (control === "hold") {
    const p = at(rnd(0.3, 0.7), rnd(0.4, 0.8));
    if (!(await free(p))) return;
    await page.mouse.move(p.x, p.y).catch(() => undefined);
    await page.mouse.down().catch(() => undefined);
    await page.waitForTimeout(600);
    await page.mouse.up().catch(() => undefined);
  } else {
    // A swipe is a quick flick one way; a drag moves further, more slowly, and lets go.
    const from = at(rnd(0.2, 0.8), rnd(0.25, 0.8));
    const swipe = control === "swipe";
    const reach = Math.min(box.width, box.height) * (swipe ? 0.18 : rnd(0.2, 0.45));
    // Any of the four ways: a puzzle may drag tiles between rows as well as along them.
    const angle = (Math.floor(Math.random() * 4) * Math.PI) / 2;
    if (!(await free(from))) return;
    await page.mouse.move(from.x, from.y).catch(() => undefined);
    await page.mouse.down().catch(() => undefined);
    // A drag stays down for at least a frame first, so a game that reads pointer.down each frame sees the press.
    if (!swipe) await page.waitForTimeout(50);
    await page.mouse.move(from.x + Math.cos(angle) * reach, from.y + Math.sin(angle) * reach, { steps: swipe ? 4 : 12 }).catch(() => undefined);
    await page.mouse.up().catch(() => undefined);
  }
}

/** Press one of the buttons the game shows as moves (answers, tiles, cards), inside its play area when it marks one. */
async function pressAMove(page: Page): Promise<void> {
  const area = page.locator("[data-game-area]").first();
  const inArea = (await area.count().catch(() => 0)) > 0;
  const scope = inArea ? area : page.locator("body");
  const names = await scope
    .getByRole("button")
    .evaluateAll((els) =>
      els.map((el, i) => {
        const b = el as HTMLButtonElement;
        const box = b.getBoundingClientRect();
        const visible = box.width > 0 && box.height > 0 && getComputedStyle(b).visibility !== "hidden";
        return { i, name: (b.getAttribute("aria-label") || b.textContent || "").trim(), ok: visible && !b.disabled };
      }),
    )
    .catch(() => [] as { i: number; name: string; ok: boolean }[]);
  // Inside the game's own area every button is the game's (an answer may well be "Home" or "Sound"); only
  // without one are the page's own controls (menu, wallet, mute) left alone.
  const moves = names.filter((n) => n.ok && (inArea || !NOT_A_MOVE.test(n.name)) && !PLAY_AGAIN.test(n.name));
  if (!moves.length) return;
  const pick = moves[Math.floor(Math.random() * moves.length)];
  await scope.getByRole("button").nth(pick.i).click({ timeout: 800 }).catch(() => undefined);
}

const roundOver = (r: ProbeReport | null) => {
  const last = r?.rounds.at(-1);
  return Boolean(last && last.end !== undefined);
};

const PLAY_AGAIN = /\b(play|again|retry|restart|start|race|replay|try again|go)\b/i;

/**
 * Play for about PLAY_MS. After each game over, press Play again and check a new round starts.
 * Returns the problems with Play again, if any.
 */
export async function playRounds(page: Page, ms = PLAY_MS): Promise<string[]> {
  const deadline = Date.now() + ms;
  const controls = await declaredControls(page);
  while (Date.now() < deadline) {
    const report = await probeReport(page);
    if (roundOver(report)) {
      await page.waitForTimeout(350);
      const again = page.getByRole("button", { name: PLAY_AGAIN }).first();
      if (!(await again.isVisible().catch(() => false))) {
        return ["After a game over there's no Play again button. Show the score, the best, and a big Play again <button> that starts a new round."];
      }
      // The player's thumb is on the game: Play again must be there, not below it (the owner's Neon Drift feedback, D95).
      const inView = await again.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
      }).catch(() => true);
      if (!inView) {
        return ["After a game over, Play again is below the screen: the player has to scroll to find it. Show the game-over panel on the game itself (GameOver from src/game/GameOver.tsx inside the relative box around GameCanvas)."];
      }
      const before = report!.rounds.length;
      await again.click({ timeout: 1_000 }).catch(() => undefined);
      const restarted = await page
        .waitForFunction((n) => {
          const g = (window as unknown as { __gbGame?: ProbeReport }).__gbGame;
          return Boolean(g && g.rounds.length > n && g.rounds[g.rounds.length - 1].end === undefined);
        }, before, { timeout: 1_500 })
        .then(() => true)
        .catch(() => false);
      if (!restarted) return ["Pressing Play again after a game over didn't start a new round: the game stayed paused. Reset the game's state and set the screen back to playing."];
      continue;
    }
    await fidget(page, controls);
    await page.waitForTimeout(110);
  }
  return [];
}

/** How far the player moved while one input was held (a), then while the opposite one was (b). */
export interface ControlTrial {
  a: { dx: number; dy: number };
  b: { dx: number; dy: number };
}

/** Fewer trials than this, and the controls aren't judged. */
const MIN_TRIALS = 4;
/** How consistently the input must change the player's movement (a t statistic) to count as working. */
const CONTROLS_T = 3;

/**
 * Whether a game's controls move the player, judged only for a game that moves the player by itself
 * (drift: a road that bends, gravity). There, "the player moved" proves nothing, so this asks whether
 * holding one input instead of the opposite changes the movement the same way every time. "unjudged"
 * is never held against a game (D118).
 */
export function judgeControls(trials: ControlTrial[], drift: { dx: number; dy: number } | null): { verdict: "works" | "dead" | "unjudged"; t: number } {
  if (!drift || (drift.dx === 0 && drift.dy === 0) || trials.length < MIN_TRIALS) return { verdict: "unjudged", t: 0 };
  const n = trials.length;
  const tOf = (d: number[]) => {
    const mean = d.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    if (sd === 0) return mean === 0 ? 0 : Infinity;
    return Math.abs(mean) / (sd / Math.sqrt(n));
  };
  const t = Math.max(tOf(trials.map((x) => x.a.dx - x.b.dx)), tOf(trials.map((x) => x.a.dy - x.b.dy)));
  return { verdict: t >= CONTROLS_T ? "works" : "dead", t };
}

/** How long each input is held when checking the controls, and how long the player is left alone first. */
const HOLD_MS = 280;
const IDLE_MS = 1_000;
const TRIALS = 6;

/** The player's position now, while a round runs; null between rounds or with a probe from before D118. */
async function liveAt(page: Page): Promise<{ x: number; y: number; round: number } | null> {
  const r = await probeReport(page);
  const last = r?.rounds.at(-1);
  if (!r?.at || !last || last.end !== undefined || r.at.round !== r.rounds.length) return null;
  return r.at;
}

/** After a game over, press Play again and wait for the new round. Exported for the slow-phone test. */
export async function playAgain(page: Page): Promise<boolean> {
  const before = (await probeReport(page))?.rounds.length ?? 0;
  const again = page.getByRole("button", { name: PLAY_AGAIN }).first();
  await again.waitFor({ state: "visible", timeout: 1_500 }).catch(() => undefined);
  await again.click({ timeout: 1_000 }).catch(() => undefined);
  return page
    .waitForFunction((n) => {
      const g = (window as unknown as { __gbGame?: ProbeReport }).__gbGame;
      return Boolean(g && g.rounds.length > n && g.rounds[g.rounds.length - 1].end === undefined);
    }, before, { timeout: 1_500 })
    .then(() => true)
    .catch(() => false);
}

/**
 * Do the game's controls move the player, in a game that also moves the player by itself (D118)?
 * Leaves the player alone for a moment; if they drift (a bending road, gravity), holds one input and
 * then the opposite, in turn, and passes how far they moved each time to judgeControls. Only for a
 * game that declares hold, or keys with sideways steering (sides or drag): a tap or a swipe is one step,
 * which a wall can block, and keys alone may mean only Space (a runner that jumps), so the arrows doing
 * nothing proves nothing. When the arrows seem dead, a finger dragged to each side is tried; if that seems
 * dead too, the controls are left unjudged with a note. Only a dead hold is reported.
 * A game that declares nothing isn't judged either.
 */
export async function checkControls(page: Page): Promise<{ issues: string[]; note?: string }> {
  const report = await probeReport(page);
  if (styleOf(report) !== "action" || !report?.at) return { issues: [] };
  const controls = report.declared?.controls ?? [];
  const hold = controls.includes("hold");
  const sideways = controls.includes("keys") && (controls.includes("sides") || controls.includes("drag"));
  if (!hold && !sideways) return { issues: [] };
  const area = await playArea(page);
  // What a trial holds: a press against none, the arrows, or a finger pressed in the middle and dragged to
  // the left or right side (so a game that steers toward the finger and one that steers by dragging both see it).
  let mode: "hold" | "keys" | "sides" = hold ? "hold" : "keys";

  const press = async (which: "a" | "b") => {
    if (mode === "keys") {
      await page.keyboard.down(which === "a" ? "ArrowLeft" : "ArrowRight").catch(() => undefined);
      return;
    }
    if (mode === "hold" && which === "b") return;
    const box = await area.boundingBox({ timeout: 300 }).catch(() => null);
    if (!box) return;
    const y = box.y + box.height * 0.6;
    await page.mouse.move(box.x + box.width / 2, y).catch(() => undefined);
    await page.mouse.down().catch(() => undefined);
    if (mode !== "sides") return;
    // Over several frames, so a game that reads how far the finger moved since the last frame sees it.
    const to = which === "a" ? 0.2 : 0.8;
    for (let i = 1; i <= 6; i++) {
      await page.waitForTimeout(20);
      await page.mouse.move(box.x + box.width * (0.5 + ((to - 0.5) * i) / 6), y).catch(() => undefined);
    }
  };
  const release = async (which: "a" | "b") => {
    if (mode === "keys") await page.keyboard.up(which === "a" ? "ArrowLeft" : "ArrowRight").catch(() => undefined);
    else if (mode === "sides" || which === "a") await page.mouse.up().catch(() => undefined);
  };
  /** Hold one input for a moment: how far the player moved, or null if the round ended or changed. */
  const window_ = async (which: "a" | "b", ms: number) => {
    let from = await liveAt(page);
    if (!from && (await playAgain(page))) {
      await page.waitForTimeout(250);
      from = await liveAt(page);
    }
    if (!from) return null;
    await press(which);
    await page.waitForTimeout(ms);
    await release(which);
    const to = await liveAt(page);
    return to && to.round === from.round ? { dx: to.x - from.x, dy: to.y - from.y } : null;
  };

  /** Leave the player alone: how far the game moves them by itself, along each axis, counting every turn. */
  const idle = async () => {
    let from = await liveAt(page);
    if (!from && (await playAgain(page))) {
      await page.waitForTimeout(250);
      from = await liveAt(page);
    }
    if (!from) return null;
    const path = { dx: 0, dy: 0 };
    for (let waited = 0; waited < IDLE_MS; waited += 100) {
      await page.waitForTimeout(100);
      const at = await liveAt(page);
      if (!at || at.round !== from.round) return null;
      path.dx += Math.abs(at.x - from.x);
      path.dy += Math.abs(at.y - from.y);
      from = at;
    }
    return path;
  };
  // How fast the game runs against the clock. A stalled checker runs it slowly, and then a moment of
  // drift or a held input proves nothing either way: the controls aren't judged (D119).
  const clock = async () => ({ game: (await probeReport(page))?.time ?? 0, real: Date.now() });
  const tooSlow = (from: { game: number; real: number }, to: { game: number; real: number }) => (to.game - from.game) / Math.max(0.001, (to.real - from.real) / 1000) < GAME_CHECK_SPEED / 2;
  // Let the last move settle, then see whether the game moves the player on its own.
  await page.waitForTimeout(250);
  const started = await clock();
  let drift: { dx: number; dy: number } | null = null;
  for (let i = 0; i < 5 && !drift; i++) drift = await idle();
  const after = await probeReport(page);
  const last = after?.rounds.at(-1);
  const span = last ? Math.max((last.xMax ?? 0) - (last.xMin ?? 0), (last.yMax ?? 0) - (last.yMin ?? 0)) : 0;
  const unjudged = { issues: [], note: "the controls weren't judged (rounds ended too quickly, or the game ran too slowly here)" };
  if (!drift || tooSlow(started, await clock())) return unjudged;
  if (Math.hypot(drift.dx, drift.dy) <= span * 0.02) return { issues: [] };

  const judge = async () => {
    const from = await clock();
    const trials: ControlTrial[] = [];
    for (let i = 0; trials.length < TRIALS && i < TRIALS * 2; i++) {
      // One way then the other, then the other way first, so the game's own steady pull cancels out.
      const order: ("a" | "b")[] = trials.length % 2 ? ["b", "a"] : ["a", "b"];
      const moved: Partial<Record<"a" | "b", { dx: number; dy: number }>> = {};
      for (const which of order) {
        const m = await window_(which, HOLD_MS);
        if (!m) break;
        moved[which] = m;
      }
      if (moved.a && moved.b) trials.push({ a: moved.a, b: moved.b });
    }
    return tooSlow(from, await clock()) ? { verdict: "unjudged" as const } : judgeControls(trials, drift);
  };
  let judged = await judge();
  // "keys" may mean only Space (a jump) in a game steered by touch: arrows that do nothing aren't proof.
  // Try a finger dragged to each side too, the way a phone plays it: a "works" there settles it.
  if (judged.verdict === "dead" && mode === "keys") {
    mode = "sides";
    judged = await judge();
  }
  // Only a dead hold is reported. Steering by keys or touch that seems dead isn't: a game that steers by how
  // far the finger moved sees little of a drag on a busy checker, and a wrong report costs a fix (D119).
  if (judged.verdict === "dead" && !hold) return { issues: [], note: "the controls weren't judged (the arrows and a dragged finger seemed to do nothing, which a busy checker can't tell from a slow game)" };
  if (judged.verdict === "dead") {
    return {
      issues: [
        "Holding down on the game didn't change how the player moves: the game moves them by itself, but the hold does nothing. Read input.pointer.down (or input.action) in the frame function and use it to move the player.",
      ],
    };
  }
  return judged.verdict === "unjudged" ? unjudged : { issues: [] };
}

const seconds = (r: ProbeRound, now: number) => (r.end ?? now) - r.start;
const list = (names: string[]) => names.map((n) => `"${n}"`).join(", ");

/** What the probe saw, as problems for the builder. Silent where the bot couldn't tell. */
export function judgeRounds(report: ProbeReport | null, options: { pressedPlay?: boolean; canvas?: boolean | "3d" } = {}): { issues: string[]; note: string } {
  if (!report) return { issues: [], note: "the game probe wasn't on" };
  const style = styleOf(report);
  const action = style === "action";
  const canvas = options.canvas ?? true;
  const played = report.rounds.filter((r) => r.frames > 0 || (r.moves ?? 0) > 0);
  if (!report.rounds.length) {
    // Play was pressed with the probe on and a game that reports rounds, and nothing started: a dead button.
    if (options.pressedPlay) {
      return {
        issues: [
          canvas === "3d"
            ? "Pressing Play didn't start the game: no round began. Make the Play button set the screen to playing (Scene3D paused={false}), and make sure it isn't disabled."
            : canvas
            ? "Pressing Play didn't start the game: no round began. Make the Play button set the screen to playing (GameCanvas paused={false}), and make sure it isn't disabled."
            : "Pressing Play didn't start the game: no round began. Call round(true) from src/game/probe.ts when play starts and round(false) at game over, and make sure the Play button isn't disabled.",
        ],
        note: "Play started nothing",
      };
    }
    return { issues: [], note: "no round started" };
  }
  if (report.probes === 0 && !played.some((r) => (r.moves ?? 0) > 0)) {
    return {
      issues: [
        canvas === "3d"
          ? "The game ran but never called probe(score, player.position.x, player.position.z, speed) while playing, so GoodBuild couldn't test it. Call it once per frame in the frame function onReady returns (src/game/probe.ts)."
          : canvas
          ? "The game ran but never called probe(score, player.x, player.y, speed) while playing, so GoodBuild couldn't test it. Call it once per frame in onFrame (src/game/probe.ts)."
          : "The game ran but never called probe(score) or moved() while playing, so GoodBuild couldn't test it. Call probe(score) when a round starts and whenever the score changes, and moved() for every move the game accepts (src/game/probe.ts).",
      ],
      note: "no probe calls",
    };
  }
  const issues: string[] = [];
  const total = played.reduce((t, r) => t + seconds(r, report.time), 0);
  const longest = Math.max(0, ...played.map((r) => seconds(r, report.time)));
  const moves = played.reduce((n, r) => n + (r.moves ?? 0), 0);
  const scored = played.some((r) => (r.scoreMax ?? 0) > (r.score0 ?? 0));

  if (action) {
    if (total >= 2 && !scored) {
      issues.push(`The score never went up in ${Math.round(total)} seconds of play. Add to the score as the player progresses (distance, things passed or collected) and pass it to probe().`);
    }

    const long = played.filter((r) => seconds(r, report.time) >= FIRST_HAZARD_S);
    if (long.length && !long.some((r) => r.firstHazard !== undefined && r.firstHazard <= FIRST_HAZARD_S)) {
      const first = long.map((r) => r.firstHazard).filter((t): t is number => t !== undefined);
      issues.push(
        first.length
          ? `The first obstacle came ${Math.min(...first).toFixed(1)} seconds after Play. Bring one within 3 seconds (a short grace, then something to dodge), and call spawned(kind) when it appears.`
          : "Nothing got in the player's way: no obstacle or character appeared after Play. Spawn one within 3 seconds and call spawned(kind) when it appears.",
      );
    }
  } else {
    // A puzzle or turn-based game has no rush: it is judged by the moves the bot made, not by the clock.
    const how = list(report.declared?.controls?.length ? report.declared.controls : ["sides", "keys"]);
    if (total >= MOVE_S && moves === 0) {
      issues.push(
        `In ${Math.round(total)} seconds of play with the game's controls (${how}) the game never accepted a move. Make every tile, card or answer respond to a tap or swipe, call moved() from src/game/probe.ts each time a move is made, and list the controls the game really uses in declareGame({ controls }).`,
      );
    } else if (moves >= SCORE_MOVES && !scored) {
      issues.push(`The score never went up in ${moves} moves. Score for good moves (a match, a right answer, a cleared row) and pass the score to probe(score) whenever it changes.`);
    }
  }

  const declared = [...(report.declared?.obstacles ?? []), ...(report.declared?.powerups ?? []), ...(report.declared?.npcs ?? [])];
  // Judged within rounds: a kind counts when it appeared in the first 15 seconds of a round that lasted at least that long.
  // Every kind must show in the same round: the long round that met the most of them is the one judged.
  const longEnough = played.filter((r) => seconds(r, report.time) >= ALL_KINDS_S);
  const earlyIn = (r: ProbeRound) => new Set(Object.entries(r.kinds ?? {}).filter(([, t]) => t <= ALL_KINDS_S).map(([k]) => k));
  const best = longEnough.map(earlyIn).sort((a, b) => declared.filter((k) => b.has(k)).length - declared.filter((k) => a.has(k)).length)[0];
  const unseen = declared.filter((k) => !(best ? best.has(k) : k in report.seen));
  if (unseen.length && longEnough.length) {
    issues.push(`In a round of ${Math.round(longest)} seconds these never appeared in the first 15: ${list(unseen)}. Bring each kind in within the first 15 seconds of a round, and call spawned(kind) with the same name when one is created.`);
  }

  if (action) {
    const busy = played.filter((r) => r.frames >= 30 && r.xMin !== undefined);
    if (busy.length && busy.every((r) => r.xMin === r.xMax && r.yMin === r.yMax)) {
      issues.push(
        canvas === "3d"
          ? "Playing with the game's controls never moved the player. Read input in the frame function (input.left, input.right, input.actionPressed, input.pointer) and pass the player's position (x and z) to probe()."
          : "Tapping both sides of the game and pressing the arrow keys and Space never moved the player. Read input in onFrame (input.left, input.right, input.actionPressed, input.pointer) and pass the player's position to probe().",
      );
    }

    const longRounds = played.filter((r) => seconds(r, report.time) >= HARDER_S && r.speed0 !== undefined);
    if (longRounds.length && longRounds.every((r) => (r.speedMax ?? 0) <= (r.speed0 ?? 0) * 1.02)) {
      issues.push(`The game didn't get harder in ${Math.round(Math.max(...longRounds.map((r) => seconds(r, report.time))))} seconds: the speed passed to probe() never rose. Raise the speed or the spawn rate with difficulty(time), and pass the speed to probe().`);
    }

    // Made on a timer (setInterval, setTimeout) instead of in onFrame: it keeps coming while the game is
    // paused or over, and doesn't speed up with the game. Only seen with a GameCanvas that marks its frames.
    if (report.frames && report.offFrame?.length) {
      issues.push(
        `${list(report.offFrame)} ${report.offFrame.length === 1 ? "is" : "are"} made on a timer (setInterval or setTimeout) instead of in onFrame, so ${report.offFrame.length === 1 ? "it keeps" : "they keep"} coming while the game is paused or over. Make them in ${canvas === "3d" ? "the scene's frame function" : "onFrame"} with a Spawner from src/game/world.ts (or a counter that adds dt), and remove the timer.`,
      );
    }
  }

  const kinds = Object.keys(report.seen);
  const note = `${action ? "" : `${style} game, ${moves} move${moves === 1 ? "" : "s"}, `}played ${played.length} round${played.length === 1 ? "" : "s"}, ${Math.round(total)}s of game${kinds.length ? `, saw ${kinds.join(", ")}` : ""}${unseen.length && !longEnough.length ? ` (not long enough to judge ${unseen.join(", ")})` : ""}`;
  return { issues, note };
}

/** Play until a round ends, up to ms. True when one did. */
export async function playUntilOver(page: Page, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  const controls = await declaredControls(page);
  while (Date.now() < deadline) {
    if (roundOver(await probeReport(page))) return true;
    await fidget(page, controls);
    await page.waitForTimeout(110);
  }
  return false;
}

/** Press the start screen's Play button. False when there isn't one. */
export async function pressPlay(page: Page): Promise<boolean> {
  const start = page.getByRole("button", { name: /\b(play|start|begin|go|race|tap to)\b/i }).first();
  if (!(await start.isVisible().catch(() => false))) return false;
  await start.click({ timeout: 1_500 }).catch(() => undefined);
  return true;
}

/**
 * With a browser wallet: Connect wallet (if the page has one) shows the account, and after a game over
 * a score can be posted and appears on the board. The page has the stand-in wallet and the probe on.
 */
export async function walletAndBoard(page: Page, options: { board: boolean }): Promise<{ issues: string[]; note: string }> {
  const issues: string[] = [];
  const notes: string[] = [];
  const connect = page.getByRole("button", { name: /connect( a| your)? wallet/i }).first();
  if (await connect.isVisible().catch(() => false)) {
    await connect.click({ timeout: 1_500 }).catch(() => undefined);
    await pickBrowserWallet(page);
    const shown = await page
      .waitForFunction((short) => document.body.innerText.includes(short), CHECK_WALLET_SHORT, { timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    const asked = await page.evaluate(() => ((window as unknown as { __gbWalletCalls?: string[] }).__gbWalletCalls ?? []).some((m) => m === "eth_requestAccounts" || m === "wallet_requestPermissions")).catch(() => false);
    if (!asked) issues.push("Connect wallet didn't ask the browser's wallet for an account. Use ConnectButton or useWallet().connect() from the starter; don't write your own.");
    else if (!shown) issues.push("A browser wallet connected, but the page didn't show it: after connecting, show the account (shortAddress) where Connect wallet was.");
    else notes.push("a browser wallet connected");
  }
  if (!options.board) return { issues, note: notes.join(", ") };

  if (!(await pressPlay(page))) return { issues, note: notes.join(", ") };
  // A bot playing at random can lose a round with nothing scored (a quiz answered wrong three times: about
  // 4 in 10 rounds), so it gets up to six rounds, within 12 seconds, to score something worth posting.
  // A puzzle ends when its moves run out, not when the bot crashes: a round of 20 moves takes it about
  // 8 seconds, so a game with no rush gets longer (D117). A long round may use the whole time: stopping it
  // early only made a slow checker report that no round ended (D119).
  const calm = styleOf(await probeReport(page)) !== "action";
  let score = 0;
  const until = Date.now() + (calm ? 16_000 : 12_000);
  for (let attempt = 0; attempt < 6 && score <= 0 && Date.now() < until; attempt++) {
    if (attempt > 0) {
      const again = page.getByRole("button", { name: PLAY_AGAIN }).first();
      if (!(await again.isVisible().catch(() => false))) break;
      await again.click({ timeout: 1_000 }).catch(() => undefined);
      await page.waitForTimeout(200);
    }
    if (!(await playUntilOver(page, Math.max(1_500, until - Date.now())))) return { issues, note: [...notes, "no round ended, so no score was posted"].join(", ") };
    score = (await probeReport(page))?.rounds.at(-1)?.scoreMax ?? 0;
  }
  if (score <= 0) return { issues, note: [...notes, "the rounds scored 0, so no score was posted"].join(", ") };
  const name = page.locator("#board-name");
  if (!(await name.isVisible({ timeout: 1_500 }).catch(() => false))) {
    await page.waitForTimeout(800);
    if (!(await name.isVisible().catch(() => false))) {
      issues.push("After a game over with a score there's no way to post it: show <PostScore board={board} score={score} /> (src/game/Leaderboard.tsx) on the game-over screen.");
      return { issues, note: notes.join(", ") };
    }
  }
  await name.fill("Check Bot");
  await page.getByRole("button", { name: /post score/i }).first().click({ timeout: 1_500 }).catch(() => undefined);
  await pickBrowserWallet(page);
  const posted = await page
    .waitForFunction(() => /You're on the board!/.test(document.body.innerText) && Array.from(document.querySelectorAll("li")).some((li) => li.textContent?.includes("Check Bot")), undefined, { timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  if (!posted) {
    const alert = await page.getByRole("alert").first().innerText({ timeout: 300 }).catch(() => "");
    issues.push(`Posting a score with a wallet didn't put it on the leaderboard${alert ? `: the page said "${alert.slice(0, 160)}"` : ""}. Use useLeaderboard, Leaderboard and PostScore from the kit, with the same board passed to both.`);
  } else notes.push("a score was posted and shown on the board");
  return { issues, note: notes.join(", ") };
}

/** Inside MiniPay (a stand-in): no Connect button, no signature asked for, and Play still works. */
export async function insideMiniPay(page: Page): Promise<{ issues: string[]; note: string }> {
  const issues: string[] = [];
  await page.waitForTimeout(900);
  if (await page.getByRole("button", { name: /connect( a| your)? wallet/i }).first().isVisible().catch(() => false)) {
    issues.push("Inside MiniPay the page shows a Connect wallet button. MiniPay connects by itself: hide the button when isMiniPay() is true.");
  }
  if (await pressPlay(page)) {
    const controls = await declaredControls(page);
    for (let i = 0; i < 10; i++) {
      await fidget(page, controls);
      await page.waitForTimeout(110);
    }
  }
  const calls = await page.evaluate(() => (window as unknown as { __gbWalletCalls?: string[] }).__gbWalletCalls ?? []).catch(() => [] as string[]);
  const signed = calls.filter((m) => m === "personal_sign" || m === "eth_sign" || m.startsWith("eth_signTypedData"));
  if (signed.length) issues.push(`Inside MiniPay the app asked for a signature (${signed[0]}) without the player doing anything that needs one. MiniPay doesn't allow sign-in signatures.`);
  const connected = calls.includes("eth_requestAccounts") || calls.includes("eth_accounts");
  return { issues, note: connected ? "MiniPay connected by itself" : "MiniPay wasn't asked for an account" };
}
