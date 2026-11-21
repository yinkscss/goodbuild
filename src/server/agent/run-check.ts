import "server-only";

import { checkTicTacToe } from "./delivery-check";
import type { Browser, BrowserContext, Page, Route } from "playwright-core";

import { buildPublishedApp, moduleStarts, PublishBuildError, type PublishedFile } from "@/server/publish/build";

import type { CheckIssue } from "./checks";
import { CHECK_WALLET, checkControls, GAME_CHECK_SPEED, gameCanvas, gameCheckScript, insideMiniPay, judgeRounds, pickBrowserWallet, playRounds, probeReport, standInWalletScript, walletAndBoard } from "./game-check";
import { ALL_FLOWS_MS, parseFlows, runFlows, type FlowResult } from "./acceptance";
import { KITS, kitIdsOf } from "./kits/registry";

/** Every file a kit ships, so the game's own code can be told apart from GoodBuild's. */
const KIT_FILES: Record<string, true> = Object.fromEntries(KITS.flatMap((k) => Object.keys(k.files).map((p) => [p, true] as const)));

/**
 * The run check (D67): build the app the way publishing does, open it in a headless browser and
 * report what breaks when it runs. Compiling and linting can't see a crash on first render, a page
 * that mounts nothing or a route that throws; until now only a person with the preview open could.
 *
 * The page is generated code, so it gets nothing: every request is answered from memory here, and
 * anything to another host is refused (a chain RPC gets a stub answer). In production the browser
 * runs in its own container with no secrets and no way out (RUN_CHECK_WS_ENDPOINT, deploy/docker-compose.yml).
 */

export interface RunCheckOptions {
  /** Uploaded image names, served as blank placeholders so a real asset isn't reported as broken. */
  assets?: string[];
  delivery?: { id: string; goal: string; verifyWallet?: boolean };
  /** The project's chain, for the wallet-less RPC stub. */
  chainId?: number;
  /** The project is a game or a 3D scene: start it and play for a moment (set from its kits). */
  game?: boolean;
  /** A 2D game (the game-2d kit): its start screen must draw the game and have a Play button (D93), and it is played with the probe on (D94). */
  game2d?: boolean;
  /** The game shows PostScore: post a score with a stand-in wallet and look for it on the board (D94). */
  board?: boolean;
  /** The MiniPay kit is on: open the game as MiniPay too (D94). */
  miniPay?: boolean;
  /** The project's GameCanvas reports rounds to the probe, so a Play that starts none is a fault (D95). */
  probeReady?: boolean;
  /** The game draws in a GameCanvas. A game without one (a quiz, a grid of buttons) reports rounds with round() (D112). */
  canvas?: boolean;
  /** A 3D game: a Scene3D with the game probe. Played like a 2D game, its start screen judged by the 3D canvas (D113). */
  game3d?: boolean;
  /** The project draws a 3D scene from shapes alone: look for one that shows nothing but its background (set from its kits and files). */
  scene?: boolean;
  /** Also return screenshots at phone and desktop width. */
  screenshots?: boolean;
  /** Also return a text outline of a page (D152: the builder's open_app tool). route defaults to the home page. */
  outline?: { route?: string };
  /** Run the spec's acceptance flows (D152), each on a fresh page; `only` runs the flows whose name contains it. */
  acceptance?: { flows: unknown[]; only?: string };
  timeoutMs?: number;
  /** Tests: a browser to use instead of the shared one. */
  browser?: Browser;
  /** Tests: a script run on every page before the app's own, to stand in for an older browser. */
  initScript?: string;
  /** Tests: stand in for a cheap phone: a touch screen, and the CPU slowed this many times. */
  phone?: { cpuSlowdown: number };
  /** Tests: called with the page once a game has been played and judged, before the wallet steps. */
  afterPlay?: (page: Page) => Promise<void>;
}

export interface RunCheckResult {
  /** False when the check couldn't run (no browser, too slow). That is never held against the app. */
  ran: boolean;
  deliveryVerified?: boolean;
  issues: CheckIssue[];
  /** Why it didn't run, or what it covered, for the build log. */
  note: string;
  ms: number;
  /** For a 2D game, the first is the start screen and the second is a moment into play (phone width). */
  screenshots?: Array<{ width: number; png: Uint8Array; shows?: "start" | "playing" }>;
  /** What the page shows, as text: headings, buttons, links, inputs and the start of its text (options.outline). */
  outline?: string;
  /** Each acceptance flow's result (options.acceptance). Reported, never turned into issues here: the runner decides. */
  acceptance?: FlowResult[];
}

