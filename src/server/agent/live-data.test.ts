// @vitest-environment jsdom
/**
 * Live data in generated apps (D158), run as the app would run it: the starter's files are bundled
 * with esbuild (React 18 and viem from publish-runtime, like a published app) and loaded fresh for
 * each test, so the shared timer and its listeners never leak between tests.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { liveValueIssues } from "./live-check";
import { LIVE_PATH } from "./live-template";
import { starterFiles, withStarterHelpers } from "./template";
import { chainSourceFor } from "./wallet-template";

type Kind = "tx" | "data" | "wallet" | "focus" | "tick" | "manual";
interface Live {
  markChanged: (kind?: Kind) => Promise<void>;
  refreshAll: () => Promise<void>;
  subscribeChanges: (fn: (kinds: ReadonlySet<Kind>) => unknown, options?: { on?: Kind[] }) => () => void;
  lastRefreshedAt: () => number;
  ACTIVE_EVERY_MS: number;
  IDLE_EVERY_MS: number;
}
interface Bundle {
  live: Live;
  hooks: {
    useRead: <T>(fn: () => Promise<T>, deps: unknown[], enabled?: boolean, options?: { live?: boolean }) => { data: T | undefined; loading: boolean; refreshing: boolean; error: string | null; updatedAt: number | null; refresh: () => Promise<void> };
    useTx: () => { run: (send: () => Promise<{ status: string }>) => Promise<unknown> };
  };
  RefreshButton: (props: { read?: unknown; label?: string }) => unknown;
  React: typeof import("react");
  createRoot: (el: Element) => { render: (node: unknown) => void; unmount: () => void };
  act: (fn: () => unknown) => Promise<void>;
}

mkdirSync(path.join(process.cwd(), "node_modules", ".cache"), { recursive: true });
const dir = realpathSync(mkdtempSync(path.join(process.cwd(), "node_modules", ".cache", "gb-live-test-")));
let bundlePath: string | null = null;
let n = 0;

const BUILD_SCRIPT = `
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const [esbuildPath, input, output, runtimeDir] = process.argv.slice(2);
const { build } = await import(esbuildPath);
const files = JSON.parse(readFileSync(input, "utf8"));
const result = await build({
  stdin: { contents: files["<entry>"], loader: "tsx", resolveDir: "/" },
  bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "project", setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.namespace !== "project" && args.importer !== "<stdin>") return null;
      if (args.path.startsWith(".")) {
        const base = path.posix.join(args.importer === "<stdin>" ? "/" : path.posix.dirname(args.importer), args.path);
        const hit = [base, base + ".ts", base + ".tsx"].find((c) => c.slice(1) in files);
        return hit ? { path: hit, namespace: "project" } : { errors: [{ text: "missing " + base }] };
      }
      return b.resolve(args.path, { resolveDir: runtimeDir, kind: args.kind });
    });
    b.onLoad({ filter: /.*/, namespace: "project" }, (args) => ({ contents: files[args.path.slice(1)], loader: args.path.endsWith(".tsx") ? "tsx" : args.path.endsWith(".json") ? "json" : "ts" }));
  } }],
});
writeFileSync(output, result.outputFiles[0].text);
`;
writeFileSync(path.join(dir, "build.mjs"), BUILD_SCRIPT);

async function load(): Promise<Bundle> {
  if (!bundlePath) {
    const files: Record<string, string> = { ...starterFiles() };
    files["<entry>"] = [
      'export * as live from "./src/lib/goodbuild/live";',
      'export * as hooks from "./src/lib/hooks";',
      'export { RefreshButton } from "./src/components/ui/refresh-button";',
      'export * as React from "react";',
      'export { createRoot } from "react-dom/client";',
      'export { act } from "react-dom/test-utils";',
    ].join("\n");
    const input = path.join(dir, "files.json");
    bundlePath = path.join(dir, "bundle.mjs");
    writeFileSync(input, JSON.stringify(files));
    const esbuild = createRequire(import.meta.url).resolve("esbuild");
    execFileSync(process.execPath, [path.join(dir, "build.mjs"), pathToFileURL(esbuild).href, input, bundlePath, path.join(process.cwd(), "publish-runtime")]);
  }
  const output = path.join(dir, `live-${n++}.mjs`);
  copyFileSync(bundlePath, output);
  return (await import(/* @vite-ignore */ pathToFileURL(output).href)) as Bundle;
}

let visibility: "visible" | "hidden" = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
function setVisibility(next: "visible" | "hidden") {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.useRealTimers();
  visibility = "visible";
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the shared refresh signal (src/lib/goodbuild/live.ts)", () => {
  it("merges signals that arrive together into one call, and passes every kind", async () => {
    vi.useFakeTimers();
    const { live } = await load();
    const calls: Kind[][] = [];
    live.subscribeChanges((kinds) => void calls.push([...kinds].sort()), { on: ["tx", "data", "wallet"] });
    void live.markChanged("tx");
    void live.markChanged("data");
    void live.markChanged("wallet");
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual([["data", "tx", "wallet"]]);
  });

  it("only calls a listener for the kinds it asked for", async () => {
    vi.useFakeTimers();
    const { live } = await load();
    const saved = vi.fn();
    live.subscribeChanges(saved, { on: ["data", "wallet", "focus", "manual"] });
    void live.markChanged("tick");
    void live.markChanged("tx");
    await vi.advanceTimersByTimeAsync(100);
    expect(saved).not.toHaveBeenCalled();
    void live.markChanged("data");
    await vi.advanceTimersByTimeAsync(100);
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it("refreshAll resolves once every listener has finished", async () => {
    const { live } = await load();
    let finished = false;
    live.subscribeChanges(() => new Promise<void>((r) => setTimeout(() => ((finished = true), r()), 30)));
    await live.refreshAll();
    expect(finished).toBe(true);
    expect(live.lastRefreshedAt()).toBeGreaterThan(0);
  });

  it("a confirmed transaction fetches again 3 s later, for a node a block behind", async () => {
    vi.useFakeTimers();
    const { live } = await load();
    const kinds: Kind[][] = [];
    live.subscribeChanges((k) => void kinds.push([...k]));
    void live.markChanged("tx");
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(kinds).toEqual([["tx"], ["tick"]]);
  });

  it("runs one jittered timer for all reads, only while one wants it and the tab shows", async () => {
    vi.useFakeTimers();
    const { live } = await load();
    const spy = vi.spyOn(globalThis, "setTimeout");
    const runs = Array.from({ length: 50 }, () => vi.fn());
    const offs = runs.map((fn) => live.subscribeChanges(fn));
    // 50 reads, one timer: every subscribe after the first finds it running.
    expect(spy.mock.calls.filter(([, ms]) => (ms ?? 0) >= live.ACTIVE_EVERY_MS * 0.8).length).toBe(1);
    await vi.advanceTimersByTimeAsync(live.ACTIVE_EVERY_MS * 1.2 + 100);
    for (const fn of runs) expect(fn).toHaveBeenCalledTimes(1);

    // Hidden: no fetches at all, however long.
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    for (const fn of runs) expect(fn).toHaveBeenCalledTimes(1);

    // Back after more than 15 s away: one fetch at once, then the timer again.
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(100);
    for (const fn of runs) expect(fn).toHaveBeenCalledTimes(2);

    // No reads left: the timer stops.
    for (const off of offs) off();
    const quiet = vi.fn();
    live.subscribeChanges(quiet, { on: ["data"] });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(quiet).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("slows to once a minute after 2 minutes without a touch, and speeds up on the next one", async () => {
    vi.useFakeTimers();
    const { live } = await load();
    const fn = vi.fn();
    live.subscribeChanges(fn, { on: ["tick"] });
    await vi.advanceTimersByTimeAsync(130_000); // about 8 ticks at 15 s while still "active"
    const activeTicks = fn.mock.calls.length;
    expect(activeTicks).toBeGreaterThanOrEqual(6);
    fn.mockClear();
    await vi.advanceTimersByTimeAsync(10 * 60_000); // idle: at most one every 48 s
    expect(fn.mock.calls.length).toBeLessThanOrEqual(13);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(8);
    fn.mockClear();
    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(live.ACTIVE_EVERY_MS * 1.2 + 100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a quick tab switch doesn't refetch; a tick right after a refresh is skipped", async () => {
    vi.useFakeTimers();
    const { live } = await load();
    const fn = vi.fn();
    live.subscribeChanges(fn, { on: ["focus", "tick", "manual"] });
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(5_000);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).not.toHaveBeenCalled();

    // A refresh just before the timer is due: the timer's own fetch is skipped.
    await vi.advanceTimersByTimeAsync(live.ACTIVE_EVERY_MS * 0.8 - 500);
    void live.refreshAll();
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(live.ACTIVE_EVERY_MS * 0.4 + 100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

/** Mount a component, wait for effects, and give back the container and a way to unmount. */
async function mount(b: Bundle, node: unknown) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = b.createRoot(el);
  await b.act(async () => root.render(node));
  return { el, unmount: () => b.act(async () => root.unmount()) };
}
const settle = (b: Bundle, ms = 120) => b.act(() => new Promise((r) => setTimeout(r, ms)));

describe("useRead, useTx and RefreshButton in a running app", () => {
  it("refetches after another component's transaction, keeping the old value on screen meanwhile", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const b = await load();
    const { React, hooks } = b;
    let balance = 1;
    let resolveRead: (() => void) | null = null;
    const seen: Array<{ data: unknown; loading: boolean; refreshing: boolean }> = [];
    function Balance() {
      const read = hooks.useRead(() => new Promise<number>((r) => (resolveRead = () => r(balance))), []);
      seen.push({ data: read.data, loading: read.loading, refreshing: read.refreshing });
      return React.createElement("span", { "data-testid": "b" }, String(read.data ?? "…"));
    }
    let tx: ReturnType<Bundle["hooks"]["useTx"]> | null = null;
    function Pay() {
      tx = hooks.useTx();
      return null;
    }
    const { el, unmount } = await mount(b, React.createElement(React.Fragment, null, React.createElement(Balance), React.createElement(Pay)));
    await b.act(async () => resolveRead!());
    expect(el.textContent).toBe("1");

    balance = 2;
    await b.act(async () => void (await tx!.run(async () => ({ status: "success" }))));
    await settle(b);
    // Fetching again: the old value stays, refreshing is on, loading isn't.
    expect(el.textContent).toBe("1");
    expect(seen.at(-1)).toMatchObject({ data: 1, loading: false, refreshing: true });
    await b.act(async () => resolveRead!());
    expect(el.textContent).toBe("2");
    expect(seen.at(-1)).toMatchObject({ data: 2, refreshing: false });
    await unmount();
  });

  it("an older reply never overwrites a newer one, and { live: false } doesn't listen", async () => {
    const b = await load();
    const { React, hooks, live } = b;
    const replies: Array<(v: number) => void> = [];
    let fixedCalls = 0;
    function Pot() {
      const read = hooks.useRead(() => new Promise<number>((r) => replies.push(r)), []);
      hooks.useRead(async () => ++fixedCalls, [], true, { live: false });
      return React.createElement("span", null, String(read.data ?? "…"));
    }
    const { el, unmount } = await mount(b, React.createElement(Pot));
    await b.act(async () => replies[0](10));
    await b.act(async () => void live.markChanged("manual"));
    await settle(b);
    await b.act(async () => void live.markChanged("manual"));
    await settle(b);
    expect(replies).toHaveLength(3);
    await b.act(async () => replies[2](30)); // the newest answers first
    await b.act(async () => replies[1](20)); // then the older one: ignored
    expect(el.textContent).toBe("30");
    expect(fixedCalls).toBe(1);
    await unmount();
  });

  it("RefreshButton refreshes its read, spins meanwhile, and says when it was updated", async () => {
    const b = await load();
    const { React, hooks, RefreshButton } = b;
    let calls = 0;
    let finish: (() => void) | null = null;
    function Card() {
      const read = hooks.useRead(() => new Promise<number>((r) => { calls++; finish = () => r(calls); }), []);
      return React.createElement(RefreshButton, { read, label: "Refresh balance" });
    }
    const { el, unmount } = await mount(b, React.createElement(Card));
    await b.act(async () => finish!());
    const button = el.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Refresh balance");
    expect(button.getAttribute("title")).toBe("Updated just now");
    await b.act(async () => button.click());
    expect(calls).toBe(2);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector("svg")!.getAttribute("class")).toContain("animate-spin");
    await b.act(async () => finish!());
    expect(button.getAttribute("aria-busy")).toBe("false");
    await unmount();
  });
});

describe("existing projects and the build check", () => {
  it("every project gets live.ts; untouched hooks.ts and chain.ts move to the live ones, edited ones stay", async () => {
    const starter = starterFiles();
    expect(starter[LIVE_PATH]).toContain("export function markChanged");
    expect(starter["src/lib/hooks.ts"]).toContain("subscribeChanges");
    expect(starter["src/lib/chain.ts"]).toContain('markChanged("tx")');
    expect(starter["src/components/ui/refresh-button.tsx"]).toContain("export function RefreshButton");

    const { HOOKS_BEFORE_LIVE, CHAIN_BEFORE_LIVE } = await import("./fixtures/live-before");
    const old = { ...starter, "src/lib/hooks.ts": HOOKS_BEFORE_LIVE, "src/lib/chain.ts": CHAIN_BEFORE_LIVE };
    delete old[LIVE_PATH];
    delete old["src/components/ui/refresh-button.tsx"];
    const moved = withStarterHelpers(old);
    expect(moved[LIVE_PATH]).toBe(starter[LIVE_PATH]);
    expect(moved["src/lib/hooks.ts"]).toBe(starter["src/lib/hooks.ts"]);
    expect(moved["src/lib/chain.ts"]).toBe(chainSourceFor());
    expect(moved["src/components/ui/refresh-button.tsx"]).toBe(starter["src/components/ui/refresh-button.tsx"]);

    const edited = withStarterHelpers({ ...old, "src/lib/hooks.ts": HOOKS_BEFORE_LIVE + "\n// mine\n" });
    expect(edited["src/lib/hooks.ts"]).toBe(HOOKS_BEFORE_LIVE + "\n// mine\n");
  });

  it("notes hand-rolled reads, page reloads and a missing refresh button, and nothing in a good app", () => {
    const base = starterFiles();
    const bad = {
      ...base,
      "src/App.tsx": `import { useEffect, useState } from "react";
