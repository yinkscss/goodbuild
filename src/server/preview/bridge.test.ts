// @vitest-environment node
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { starterFiles } from "@/server/agent/template";
import { buildPublishedApp, type PublishedFile } from "@/server/publish/build";

import { previewBridge } from "./bridge";
import { previewHeaders } from "./service";

// A real browser, as in run-check.test.ts: CI has one, and without one these skip.
const hasBrowser =
  Boolean(process.env.CI) ||
  (await chromium
    .launch({ headless: true })
    .then((b) => b.close().then(() => true))
    .catch(() => false));

const WORKSPACE = "http://localhost:3000";
const PREVIEW = "http://pv-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.localhost:3000";
const build = (app: Record<string, string>) => buildPublishedApp({ files: { ...starterFiles(), ...app }, assets: [], title: "Preview", hasUndeployedContracts: false, preview: { bridge: previewBridge } });

describe.skipIf(!hasBrowser)("the preview bridge in a real browser", { timeout: 60_000 }, () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(() => browser?.close());

  /** Frame a built preview from `parent`, the way the workspace does, and collect what it says. */
  async function frame(files: PublishedFile[], parent = WORKSPACE) {
    const context = await browser.newContext();
    const byPath = new Map(files.map((f) => [f.path, f]));
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === parent) {
        const html = `<!doctype html><iframe id="f" src="${PREVIEW}/?b=1" sandbox="allow-scripts allow-same-origin"></iframe><script>window.got=[];addEventListener("message",function(e){ if(e.origin==="${PREVIEW}" && e.source===document.getElementById("f").contentWindow) got.push(e.data); });</script>`;
        return route.fulfill({ status: 200, contentType: "text/html", body: html });
      }
      if (url.origin === PREVIEW) {
        const f = byPath.get(url.pathname.slice(1) || "index.html");
        if (!f) return route.fulfill({ status: 404, body: "" });
        // The headers the preview route sends, frame-ancestors included.
        return route.fulfill({ status: 200, headers: previewHeaders(f.mime, f.bytes.length, WORKSPACE), body: Buffer.from(f.bytes) });
      }
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(`${parent}/`);
    await page.waitForTimeout(1500);
    const got = (await page.evaluate("window.got")) as Array<{ gb?: string; type?: string; title?: string; message?: string; path?: string; empty?: boolean }>;
    await context.close();
    return got;
  }

  it("tells the workspace when the app is up", async () => {
    const got = await frame(await build({ "src/App.tsx": "export default function App() { return <main>Ikeja FC</main>; }\n" }));
    expect(got).toEqual([{ gb: "preview", type: "ready", empty: false }]);
  });

  it("reports a crash with the project file it came from", async () => {
    const got = await frame(
      await build({
        "src/components/Stats.tsx": "export function Stats({ items }: { items?: number[] }) {\n  return <p>{items!.length} tips</p>;\n}\n",
        "src/App.tsx": 'import { Stats } from "./components/Stats";\nexport default function App() { return <main><Stats /></main>; }\n',
      }),
    );
    const error = got.find((m) => m.type === "error");
    expect(error).toMatchObject({ gb: "preview", path: "src/components/Stats.tsx" });
    expect(error?.message).toMatch(/length/);
    // The page still loaded, and says the app rendered nothing.
    expect(got.find((m) => m.type === "ready")).toMatchObject({ empty: true });
  });

  it("can't be framed by any other site", async () => {
    const got = await frame(await build({ "src/App.tsx": "export default function App() { return <main>Ikeja FC</main>; }\n" }), "http://evil.example");
    expect(got).toEqual([]);
  });
});