export const PHONE = { width: 375, height: 812 };
export const DESKTOP = { width: 1280, height: 800 };
const ORIGIN = "http://app.goodbuild.test";
const MAX_ISSUES = 5;
const MAX_ROUTES = 6;
const MAX_SHOT_HEIGHT = 2400;
const DEFAULT_TIMEOUT_MS = 25_000;
/** A 2D game is played for about 7 seconds, then opened with a wallet and as MiniPay (D94). */
const GAME_TIMEOUT_MS = 50_000;
/** Keep the shared browser this long after the last check, then free its memory. */
const IDLE_CLOSE_MS = 60_000;

/** Off unless the server says so: a machine without the browser installed must not slow every build down. */
export function runCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RUN_CHECK === "1" || Boolean(env.RUN_CHECK_WS_ENDPOINT);
}

// ---------------------------------------------------------------------------
// One shared browser, a few checks at a time

let shared: Promise<Browser> | undefined;
let idle: NodeJS.Timeout | undefined;
let active = 0;
const waiting: Array<() => void> = [];

function limit(): number {
  return Math.max(1, Number(process.env.RUN_CHECK_CONCURRENCY) || 1);
}

async function acquire() {
  if (active >= limit()) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  if (idle) clearTimeout(idle);
}

function release() {
  active--;
  const next = waiting.shift();
  if (next) return next();
  if (active === 0) {
    idle = setTimeout(() => void closeRunCheckBrowser(), IDLE_CLOSE_MS);
    idle.unref();
  }
}

/** After the browser failed to start, don't try again for a while: every build would wait on it. */
const RETRY_AFTER_MS = 60_000;
let downUntil = 0;

async function sharedBrowser(): Promise<Browser> {
  if (!shared && Date.now() < downUntil) throw new Error("it failed to start a moment ago");
  shared ??= (async () => {
    const { chromium } = await import("playwright-core");
    const endpoint = process.env.RUN_CHECK_WS_ENDPOINT;
    const browser = endpoint
      ? await chromium.connect(endpoint, { timeout: 4_000 })
      : await chromium.launch({ headless: true, args: ["--disable-background-networking", "--mute-audio"] });
    browser.on("disconnected", () => {
      shared = undefined;
    });
    return browser;
  })().catch((error: unknown) => {
    shared = undefined;
    downUntil = Date.now() + RETRY_AFTER_MS;
    throw error;
  });
  return shared;
}

/** True when `work` finished within `ms`. A page stuck in a loop can make closing wait for ever. */
async function within(ms: number, work: Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const done = work.then(
    () => true,
    () => true,
  );
  return Promise.race([done, late]).finally(() => clearTimeout(timer));
}

/** Close the shared browser (idle timer, worker shutdown, tests). */
export async function closeRunCheckBrowser() {
  const browser = shared;
  shared = undefined;
  downUntil = 0;
  if (browser) await within(5_000, browser.then((b) => b.close()));
}

// ---------------------------------------------------------------------------
// Serving the build to the page

const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const BLANK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

/** A chain RPC's answer with no chain behind it: enough for viem to start, an error for every read. */
export function rpcStub(body: unknown, chainId: number): unknown {
  const one = (req: { id?: unknown; method?: unknown }) => {
    const base = { jsonrpc: "2.0", id: req?.id ?? null };
    switch (req?.method) {
      case "eth_chainId":
        return { ...base, result: `0x${chainId.toString(16)}` };
      case "net_version":
        return { ...base, result: String(chainId) };
      case "eth_blockNumber":
        return { ...base, result: "0x1" };
      case "eth_accounts":
        return { ...base, result: [] };
      default:
        return { ...base, error: { code: -32000, message: "No network in GoodBuild's run check." } };
    }
  };
  return Array.isArray(body) ? body.map(one) : one(body as { id?: unknown; method?: unknown });
}

function serve(files: PublishedFile[], assets: Set<string>, chainId: number) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === ORIGIN) {
      const path = decodeURIComponent(url.pathname).replace(/^\//, "") || "index.html";
      const file = byPath.get(path);
      if (file) return route.fulfill({ status: 200, contentType: file.mime, body: Buffer.from(file.bytes) });
      const asset = /^assets\/(.+)$/.exec(path)?.[1];
      if (asset && assets.has(asset)) {
        return asset.endsWith(".svg") ? route.fulfill({ status: 200, contentType: "image/svg+xml", body: BLANK_SVG }) : route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
      }
      return route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" });
    }
    if (request.method() === "POST") {
      try {
        const body: unknown = JSON.parse(request.postData() ?? "");
        const first = (Array.isArray(body) ? body[0] : body) as { jsonrpc?: unknown } | null;
        if (first?.jsonrpc) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rpcStub(body, chainId)) });
      } catch {
        /* not JSON-RPC */
      }
    }
    // Web fonts: an empty stylesheet, so the page still lays out without reaching the internet.
    if (request.resourceType() === "stylesheet") return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    return route.abort("blockedbyclient");
  };
}

