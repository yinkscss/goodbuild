// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { classifyHost, slugProblem } from "@/lib/published-host";
import { saveFiles } from "@/server/agent/store";
import { starterFiles } from "@/server/agent/template";
import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import type { Project } from "@/server/db/schema";
import { createProjectFromPrompt } from "@/server/projects";
import { PublishBuildError, buildPublishedApp, PREVIEW_BRIDGE_PATH } from "@/server/publish/build";

import { MAX_PREVIEWS, PREVIEW_TTL_MS, clearPreviews, getPreview, putPreview } from "./cache";
import { PreviewBuildError, buildPreview, previewHeaders, previewToken, workspaceOrigin } from "./service";

const file = (text: string) => [{ path: "index.html", mime: "text/html", bytes: new TextEncoder().encode(text) }];

describe("preview hosts", () => {
  const token = previewToken("11111111-1111-4111-8111-111111111111");
  it("gives each project a stable host that can't be guessed from its id", () => {
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(previewToken("11111111-1111-4111-8111-111111111111")).toBe(token);
    expect(previewToken("22222222-2222-4222-8222-222222222222")).not.toBe(token);
    expect(token).not.toContain("11111111");
  });
  it("is its own kind of host, and no app can be published under a name of that shape", () => {
    expect(classifyHost(`pv-${token}.goodbuildit.xyz`, "goodbuildit.xyz")).toEqual({ kind: "preview", token });
    expect(slugProblem(`pv-${token}`)).toBe("reserved");
    // Close, but not a preview label: an ordinary app name.
    expect(classifyHost("pv-shop.goodbuildit.xyz", "goodbuildit.xyz")).toEqual({ kind: "app", slug: "pv-shop" });
  });
  it("lets only the workspace frame a preview, and keeps it out of caches and search", () => {
    const h = previewHeaders("text/html", 10, "https://goodbuildit.xyz");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors https://goodbuildit.xyz");
    expect(h["Content-Security-Policy"]).toContain("script-src 'self'");
    expect(h["Cache-Control"]).toBe("no-store");
    expect(h["X-Robots-Tag"]).toContain("noindex");
  });
  it("names the workspace's origin in production and in development", () => {
    expect(workspaceOrigin(`pv-${token}.goodbuildit.xyz`, { NODE_ENV: "production", APP_DOMAIN: "goodbuildit.xyz" } as unknown as NodeJS.ProcessEnv)).toBe("https://goodbuildit.xyz");
    expect(workspaceOrigin(`pv-${token}.localhost:3000`, { NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3000");
  });
});

describe("preview cache", () => {
  beforeEach(() => clearPreviews());
  it("forgets a build nobody has used for a while", () => {
    putPreview("a", "p1", "b1", file("one"), 0);
    expect(getPreview("a", PREVIEW_TTL_MS - 1)).toBeDefined();
    // That read counted as a use.
    expect(getPreview("a", 2 * PREVIEW_TTL_MS - 2)).toBeDefined();
    expect(getPreview("a", 4 * PREVIEW_TTL_MS)).toBeUndefined();
  });
  it("drops the least recently used build when it is full", () => {
    for (let i = 0; i <= MAX_PREVIEWS; i++) putPreview(`t${i}`, `p${i}`, "b", file("x"), i);
    expect(getPreview("t0", MAX_PREVIEWS + 1)).toBeUndefined();
    expect(getPreview("t1", MAX_PREVIEWS + 1)).toBeDefined();
    expect(getPreview(`t${MAX_PREVIEWS}`, MAX_PREVIEWS + 1)).toBeDefined();
  });
});

describe("buildPreview", { timeout: 60_000 }, () => {
  let db: Db;
  let project: Project;
  beforeEach(async () => {
    clearPreviews();
    db = await createTestDb();
    const user = await signInUser(db, { wallet: "0x7a3000000000000000000000000000000000e41c", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    project = await createProjectFromPrompt(db, user.id, { prompt: "Ikeja FC tip jar", network: "celo-sepolia" });
    await saveFiles(db, project.id, { ...starterFiles(), "src/App.tsx": "export default function App() { return <main>Ikeja FC</main>; }\n" });
  });

  it("builds the saved project for the preview host: no pill, a bridge script, readable code", async () => {
    const info = await buildPreview(db, project, "localhost:3000", "localhost");
    const token = previewToken(project.id);
    expect(info.origin).toBe(`http://pv-${token}.localhost:3000`);
    expect(info.url).toBe(`${info.origin}/?b=${info.buildId}`);
    expect(info.rebuilt).toBe(true);
    const build = getPreview(token)!;
    expect(build.projectId).toBe(project.id);
    const text = (path: string) => new TextDecoder().decode(build.files.get(path)!.bytes);
    const page = text("index.html");
    expect(page).not.toContain("data-goodbuild-bar");
    // The bridge loads before the app.
    expect(page.indexOf(`src="/${PREVIEW_BRIDGE_PATH}"`)).toBeGreaterThan(0);
    expect(page.indexOf(`src="/${PREVIEW_BRIDGE_PATH}"`)).toBeLessThan(page.indexOf('type="module"'));
    const bridge = text(PREVIEW_BRIDGE_PATH);
    expect(bridge).toContain('"src/App.tsx"');
    const js = text([...build.files.keys()].find((p) => /^app\.[0-9a-f]{12}\.js$/.test(p))!);
    expect(js).toContain("// project:src/App.tsx"); // not minified
  });

  it("reuses the build while the files are the same, and builds again when they change", async () => {
    const build = vi.fn(buildPublishedApp);
    const first = await buildPreview(db, project, "localhost:3000", "localhost", { build });
    const again = await buildPreview(db, project, "localhost:3000", "localhost", { build });
    expect(again).toMatchObject({ buildId: first.buildId, rebuilt: false });
    expect(build).toHaveBeenCalledTimes(1);
    await saveFiles(db, project.id, { ...starterFiles(), "src/App.tsx": "export default function App() { return <main>Changed</main>; }\n" });
    const changed = await buildPreview(db, project, "localhost:3000", "localhost", { build });
    expect(changed.rebuilt).toBe(true);
    expect(changed.buildId).not.toBe(first.buildId);
    // Same host: the preview keeps its origin across builds.
    expect(changed.origin).toBe(first.origin);
  });

  it("reports an app that doesn't build, with the details, and leaves the last good build in place", async () => {
    await buildPreview(db, project, "localhost:3000", "localhost");
    const before = getPreview(previewToken(project.id))!.buildId;
    await saveFiles(db, project.id, { ...starterFiles(), "src/App.tsx": 'import { x } from "./nowhere";\nexport default function App() { return <main>{x}</main>; }\n' });
    const error = await buildPreview(db, project, "localhost:3000", "localhost").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreviewBuildError);
    expect((error as PreviewBuildError).details.join(" ")).toContain("nowhere");
    expect(getPreview(previewToken(project.id))!.buildId).toBe(before);
    // Something other than a build error isn't dressed up as one.
    await expect(buildPreview(db, project, "localhost:3000", "localhost", { build: async () => Promise.reject(new Error("disk full")) })).rejects.toThrow("disk full");
    await expect(buildPreview(db, project, "localhost:3000", "localhost", { build: async () => Promise.reject(new PublishBuildError("x", ["y"])) })).rejects.toBeInstanceOf(PreviewBuildError);
  });

  it("has nothing to build before the first build", async () => {
    await saveFiles(db, project.id, { "public/index.html": "<html>" });
    await expect(buildPreview(db, project, "localhost:3000", "localhost")).rejects.toThrow(/no app to preview/);
  });
});
