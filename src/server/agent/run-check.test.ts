// @vitest-environment node
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";

import { closeRunCheckBrowser, rpcStub, runCheck, runCheckEnabled, sourceOfStack } from "./run-check";
import { starterFiles } from "./template";

// The browser is installed in CI and on the server (`playwright-core install chromium-headless-shell`).
// Without it these are skipped, never failed: a laptop without the download can still run the suite.
// In CI the browser must be there, so a missing or broken one fails these tests instead of hiding them.
const hasBrowser =
  Boolean(process.env.CI) ||
  (await chromium
    .launch({ headless: true })
    .then((b) => b.close().then(() => true))
    .catch((error: unknown) => {
      console.warn(`[run-check.test] skipping the browser tests: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
      return false;
    }));

const app = (files: Record<string, string>) => ({ ...starterFiles(), ...files });
const page = (body: string, imports = "") => `${imports}\nexport default function App() {\n${body}\n}\n`;

describe("run check helpers", () => {
  it("is off unless the server turns it on", () => {
    expect(runCheckEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(runCheckEnabled({ RUN_CHECK: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(runCheckEnabled({ RUN_CHECK_WS_ENDPOINT: "ws://checker:3001/" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("pins the same browser driver version in the Dockerfile as in package.json", () => {
    const wanted = (JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> }).dependencies["playwright-core"];
    expect(wanted).toMatch(/^\d+\.\d+\.\d+$/); // exact, never a range
    expect(readFileSync("Dockerfile", "utf8")).toContain(`playwright-core@${wanted} install`);
  });

  it("answers a chain RPC without a chain", () => {
    expect(rpcStub({ id: 1, jsonrpc: "2.0", method: "eth_chainId" }, 42220)).toEqual({ jsonrpc: "2.0", id: 1, result: "0xa4ec" });
    const batch = rpcStub([{ id: 1, method: "eth_blockNumber" }, { id: 2, method: "eth_call" }], 42220) as Array<{ result?: string; error?: { message: string } }>;
    expect(batch[0].result).toBe("0x1");
    expect(batch[1].error?.message).toMatch(/run check/);
  });

  it("finds the project file a stack frame is in, and skips package code", () => {
    const js = ["// node_modules/react/index.js", "var React = 1;", "// project:src/components/Card.tsx", "function Card() {", "  throw new Error('x');", "}", "// project:src/App.tsx", "function App() {}"].join("\n");
    expect(sourceOfStack("Error: x\n    at Card (http://app.goodbuild.test/app.abc.js:5:9)", js, "app.abc.js")).toBe("src/components/Card.tsx");
    // The first frame is inside React: the next one in the project's own code is the answer.
    expect(sourceOfStack("Error\n at r (http://h/app.abc.js:2:1)\n at App (http://h/app.abc.js:8:1)", js, "app.abc.js")).toBe("src/App.tsx");
    expect(sourceOfStack("Error\n at r (http://h/app.abc.js:2:1)", js, "app.abc.js")).toBeUndefined();
  });
});

describe.skipIf(!hasBrowser)("run check in a real browser", () => {
  afterAll(() => closeRunCheckBrowser());

  it("passes the starter project", async () => {
    const r = await runCheck(starterFiles());
    expect(r.ran).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("reports a crash on first render, with the file and the component", async () => {
    const r = await runCheck(
      app({
        "src/components/Stats.tsx": `export function Stats({ items }: { items?: number[] }) {\n  return <p>{items!.length} tips</p>;\n}\n`,
        "src/App.tsx": page("  return <main><h1>Tip jar</h1><Stats /></main>;", 'import { Stats } from "./components/Stats";'),
      }),
    );
    expect(r.ran).toBe(true);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ file: "src/components/Stats.tsx", source: "runtime" });
    expect(r.issues[0].message).toMatch(/crashed when it ran: .*length/);
    expect(r.issues[0].message).toContain("<Stats>");
  });

  it("reports an import that is undefined at run time, which compiling can't see", async () => {
    // What HARNESS.md E1 hit by hand: a named import the package doesn't export.
    const r = await runCheck(app({ "src/App.tsx": page("  return <main><Missing /></main>;", 'import * as Lucide from "lucide-react";\nconst Missing = (Lucide as Record<string, unknown>)["Instagram"] as React.FC;\nimport React from "react";') }));
    expect(r.issues[0]?.message).toMatch(/Element type is invalid/);
  });

  it("reports an error thrown after render, in an effect", async () => {
    const r = await runCheck(app({ "src/App.tsx": page('  useEffect(() => { JSON.parse("{not json"); }, []);\n  return <main>Hello</main>;', 'import { useEffect } from "react";') }));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].message).toMatch(/JSON/);
  });

  it("reports a page that shows nothing", async () => {
    const r = await runCheck(app({ "src/App.tsx": page("  return null;") }));
    expect(r.issues).toEqual([expect.objectContaining({ file: "src/App.tsx", message: expect.stringMatching(/showed nothing/) })]);
  });

  it("opens the other pages of a multi-page app and names the one that breaks", async () => {
    const r = await runCheck(
      app({
        "src/pages/About.tsx": `export default function About() {\n  const team: { name: string }[] = undefined as never;\n  return <ul>{team.map((t) => <li key={t.name}>{t.name}</li>)}</ul>;\n}\n`,
        "src/App.tsx": `import { HashRouter, Link, Route, Routes } from "react-router-dom";\nimport About from "./pages/About";\nexport default function App() {\n  return <HashRouter><nav><Link to="/">Home</Link><Link to="/about">About</Link></nav><Routes><Route path="/" element={<h1>Home</h1>} /><Route path="/about" element={<About />} /></Routes></HashRouter>;\n}\n`,
      }),
    );
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].file).toBe("src/pages/About.tsx");
    expect(r.issues[0].message).toContain("on the /about page");
  });

  it("doesn't blame the app for the network it has no access to", async () => {
    const r = await runCheck(
      app({
        "src/App.tsx": page(
          '  const [n, setN] = useState("…");\n  useEffect(() => {\n    void publicClient.getBlockNumber().then((b) => setN(String(b)));\n    void fetch("https://example.com/data.json");\n    void publicClient.readContract({ address: "0x0000000000000000000000000000000000000001", abi: [{ type: "function", name: "total", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "total" });\n  }, []);\n  return <main>Block {n}<img src="/assets/logo.png" alt="" /></main>;',
          'import { useEffect, useState } from "react";\nimport { publicClient } from "./lib/chain";',
        ),
      }),
      { assets: ["logo.png"] },
    );
    expect(r.ran).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("reports a build failure as an issue in the right file", async () => {
    const r = await runCheck(app({ "src/App.tsx": page("  return <main>{nope}</main>;", 'import { nope } from "./lib/nowhere";') }));
    expect(r.ran).toBe(true);
    expect(r.issues[0]).toMatchObject({ file: "src/App.tsx", source: "runtime" });
    expect(r.issues[0].message).toMatch(/nowhere/);
  });

  it("returns phone and desktop screenshots when asked", async () => {
    const r = await runCheck(starterFiles(), { screenshots: true });
    expect(r.screenshots?.map((s) => s.width)).toEqual([375, 1280]);
    for (const s of r.screenshots ?? []) expect(Buffer.from(s.png.subarray(1, 4)).toString()).toBe("PNG");
  });

  it("takes the screenshots of the whole page down to the limit, not just the first screen, and without GoodBuild's badge", async () => {
    const sharp = (await import("sharp")).default;
    // A page 3,000px tall, white, with a red band below the first screen.
    const tall = page('  return <main style={{ background: "#ffffff" }}><div style={{ height: 1500 }} /><div id="band" style={{ height: 300, background: "#ff0000" }} /><div style={{ height: 1200 }} /></main>;');
    const r = await runCheck(app({ "src/App.tsx": tall }), { screenshots: true });
    expect(r.issues).toEqual([]);
    for (const shot of r.screenshots ?? []) {
      const image = sharp(Buffer.from(shot.png));
      const meta = await image.metadata();
      expect([meta.width, meta.height]).toEqual([shot.width, 2400]);
      // The band, 1,500px down, is in the picture.
      const { data } = await image.extract({ left: 10, top: 1600, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      expect([data[0], data[1], data[2]]).toEqual([255, 0, 0]);
      // Where the badge sits on the first screen (bottom left), there is only the page.
      const corner = await sharp(Buffer.from(shot.png)).extract({ left: 20, top: 780, width: 1, height: 1 }).raw().toBuffer();
      expect([corner[0], corner[1], corner[2]]).toEqual([255, 255, 255]);
    }
    expect(r.screenshots).toHaveLength(2);
  });

  it("gives up on an app that never finishes loading, without failing the build", async () => {
    const r = await runCheck(app({ "src/App.tsx": page("  while (true) {}\n  return null;") }), { timeoutMs: 2_500 });
    expect(r.ran).toBe(false);
    expect(r.issues).toEqual([]);
    expect(r.note).toMatch(/too long/);
  });
});

describe("run check without a browser", () => {
  it("skips the check, and doesn't make the next build wait for it again", async () => {
    await closeRunCheckBrowser();
    process.env.RUN_CHECK_WS_ENDPOINT = "ws://127.0.0.1:9/";
    try {
      const first = await runCheck(starterFiles());
      expect(first).toMatchObject({ ran: false, issues: [] });
      expect(first.note).toMatch(/browser wasn't available/);
      const second = await runCheck(starterFiles());
      expect(second.ran).toBe(false);
      expect(second.note).toMatch(/a moment ago/);
    } finally {
      delete process.env.RUN_CHECK_WS_ENDPOINT;
      await closeRunCheckBrowser();
    }
  });
});