// ---------------------------------------------------------------------------
// Reading what went wrong

/** Failures of the network the check took away, not of the app. */
const NOT_THE_APP = /Failed to fetch|NetworkError|Load failed|net::ERR|ERR_BLOCKED_BY_CLIENT|HTTP request failed|No network in GoodBuild's run check|ResizeObserver loop/i;

/**
 * esbuild writes `// project:src/App.tsx` above each module in a build that isn't minified. The
 * first stack frame inside one of the project's own modules says which file to look at.
 */
export function sourceOfStack(stack: string, js: string, jsPath: string): string | undefined {
  const starts = moduleStarts(js);
  const frame = new RegExp(`${jsPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+):\\d+`, "g");
  for (const m of stack.matchAll(frame)) {
    const line = Number(m[1]);
    const owner = starts.filter((s) => s.line <= line).at(-1);
    if (owner?.file) return owner.file;
  }
  return undefined;
}

interface Seen {
  message: string;
  stack: string;
  route: string;
  /** Its place among the page's errors and console messages. */
  at: number;
}

function buildIssues(error: PublishBuildError): CheckIssue[] {
  const details = error.details.length ? error.details : [error.message];
  return details.slice(0, MAX_ISSUES).map((d) => {
    const m = /^(src\/[^:]+):(\d+): (.*)$/.exec(d);
    return m ? { file: m[1], line: Number(m[2]), message: m[3], source: "runtime" as const } : { file: "src/App.tsx", message: d, source: "runtime" as const };
  });
}

async function settle(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

/**
 * True when every WebGL canvas on the page is one flat colour. Asked inside a frame callback queued
 * after the scene's own, because a WebGL canvas forgets its picture once the frame is shown.
 */
async function flatScene(page: Page): Promise<boolean> {
  return page
    .evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          // No frame arrives in a tab that isn't drawing: say nothing rather than guess.
          const giveUp = setTimeout(() => resolve(false), 1_500);
          requestAnimationFrame(() => {
            clearTimeout(giveUp);
            const scenes = Array.from(document.querySelectorAll("canvas")).filter((c) => {
              if (c.width < 50 || c.height < 50) return false;
              try {
                // A canvas already drawing with WebGL gives no 2D context.
                return !c.getContext("2d");
              } catch {
                return true;
              }
            });
            if (!scenes.length) return resolve(false);
            resolve(
              scenes.every((c) => {
                try {
                  const probe = document.createElement("canvas");
                  probe.width = probe.height = 48;
                  const ctx = probe.getContext("2d");
                  if (!ctx) return false;
                  ctx.drawImage(c, 0, 0, 48, 48);
                  const d = ctx.getImageData(0, 0, 48, 48).data;
                  for (let i = 4; i < d.length; i += 4) {
                    if (Math.abs(d[i] - d[0]) > 3 || Math.abs(d[i + 1] - d[1]) > 3 || Math.abs(d[i + 2] - d[2]) > 3) return false;
                  }
                  return true;
                } catch {
                  return false;
                }
              }),
            );
          });
        }),
    )
    .catch(() => false);
}

/**
 * True when every big 2D canvas on the page is one flat colour (all see-through counts): a game
 * that drew nothing, or only filled its background. WebGL canvases are left alone.
 */
async function flat2dCanvas(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      // The game's own canvas when GameCanvas marked it, so a drawn Sprite elsewhere can't hide a blank game.
      const marked = document.querySelectorAll<HTMLCanvasElement>("canvas[data-game-canvas]");
      const pool = Array.from(marked.length ? marked : document.querySelectorAll<HTMLCanvasElement>("canvas"));
      const big = pool.filter((c) => c.width >= 50 && c.height >= 50);
      if (!big.length) return false;
      return big.every((c) => {
        try {
          // A canvas drawn with WebGL gives no 2D context here: leave those alone.
          const ctx = c.getContext("2d");
          if (!ctx) return false;
          const data = ctx.getImageData(0, 0, c.width, c.height).data;
          for (let i = 4 * 53; i < data.length; i += 4 * 53) {
            if (Math.abs(data[i] - data[0]) > 3 || Math.abs(data[i + 1] - data[1]) > 3 || Math.abs(data[i + 2] - data[2]) > 3 || Math.abs(data[i + 3] - data[3]) > 3) return false;
          }
          return true;
        } catch {
          return false;
        }
      });
    })
    .catch(() => false);
}

