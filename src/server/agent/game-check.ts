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
}

export interface ProbeReport {
  time: number;
  rounds: ProbeRound[];
  seen: Record<string, number>;
  declared?: { obstacles?: string[]; powerups?: string[]; npcs?: string[] };
  probes: number;
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

/** One restless move: tap a side of the game, or press a key. */
async function fidget(page: Page): Promise<void> {
  const canvas = page.locator("canvas").first();
  // A short wait: after a game over the canvas may be gone, and the default wait is 30 seconds.
  const box = await canvas.boundingBox({ timeout: 300 }).catch(() => null);
  const move = Math.floor(Math.random() * 5);
  if (box && move < 2) {
    const x = move === 0 ? box.width * 0.2 : box.width * 0.8;
    await canvas.click({ position: { x, y: box.height * 0.7 }, timeout: 800 }).catch(() => undefined);
  } else {
    await page.keyboard.press(["ArrowLeft", "ArrowRight", "Space"][move - 2] ?? "Space").catch(() => undefined);
  }
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
    await fidget(page);
    await page.waitForTimeout(110);
  }
  return [];
}

const seconds = (r: ProbeRound, now: number) => (r.end ?? now) - r.start;
const list = (names: string[]) => names.map((n) => `"${n}"`).join(", ");

/** What the probe saw, as problems for the builder. Silent where the bot couldn't tell. */
export function judgeRounds(report: ProbeReport | null): { issues: string[]; note: string } {
  if (!report) return { issues: [], note: "the game probe wasn't on" };
  const played = report.rounds.filter((r) => r.frames > 0);
  if (!report.rounds.length) return { issues: [], note: "no round started" };
  if (report.probes === 0) {
    return {
      issues: ["The game ran but never called probe(score, player.x, player.y, speed) while playing, so GoodBuild couldn't test it. Call it once per frame in onFrame (src/game/probe.ts)."],
      note: "no probe calls",
    };
  }
  const issues: string[] = [];
  const total = played.reduce((t, r) => t + seconds(r, report.time), 0);
  const longest = Math.max(0, ...played.map((r) => seconds(r, report.time)));

  if (total >= 2 && !played.some((r) => (r.scoreMax ?? 0) > (r.score0 ?? 0))) {
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

  const declared = [...(report.declared?.obstacles ?? []), ...(report.declared?.powerups ?? []), ...(report.declared?.npcs ?? [])];
  const unseen = declared.filter((k) => !(k in report.seen));
  if (unseen.length && longest >= ALL_KINDS_S) {
    issues.push(`In ${Math.round(longest)} seconds of play these never appeared: ${list(unseen)}. Bring each kind in within the first 15 seconds of a round, and call spawned(kind) with the same name when one is created.`);
  }

  const busy = played.filter((r) => r.frames >= 30 && r.xMin !== undefined);
  if (busy.length && busy.every((r) => r.xMin === r.xMax && r.yMin === r.yMax)) {
    issues.push("Tapping both sides of the game and pressing the arrow keys and Space never moved the player. Read input in onFrame (input.left, input.right, input.actionPressed, input.pointer) and pass the player's position to probe().");
  }

  const longRounds = played.filter((r) => seconds(r, report.time) >= HARDER_S && r.speed0 !== undefined);
  if (longRounds.length && longRounds.every((r) => (r.speedMax ?? 0) <= (r.speed0 ?? 0) * 1.02)) {
    issues.push(`The game didn't get harder in ${Math.round(Math.max(...longRounds.map((r) => seconds(r, report.time))))} seconds: the speed passed to probe() never rose. Raise the speed or the spawn rate with difficulty(time), and pass the speed to probe().`);
  }

  const kinds = Object.keys(report.seen);
  const note = `played ${played.length} round${played.length === 1 ? "" : "s"}, ${Math.round(total)}s of game${kinds.length ? `, saw ${kinds.join(", ")}` : ""}${unseen.length && longest < ALL_KINDS_S ? ` (not long enough to judge ${unseen.join(", ")})` : ""}`;
  return { issues, note };
}

/** Play until a round ends, up to ms. True when one did. */
export async function playUntilOver(page: Page, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (roundOver(await probeReport(page))) return true;
    await fidget(page);
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
  if (!(await playUntilOver(page, 6_000))) return { issues, note: [...notes, "no round ended, so no score was posted"].join(", ") };
  const report = await probeReport(page);
  const score = report?.rounds.at(-1)?.scoreMax ?? 0;
  if (score <= 0) return { issues, note: [...notes, "the round scored 0, so no score was posted"].join(", ") };
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
    for (let i = 0; i < 10; i++) {
      await fidget(page);
      await page.waitForTimeout(110);
    }
  }
  const calls = await page.evaluate(() => (window as unknown as { __gbWalletCalls?: string[] }).__gbWalletCalls ?? []).catch(() => [] as string[]);
  const signed = calls.filter((m) => m === "personal_sign" || m === "eth_sign" || m.startsWith("eth_signTypedData"));
  if (signed.length) issues.push(`Inside MiniPay the app asked for a signature (${signed[0]}) without the player doing anything that needs one. MiniPay doesn't allow sign-in signatures.`);
  const connected = calls.includes("eth_requestAccounts") || calls.includes("eth_accounts");
  return { issues, note: connected ? "MiniPay connected by itself" : "MiniPay wasn't asked for an account" };
}
