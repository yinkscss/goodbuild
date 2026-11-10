// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ALLOWED_DEPENDENCIES, PLATFORM_DEPENDENCIES, starterFiles } from "@/server/agent/template";
import { buildPublishedApp, MAX_PUBLISH_BYTES, PublishBuildError } from "./build";

const APP = `import { Wallet } from "lucide-react";
import { cn } from "./lib/utils";
export default function App() {
  return <main className={cn("grid min-h-screen bg-accent p-6")}><Wallet /><img src="/assets/logo.png" /></main>;
}
`;

const build = (files: Record<string, string>, extra: Partial<Parameters<typeof buildPublishedApp>[0]> = {}) =>
  buildPublishedApp({ files: { ...starterFiles(), "src/App.tsx": APP, ...files }, assets: [], title: "Tip jar", hasUndeployedContracts: false, ...extra });

const text = (f: { bytes: Uint8Array }) => new TextDecoder().decode(f.bytes);
const named = (out: Awaited<ReturnType<typeof build>>, re: RegExp) => out.find((f) => re.test(f.path))!;

async function buildError(files: Record<string, string>): Promise<PublishBuildError> {
  const error = await build(files).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PublishBuildError);
  return error as PublishBuildError;
}

describe("buildPublishedApp", () => {
  it("makes a static site from a starter project", async () => {
    const out = await build({});
    const page = text(named(out, /^index\.html$/));
    const js = named(out, /^app\.[0-9a-f]{12}\.js$/);
    const css = named(out, /^app\.[0-9a-f]{12}\.css$/);
    expect(page).toContain(`src="/${js.path}"`);
    expect(page).toContain(`href="/${css.path}"`);
    expect(page).not.toContain("text/tailwindcss");
    expect(text(js)).toContain("/assets/logo.png");
    expect(text(css)).toContain("min-h-screen");
    // The project's theme block made it into the compiled CSS.
    expect(text(css)).toContain("--color-accent: #592e81");
  });

  it("always labels the app, and adds the demo notice only when contracts aren't deployed", async () => {
    const page = (out: Awaited<ReturnType<typeof build>>) => text(named(out, /^index\.html$/));
    const deployed = page(await build({}));
    // Only the logo shows (its words are the link's label), with a cross to close it.
    expect(deployed).toContain('aria-label="Built with GoodBuild"');
    expect(deployed).not.toMatch(/>Built with</);
    expect(deployed).toContain('for="gb-bar-off"');
    // The close control is a real, focusable checkbox (Tab, then Space), not a hidden one only a pointer can reach.
    expect(deployed).toContain('<input type="checkbox" id="gb-bar-off" aria-label="Close the Built with GoodBuild badge"');
    expect(deployed).not.toContain('id="gb-bar-off" hidden');
    expect(deployed).toContain("#gb-bar-off:focus-visible");
    expect(deployed).toContain("left:12px");
    expect(deployed).toContain("data:image/png;base64,");
    expect(deployed).not.toContain("Unaudited");
    expect(deployed).not.toContain("Demo:");
    expect(page(await build({}, { hasUndeployedContracts: true }))).toContain("isn't deployed yet");
  });

  it("leaves room under the app's last content so the bar never covers it", async () => {
    const page = (out: Awaited<ReturnType<typeof build>>) => text(named(out, /^index\.html$/));
    const plain = page(await build({}));
    expect(plain).toContain("data-goodbuild-bar-space");
    // The space comes after the app's root and before the scripts, and is taller when notices wrap the bar.
    expect(plain.indexOf("<div data-goodbuild-bar-space")).toBeGreaterThan(plain.indexOf('id="root"'));
    expect(page(await build({}, { hasUndeployedContracts: true }))).toContain("height:calc(96px");
    expect(plain).toContain("height:calc(60px");
  });

  it("says when the app's contract can be changed (D33), and only then", async () => {
    const page = (out: Awaited<ReturnType<typeof build>>) => text(named(out, /^index\.html$/));
    expect(page(await build({}, { changeableContract: true }))).toContain("This contract can be changed");
    expect(page(await build({}))).not.toContain("can be changed");
  });

  it("escapes the title", async () => {
    const page = text(named(await build({}, { title: `</title><script>x</script>` }), /^index\.html$/));
    expect(page).not.toContain("<script>x");
  });

  it("ships the assets it's given at /assets/", async () => {
    const out = await build({}, { assets: [{ name: "logo.png", mime: "image/png", bytes: new Uint8Array([1, 2]) }] });
    expect(named(out, /^assets\/logo\.png$/).mime).toBe("image/png");
  });

  it("refuses a package that isn't on the list", async () => {
    const error = await buildError({ "src/App.tsx": `import pad from "left-pad";\nexport default function App() { return <p>{pad("a", 2)}</p>; }\n` });
    expect(error.details.join()).toContain("allowed package list");
  });

  it.each(["node:fs", "fs", "react/../../../package.json", "../../package.json"])("can't read server files through %s", async (specifier) => {
    await buildError({ "src/App.tsx": `import x from "${specifier}";\nexport default function App() { return <p>{String(x)}</p>; }\n` });
  });

  it("can't read server files through the Tailwind theme", async () => {
    const html = starterFiles()["public/index.html"].replace(`<style type="text/tailwindcss">`, `<style type="text/tailwindcss">@import "../../.env";`);
    const error = await buildError({ "public/index.html": html });
    expect(error.message).toContain("styles");
  });

  it("reports a syntax error with its file and line", async () => {
    const error = await buildError({ "src/App.tsx": "export default function App( {" });
    expect(error.details[0]).toMatch(/^src\/App\.tsx:\d+/);
  });

  it("refuses an app over the size limit", async () => {
    const big = { name: "big.png", mime: "image/png", bytes: new Uint8Array(MAX_PUBLISH_BYTES + 1) };
    await expect(build({}, { assets: [big] })).rejects.toThrow(/limit/);
  });

  it("refuses a project with no app", async () => {
    await expect(buildPublishedApp({ files: {}, assets: [], title: "x", hasUndeployedContracts: false })).rejects.toThrow(PublishBuildError);
  });
});

describe("publish-runtime", () => {
  it("installs exactly the versions generated apps may use", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "publish-runtime/package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies).toEqual({ ...ALLOWED_DEPENDENCIES, ...PLATFORM_DEPENDENCIES });
  });
});