async function check(context: BrowserContext, files: PublishedFile[], options: RunCheckOptions): Promise<Omit<RunCheckResult, "ms">> {
  const js = files.find((f) => /^app\.[0-9a-f]{12}\.js$/.test(f.path));
  const jsText = js ? new TextDecoder().decode(js.bytes) : "";
  await context.route("**/*", serve(files, new Set(options.assets ?? []), options.chainId ?? 11142220));
  if (options.initScript) await context.addInitScript(options.initScript);
  // A socket can't be answered from memory; close it so nothing leaves through one.
  await context.routeWebSocket(/.*/, (ws) => ws.close());

  const page = await context.newPage();
  if (options.phone) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: options.phone.cpuSlowdown });
  const seen: Seen[] = [];
  // React's development build names the component in a console message next to the error. Both are
  // kept in the order they arrived, and each error takes the first name logged after it.
  const named: Array<{ at: number; component: string }> = [];
  let events = 0;
  let route = "/";
  /** Errors and component names from a page. Extra pages (a wallet, MiniPay) say where in place of the route. */
  const watch = (p: Page, where?: string) => {
    p.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const m = /error occurred in (?:the )?<([A-Za-z0-9_.]+)>/.exec(msg.text());
      if (m) named.push({ at: events++, component: m[1] });
    });
    p.on("pageerror", (error) => {
      const full = error.message || String(error);
      const message = full.split("\n")[0].slice(0, 400);
      if (NOT_THE_APP.test(full) || seen.some((s) => s.message === message)) return;
      seen.push({ message, stack: error.stack ?? "", route: where ?? route, at: events++ });
    });
  };
  const open = async (p: Page) => {
    await p.goto(`${ORIGIN}/`, { waitUntil: "load" });
    // First render plus the effects that follow it.
    await p.waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0, undefined, { timeout: 4_000 }).catch(() => undefined);
    await settle(p, 600);
  };
  watch(page);
  if ((options.delivery?.id === "wallet" || options.delivery?.verifyWallet)) await page.addInitScript(standInWalletScript({ miniPay: false, chainId: options.chainId ?? 11142220 }));
  // A 2D game is played for real (D94): the kit's probe records what happens. Not for the review's pictures.
  let played = Boolean(options.game2d || options.game3d);
  let deep = Boolean(played && !options.screenshots);
  // Normal speed at first, so the first moments of play look as a player sees them; faster once they're checked.
  // The probe is on for every 2D or 3D game at normal speed, so the check knows whether a round is running.
  if (played) await page.addInitScript(gameCheckScript(1));
  let pressedPlay = false;
  await open(page);
  let deliveryVerified = options.delivery?.id === "interface";
  const deliveryIssues: string[] = [];
  if (options.delivery && /tic[- ]tac[- ]toe/i.test(options.delivery.goal)) deliveryIssues.push(...await checkTicTacToe(page));
  if (options.delivery?.id === "wallet" || options.delivery?.verifyWallet) {
    const wallet = await walletAndBoard(page, { board: false });
    deliveryIssues.push(...wallet.issues);
    const walletVerified = wallet.note.includes("a browser wallet connected");
    if (options.delivery?.id === "wallet") deliveryVerified = walletVerified;
    if (!walletVerified && !wallet.issues.length) deliveryIssues.push("Wallet milestone: add a working Connect wallet button that asks the browser wallet for an account and displays it.");
  }
  // A 3D game on a checker with no WebGL shows Scene3D's plain message: there is nothing to play or judge,
  // so it is left alone rather than reported (as D85 does for scenes). Only when the browser really has no
  // WebGL: with WebGL, a game that never shows its scene is played and judged like any other.
  let no3d = false;
  const noWebGL = () =>
    page
      .evaluate(() => {
        const c = document.createElement("canvas");
        return !(c.getContext("webgl2") ?? c.getContext("webgl"));
      })
      .catch(() => false);
  if (options.game3d && !(await page.locator("canvas[data-game-canvas]").count().catch(() => 0)) && (await noWebGL())) {
    no3d = true;
    played = deep = false;
  }

  const blank = await page.evaluate(() => {
    const root = document.getElementById("root");
    return !root || (root.childElementCount === 0 && !(root.textContent ?? "").trim());
  });

  // A game (D72): play it for a moment. Press the start button, tap and steer, then look at the
  // canvas. This finds what loading alone can't: a crash on the first frame of play, and a game that
  // draws nothing.
  let blankGame = false;
  // A 2D game (D93): before Play, the start screen must show the game world and a Play button. A canvas
  // that is paused with nothing drawn is an empty box, the defect people saw most.
  let blankStart = false;
  let noPlay = false;
  const gameShots: NonNullable<RunCheckResult["screenshots"]> = [];
  const phoneShot = async (shows: "start" | "playing") => {
    if (options.screenshots && played) gameShots.push({ width: PHONE.width, png: await page.screenshot({ type: "png" }), shows });
  };
  if (!blank && !seen.length && options.game) {
    const start = page.getByRole("button", { name: /\b(play|start|begin|go|race|tap to)\b/i }).first();
    const hasStart = await start.isVisible().catch(() => false);
    if (played) {
      // Two frames of the idle loop, so a start screen that draws is seen drawing.
      await settle(page, 200);
      // A 3D start screen is read from inside the scene's own frame, twice, like the empty-scene check, and
      // only for a scene of shapes: one waiting for an uploaded model gets a blank stand-in here and looks empty.
      blankStart = options.game3d ? Boolean(options.scene) && (await flatScene(page)) && ((await settle(page, 300)), await flatScene(page)) : await flat2dCanvas(page);
      noPlay = !hasStart;
      await phoneShot("start");
    }
    if (hasStart) {
      await start.click({ timeout: 1_500 }).catch(() => undefined);
      pressedPlay = true;
    }
    await settle(page, 250);
    const canvas = await gameCanvas(page);
    if (await canvas.isVisible().catch(() => false)) {
      for (const key of ["Space", "ArrowRight", "ArrowLeft", "Space"]) {
        await canvas.click({ timeout: 1_000 }).catch(() => undefined);
        await page.keyboard.press(key).catch(() => undefined);
        await settle(page, 180);
      }
      await settle(page, 500);
      blankGame = await flat2dCanvas(page);
    }
    // A short round may already be over: the "playing" picture must show play, so start another first,
    // and take it only once a round is confirmed running. Otherwise the review gets no "playing" picture.
    // Also for a game of buttons with no canvas (a quiz, a grid), which reports its rounds with round().
    const running = async () => {
      const last = (await probeReport(page))?.rounds.at(-1);
      return Boolean(last && last.end === undefined);
    };
    const showing = (await canvas.isVisible().catch(() => false)) || (played && (await running()));
    if (showing) {
      if (options.screenshots && played && !(await running())) {
        await page.getByRole("button", { name: /\b(play|again|retry|restart|start|race)\b/i }).first().click({ timeout: 1_000 }).catch(() => undefined);
        await settle(page, 300);
      }
      if (!options.screenshots || !played || (await running())) await phoneShot("playing");
    }
  }

  // Play on (D94): rounds, Play again, what the probe saw. Then a stand-in wallet: Connect, posting a
  // score to the board, and MiniPay. Only when the game started cleanly, so one problem is reported once.
  const gameIssues: string[] = [];
  const gameNotes: string[] = [];
  if (no3d) gameNotes.push("no WebGL on this checker, so the 3D game wasn't played");
  if (deep && !blank && !blankStart && !noPlay && !blankGame && !seen.length) {
    await page.evaluate((speed) => {
      const g = (window as unknown as { __gbGame?: { speed: number } }).__gbGame;
      if (g) g.speed = speed;
    }, GAME_CHECK_SPEED);
    gameIssues.push(...(await playRounds(page)));
    const judged = judgeRounds(await probeReport(page), { pressedPlay: pressedPlay && Boolean(options.probeReady), canvas: options.game3d ? "3d" : (options.canvas ?? true) });
    gameIssues.push(...judged.issues);
    gameNotes.push(judged.note);
    // A game that moves the player by itself (a bending road, gravity): do the controls move them too (D118)?
    if (!gameIssues.length) {
      const controls = await checkControls(page);
      gameIssues.push(...controls.issues);
      if (controls.note) gameNotes.push(controls.note);
    }
    if (options.afterPlay) await options.afterPlay(page);
    if (!seen.length && !gameIssues.length) {
      const chainId = options.chainId ?? 11142220;
      const withWallet = await context.newPage();
      watch(withWallet, "with a browser wallet connected");
      await withWallet.addInitScript(gameCheckScript());
      await withWallet.addInitScript(standInWalletScript({ miniPay: false, chainId }));
      await open(withWallet);
      const w = await walletAndBoard(withWallet, { board: Boolean(options.board) });
      gameIssues.push(...w.issues);
      if (w.note) gameNotes.push(w.note);
      await withWallet.close().catch(() => undefined);
      if (options.miniPay && !seen.length) {
        const mini = await context.newPage();
        watch(mini, "inside MiniPay");
        await mini.addInitScript(gameCheckScript());
        await mini.addInitScript(standInWalletScript({ miniPay: true, chainId }));
        await open(mini);
        const m = await insideMiniPay(mini);
        gameIssues.push(...m.issues);
        gameNotes.push(m.note);
        await mini.close().catch(() => undefined);
      }
    }
  }

  // A 3D scene (D77): the frame can be read only in the same turn it was drawn, so this asks from inside
  // the page, right after the scene's own frame. One flat colour across the whole canvas, twice, means
  // the scene has nothing in view: the camera looks away, or nothing was added.
  let emptyScene = false;
  if (!blank && !seen.length && !blankGame && options.scene) {
    emptyScene = (await flatScene(page)) && ((await settle(page, 400)), await flatScene(page));
  }

  // Other pages of a multi-page app (HashRouter): follow the links the first page shows.
  const hashes = await page.evaluate((max) => {
    const found = new Set<string>();
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#/"]'))) {
      const href = a.getAttribute("href") ?? "";
      if (href !== "#/" && !href.includes(":")) found.add(href);
    }
    return [...found].slice(0, max);
  }, MAX_ROUTES - 1);
  const routes = ["/"];
  if (!blank && !seen.length) {
    for (const hash of hashes) {
      route = hash.slice(1);
      routes.push(route);
      await page.evaluate((h) => {
        window.location.hash = h;
      }, hash);
      await settle(page, 350);
    }
  }

  // The spec's acceptance flows (D152), each on its own fresh page in this context, so the app is served the same way.
  let acceptance: FlowResult[] | undefined;
  if (options.acceptance) {
    const { flows, problems } = parseFlows(options.acceptance.flows);
    acceptance = [
      ...problems.map((reason) => ({ name: "invalid flow", needs: "local" as const, status: "fail" as const, reason })),
      ...(await runFlows(flows, {
        newPage: async (wallet) => {
          const p = await context.newPage();
          if (wallet) await p.addInitScript(standInWalletScript({ miniPay: false, chainId: options.chainId ?? 11142220 }));
          return p;
        },
        open,
        connectWallet: async (p) => {
          // The page shows the account in any common form: the full address, or shortened with … or ...
          const showsAccount = (timeout: number) =>
            p
              .waitForFunction(
                ([full, head, tail]) => {
                  const text = document.body.innerText.toLowerCase();
                  return text.includes(full) || (text.includes(head) && text.includes(tail));
                },
                [CHECK_WALLET.toLowerCase(), CHECK_WALLET.slice(0, 6).toLowerCase(), CHECK_WALLET.slice(-4).toLowerCase()],
                { timeout },
              )
              .then(() => true)
              .catch(() => false);
          const button = p.getByRole("button", { name: /connect( a| your)? wallet/i }).first();
          if (!(await button.isVisible().catch(() => false))) return (await showsAccount(500)) ? null : "there is no Connect wallet button";
          await button.click({ timeout: 1_500 });
          await pickBrowserWallet(p);
          return (await showsAccount(5_000)) ? null : "the wallet connected but the page didn't show its address";
        },
        outline: (p) => p.evaluate(pageOutline),
      }, options.acceptance.only)),
    ];
  }

  // The builder's own look at a page (D152). Before the issues are read, so a crash on that route is reported too.
  let outline: string | undefined;
  if (options.outline) {
    const target = options.outline.route?.trim().replace(/^#/, "") || "/";
    route = target.startsWith("/") ? target : `/${target}`;
    await page.evaluate((r) => {
      document.documentElement.setAttribute("data-fx", "off");
      window.location.hash = `#${r}`;
    }, route).catch(() => undefined);
    await settle(page, 500);
    outline = await page.evaluate(pageOutline).catch((error) => `couldn't read the page: ${String((error as Error)?.message ?? error).slice(0, 160)}`);
  }

  let screenshots: RunCheckResult["screenshots"];
  if (options.screenshots) {
    await page.evaluate(() => {
      window.location.hash = "#/";
      // The motion kit (D84) hides a section until it is scrolled to: show the page in its final state.
      document.documentElement.setAttribute("data-fx", "off");
      // GoodBuild's own badge isn't the app's to fix: close it, the way a visitor can.
      const badge = document.getElementById("gb-bar-off") as HTMLInputElement | null;
      if (badge) badge.checked = true;
    });
    screenshots = [...gameShots];
    // A game's phone pictures were taken while it ran: only the computer one is left to take.
    for (const size of gameShots.length ? [DESKTOP] : [PHONE, DESKTOP]) {
      await page.setViewportSize(size);
      await settle(page, 250);
      const height = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), MAX_SHOT_HEIGHT);
      // fullPage, or the picture stops at the bottom of the window whatever the clip says.
      screenshots.push({ width: size.width, png: await page.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: size.width, height: Math.max(height, size.height) } }) });
    }
  }

  const issues: CheckIssue[] = seen.slice(0, MAX_ISSUES).map((s, i) => {
    const next = seen[i + 1]?.at ?? Infinity;
    const component = named.find((n) => n.at > s.at && n.at < next)?.component;
    const file = (js && sourceOfStack(s.stack, jsText, js.path)) || "src/App.tsx";
    const where = s.route === "/" ? "" : s.route.startsWith("/") ? ` on the ${s.route} page` : ` ${s.route}`;
    const inside = component ? ` (in <${component}>)` : "";
    return { file, message: `The app crashed when it ran${where}: ${s.message}${inside}`, source: "runtime" };
  });
  issues.push(...deliveryIssues.map((message) => ({ file: "src/App.tsx", message, source: "runtime" as const })));
  if (blankStart && !issues.length) {
    issues.push({
      file: "src/App.tsx",
      message: options.game3d
        ? "The start screen shows the 3D scene empty: nothing is in view before Play. Build the world in onReady (the track, the player) and point the camera at it: Scene3D draws it while paused, so the start screen shows the game."
        : "The start screen shows the game area as an empty box: nothing is drawn on the canvas before Play. Pass onIdleFrame to GameCanvas and draw the game world there (the track, the player standing still), the same drawing onFrame uses.",
      source: "runtime",
    });
  }
  if (noPlay && !issues.length) {
    issues.push({ file: "src/App.tsx", message: "The start screen has no Play button. Add a big <button> with the word Play or Start that begins the game, with no wallet needed.", source: "runtime" });
  }
  if (!issues.length) for (const message of gameIssues.slice(0, MAX_ISSUES)) issues.push({ file: "src/App.tsx", message, source: "runtime" });
  if (blankGame && !issues.length) {
    issues.push({ file: "src/App.tsx", message: "The game was started and played for a moment, but its canvas stayed blank or one flat colour: nothing was drawn but the background. Draw the game in GameCanvas's onFrame on every frame, and make sure the game isn't left paused once Play is pressed.", source: "runtime" });
  }
  if (emptyScene && !issues.length) {
    issues.push({ file: "src/App.tsx", message: "The 3D scene ran, but all it shows is its background colour: nothing is in view. Make sure the meshes are added to the scene (scene.add) inside onReady, and that the camera is placed back from them and looks at them (camera.position.set, camera.lookAt).", source: "runtime" });
  }
  if (blank && !issues.length) {
    issues.push({ file: "src/App.tsx", message: "The app ran but showed nothing: the page is empty. src/App.tsx must render the app's content.", source: "runtime" });
  }
  const opened = issues.length ? `${issues.length} problem${issues.length === 1 ? "" : "s"} when the app ran` : `opened ${routes.length === 1 ? "the app" : `${routes.length} pages`} with no errors`;
  const note = gameNotes.length ? `${opened}; ${gameNotes.filter(Boolean).join("; ")}` : opened;
  return { ran: true, deliveryVerified: Boolean(deliveryVerified && !issues.length), issues, note, ...(screenshots ? { screenshots } : {}), ...(outline !== undefined ? { outline } : {}), ...(acceptance ? { acceptance } : {}) };
}