import { publicClient } from "./lib/chain";
export default function App() {
  const [pot, setPot] = useState(0n);
  useEffect(() => {
    publicClient.readContract({ address, abi, functionName: "pot" }).then(setPot);
  }, []);
  return <button onClick={() => window.location.reload()}>{String(pot)}</button>;
}`,
      "src/components/Notes.tsx": `import { useCollection } from "../lib/useDb";
export function Notes() { const notes = useCollection("notes"); return <ul>{notes.records.length}</ul>; }`,
    };
    const issues = liveValueIssues(bad);
    expect(issues.map((i) => [i.file, i.line, i.source])).toEqual([
      ["src/App.tsx", 5, "live"],
      ["src/App.tsx", 8, "live"],
      ["src/components/Notes.tsx", 2, "live"],
    ]);
    expect(issues[0].message).toContain("useRead");
    expect(issues[2].message).toContain("RefreshButton");

    const good = {
      ...base,
      "src/App.tsx": `import { useRead } from "./lib/hooks";
import { RefreshButton } from "./components/ui/refresh-button";
import { publicClient } from "./lib/chain";
export default function App() {
  const pot = useRead(() => publicClient.readContract({ address, abi, functionName: "pot" }), [address], !!address);
  useEffect(() => { document.title = "Pot"; }, []);
  return <div><RefreshButton read={pot} />{String(pot.data)}</div>;
}`,
    };
    expect(liveValueIssues(good)).toEqual([]);
    // The starter alone (GoodBuild's own helpers read in effects) is clean too.
    expect(liveValueIssues(base)).toEqual([]);
  });
});
