import "server-only";

import type { Browser, BrowserContext, Page, Route } from "playwright-core";

import { buildPublishedApp, PublishBuildError, type PublishedFile } from "@/server/publish/build";

import type { CheckIssue } from "./checks";

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
  /** The project's chain, for the wallet-less RPC stub. */
  chainId?: number;
  /** Also return screenshots at phone and desktop width. */
  screenshots?: boolean;
  timeoutMs?: number;
  /** Tests: a browser to use instead of the shared one. */
  browser?: Browser;
}

export interface RunCheckResult {
  /** False when the check couldn't run (no browser, too slow). That is never held against the app. */
  ran: boolean;
  issues: CheckIssue[];
  /** Why it didn't run, or what it covered, for the build log. */
  note: string;
  ms: number;
  screenshots?: Array<{ width: number; png: Uint8Array }>;
}

export const PHONE = { width: 375, height: 812 };
export const DESKTOP = { width: 1280, height: 800 };
const ORIGIN = "http://app.goodbuild.test";
const MAX_ISSUES = 5;
const MAX_ROUTES = 6;
const MAX_SHOT_HEIGHT = 2400;
const DEFAULT_TIMEOUT_MS = 25_000;
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
  const starts: Array<{ line: number; file: string }> = [];
  js.split("\n").forEach((text, i) => {
    const m = /^\s*\/\/ (.+)$/.exec(text);
    if (!m) return;
    const project = /^project:(.+)$/.exec(m[1]);
    // A package's module ends the project file above it.
    if (project || /node_modules\//.test(m[1])) starts.push({ line: i + 1, file: project ? project[1] : "" });
  });
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

async function check(context: BrowserContext, files: PublishedFile[], options: RunCheckOptions): Promise<Omit<RunCheckResult, "ms">> {
  const js = files.find((f) => /^app\.[0-9a-f]{12}\.js$/.test(f.path));
  const jsText = js ? new TextDecoder().decode(js.bytes) : "";
  await context.route("**/*", serve(files, new Set(options.assets ?? []), options.chainId ?? 11142220));
  // A socket can't be answered from memory; close it so nothing leaves through one.
  await context.routeWebSocket(/.*/, (ws) => ws.close());

  const page = await context.newPage();
  const seen: Seen[] = [];
  // React's development build names the component in a console message next to the error. Both are
  // kept in the order they arrived, and each error takes the first name logged after it.
  const named: Array<{ at: number; component: string }> = [];
  let events = 0;
  let route = "/";
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const m = /error occurred in (?:the )?<([A-Za-z0-9_.]+)>/.exec(msg.text());
    if (m) named.push({ at: events++, component: m[1] });
  });
  page.on("pageerror", (error) => {
    const full = error.message || String(error);
    const message = full.split("\n")[0].slice(0, 400);
    if (NOT_THE_APP.test(full) || seen.some((s) => s.message === message)) return;
    seen.push({ message, stack: error.stack ?? "", route, at: events++ });
  });

  await page.goto(`${ORIGIN}/`, { waitUntil: "load" });
  // First render plus the effects that follow it.
  await page.waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0, undefined, { timeout: 4_000 }).catch(() => undefined);
  await settle(page, 600);

  const blank = await page.evaluate(() => {
    const root = document.getElementById("root");
    return !root || (root.childElementCount === 0 && !(root.textContent ?? "").trim());
  });

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

  let screenshots: RunCheckResult["screenshots"];
  if (options.screenshots) {
    await page.evaluate(() => {
      window.location.hash = "#/";
    });
    screenshots = [];
    for (const size of [PHONE, DESKTOP]) {
      await page.setViewportSize(size);
      await settle(page, 250);
      const height = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), MAX_SHOT_HEIGHT);
      screenshots.push({ width: size.width, png: await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: size.width, height: Math.max(height, size.height) } }) });
    }
  }

  const issues: CheckIssue[] = seen.slice(0, MAX_ISSUES).map((s, i) => {
    const next = seen[i + 1]?.at ?? Infinity;
    const component = named.find((n) => n.at > s.at && n.at < next)?.component;
    const file = (js && sourceOfStack(s.stack, jsText, js.path)) || "src/App.tsx";
    const where = s.route === "/" ? "" : ` on the ${s.route} page`;
    const inside = component ? ` (in <${component}>)` : "";
    return { file, message: `The app crashed when it ran${where}: ${s.message}${inside}`, source: "runtime" };
  });
  if (blank && !issues.length) {
    issues.push({ file: "src/App.tsx", message: "The app ran but showed nothing: the page is empty. src/App.tsx must render the app's content.", source: "runtime" });
  }
  const note = issues.length ? `${issues.length} problem${issues.length === 1 ? "" : "s"} when the app ran` : `opened ${routes.length === 1 ? "the app" : `${routes.length} pages`} with no errors`;
  return { ran: true, issues, note, ...(screenshots ? { screenshots } : {}) };
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
    context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block", acceptDownloads: false, permissions: [] });
    const timeout = new Promise<Omit<RunCheckResult, "ms">>((resolve) => {
      timer = setTimeout(() => resolve({ ran: false, issues: [], note: "skipped: the app took too long to open" }), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    });
    return done(await Promise.race([check(context, built, options), timeout]));
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