/** Runs in the page: what a person sees, as short lines (open_app, D152). Self-contained, it is serialised. */
function pageOutline(): string {
  const clean = (s: string | null | undefined, max = 80) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const lines: string[] = [`route: ${window.location.hash.replace(/^#/, "") || "/"}`, `title: ${clean(document.title)}`];
  document.querySelectorAll("h1, h2, h3").forEach((h) => {
    if (visible(h)) lines.push(`${h.tagName.toLowerCase()}: ${clean(h.textContent)}`);
  });
  document.querySelectorAll("button, [role=button]").forEach((b) => {
    if (!visible(b)) return;
    const name = clean(b.getAttribute("aria-label") || b.textContent) || "(no text)";
    lines.push(`button: ${name}${(b as HTMLButtonElement).disabled ? " (disabled)" : ""}`);
  });
  document.querySelectorAll("a[href]").forEach((a) => {
    if (visible(a)) lines.push(`link: ${clean(a.getAttribute("aria-label") || a.textContent) || "(no text)"} -> ${clean(a.getAttribute("href"), 60)}`);
  });
  document.querySelectorAll("input, textarea, select").forEach((el) => {
    if (!visible(el)) return;
    const id = el.getAttribute("id");
    const label = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent) || el.closest("label")?.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder");
    lines.push(`${el.tagName.toLowerCase()}${el.getAttribute("type") ? ` (${el.getAttribute("type")})` : ""}: ${clean(label) || "(no label)"}`);
  });
  lines.push(`text: ${clean(document.body?.innerText, 900)}`);
  return lines.join("\n").slice(0, 4000);
}

/** Build the project and open it. Never throws: a check that can't run says so and reports nothing. */
export async function runCheck(files: Record<string, string>, options: RunCheckOptions = {}): Promise<RunCheckResult> {
  const started = Date.now();
  const done = (r: Omit<RunCheckResult, "ms">): RunCheckResult => ({ ...r, ms: Date.now() - started });

  let built: PublishedFile[];
  try {
    built = await buildPublishedApp({ files, assets: [], title: "Run check", hasUndeployedContracts: false, forCheck: true });
  } catch (error) {
    if (error instanceof PublishBuildError) return done({ ran: true, issues: buildIssues(error), note: "the app didn't build" });
    return done({ ran: false, issues: [], note: `skipped: the build step failed (${String((error as Error)?.message ?? error).slice(0, 120)})` });
  }

  const own = !options.browser;
  if (own) await acquire();
  let context: BrowserContext | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    const browser = options.browser ?? (await sharedBrowser());
    const kits = kitIdsOf(files);
    context = await browser.newContext({ viewport: PHONE, hasTouch: Boolean(options.phone), serviceWorkers: "block", acceptDownloads: false, permissions: [] });
    const timeout = new Promise<Omit<RunCheckResult, "ms">>((resolve) => {
      // Acceptance flows (D152) get their own time on top: ALL_FLOWS_MS bounds them.
      timer = setTimeout(() => resolve({ ran: false, issues: [], note: "skipped: the app took too long to open" }), (options.timeoutMs ?? (kits.includes("game-2d") ? GAME_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)) + (options.acceptance ? ALL_FLOWS_MS : 0));
    });
    const ticTacToe = options.delivery?.id === "interface" && /tic[- ]tac[- ]toe/i.test(options.delivery.goal);
    const game = ticTacToe ? false : options.game ?? (kits.includes("game-2d") || kits.includes("three-d"));
    // The game's own code, so the kit's files (which name GameCanvas and round in comments) don't count.
    const authored = Object.entries(files).filter(([p]) => /^src\/.*\.(tsx?|jsx?)$/.test(p) && !(p in KIT_FILES)).map(([, c]) => c);
    // A Scene3D game that reports to the probe is played like a 2D one (D113). A 3D scene that only borrows the
    // 2D kit's sound is a scene, not a 2D game: it gets the scene check, never the 2D start-screen rules.
    const scene3d = authored.some((c) => /<Scene3D\b/.test(c));
    const game3d = options.game3d ?? (scene3d && kits.includes("game-2d") && authored.some((c) => /\bdeclareGame\s*\(/.test(c)) && Boolean(files["src/three/Scene3D.tsx"]?.includes("checkRound")));
    const game2d = ticTacToe ? false : options.game2d ?? (kits.includes("game-2d") && !scene3d);
    const board = options.board ?? Object.entries(files).some(([p, c]) => p.startsWith("src/") && !p.startsWith("src/game/") && /<PostScore\b/.test(c));
    const miniPay = options.miniPay ?? kits.includes("mini-app");
    const canvas = options.canvas ?? authored.some((c) => /<GameCanvas\b/.test(c));
    // Rounds are reported by a GameCanvas that knows how, or by round() in a game without one. A game with neither
    // (a 3D scene that only borrows the 2D kit's sound) starts no round when Play is pressed, and that isn't a fault.
    const probeReady =
      options.probeReady ??
      (game3d ||
        (canvas && Boolean(files["src/game/GameCanvas.tsx"]?.includes("checkRound"))) || (Boolean(files["src/game/probe.ts"]?.includes("export function round")) && authored.some((c) => /(?<![.\w])round\s*\(\s*(?:true|false)\b/.test(c))));
    // A scene that waits for an uploaded model or picture is empty here (uploads are blank stand-ins), so only
    // scenes built from shapes are looked at.
    const scene = options.scene ?? (kits.includes("three-d") && !Object.entries(files).some(([p, c]) => p.startsWith("src/") && p !== "src/three/Scene3D.tsx" && /GLTFLoader|TextureLoader/.test(c)));
    return done(await Promise.race([check(context, built, { ...options, game, game2d, game3d, board, miniPay, probeReady, canvas, scene }), timeout]));
  } catch (error) {
    return done({ ran: false, issues: [], note: `skipped: the browser wasn't available (${String((error as Error)?.message ?? error).split("\n")[0].slice(0, 120)})` });
  } finally {
    if (timer) clearTimeout(timer);
    // A page that never yields (an endless loop) can't be closed politely: take the browser down with
    // it, so the next check starts a clean one instead of queueing behind a stuck page.
    if (context && !(await within(3_000, context.close())) && own) await closeRunCheckBrowser();
    if (own) release();
  }
}
