// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OWN_BUILD_PACKAGES } from "@/lib/preview-engine";

import { checkApp, pathProblem } from "../checks";
import { BUILD_TOOLS } from "../prompt";
import { ALLOWED_DEPENDENCIES, BASE_ALLOWED_DEPENDENCIES, PLATFORM_DEPENDENCIES, dependenciesOf, starterFiles } from "../template";
import { Workspace } from "../workspace";
import { KITS, KIT_MARKER, detectKits, kitAllowsPath, kitCatalog, kitIdsOf, kitsOf, packagesFor, withKit, withKitHelpers, type Kit } from "./index";

/** A stand-in kit, so the registry is tested apart from any real kit. */
const demo: Kit = {
  id: "demo-kit",
  title: "Demo things",
  when: "the request is for a demo thing",
  keywords: /\bdemo thing\b/i,
  // A package that is installed (it is on the base list), so the app check can resolve it.
  packages: { "date-fns": BASE_ALLOWED_DEPENDENCIES["date-fns"] },
  files: { "src/demo/useDemo.ts": "export const useDemo = () => 1;\n" },
  guide: "Build demo things with useDemo.",
  paths: [/^src\/demo\/[a-z]+\.glsl$/],
  checks: (files) => ("src/demo/forbidden.ts" in files ? [{ file: "src/demo/forbidden.ts", message: "Demo kits can't have this file.", source: "paths" as const }] : []),
};
const kits = [demo];

describe("the real kits", () => {
  it("have unique ids, a guide, and packages that publishing installs at the same version", () => {
    expect(new Set(KITS.map((k) => k.id)).size).toBe(KITS.length);
    const runtime = (JSON.parse(readFileSync("publish-runtime/package.json", "utf8")) as { dependencies: Record<string, string> }).dependencies;
    for (const kit of KITS) {
      expect(kit.id).toMatch(/^[a-z][a-z0-9-]+$/);
      expect(kit.guide.length).toBeGreaterThan(200);
      for (const [name, version] of Object.entries(kit.packages)) expect(runtime[name]).toBe(version);
      // A kit that needs GoodBuild's own build must be recognisable to the workspace from its packages.
      if (kit.preview === "own") expect(Object.keys(kit.packages).some((p) => OWN_BUILD_PACKAGES.has(p))).toBe(true);
      // Starter files live where the builder may write, and aren't the marker.
      for (const path of Object.keys(kit.files)) expect(pathProblem(path, [kit])).toBeNull();
    }
    expect(ALLOWED_DEPENDENCIES).toEqual({ ...BASE_ALLOWED_DEPENDENCIES, ...Object.assign({}, ...KITS.map((k) => k.packages)) });
    expect(runtime).toEqual({ ...ALLOWED_DEPENDENCIES, ...PLATFORM_DEPENDENCIES });
  });
});

describe("turning a kit on", () => {
  it("adds its packages and starter files once, records it, and never overwrites the project's own files", () => {
    const base = { ...starterFiles(), "src/demo/useDemo.ts": "// the project's own version\n" };
    const on = withKit(base, demo, kits);
    expect(kitIdsOf(on, kits)).toEqual(["demo-kit"]);
    expect(dependenciesOf(on)).toContain("date-fns");
    expect(on["src/demo/useDemo.ts"]).toBe("// the project's own version\n");
    expect(withKit(on, demo, kits)).toEqual(on);
    expect(withKit(starterFiles(), demo, kits)["src/demo/useDemo.ts"]).toContain("useDemo");
  });

  it("keeps a project's kits whole at the start of a turn", () => {
    const on = withKit(starterFiles(), demo, kits);
    delete on["src/demo/useDemo.ts"];
    expect(withKitHelpers(on, kits)["src/demo/useDemo.ts"]).toContain("useDemo");
    // No kits, nothing changes.
    expect(withKitHelpers(starterFiles(), kits)).toEqual(starterFiles());
  });

  it("ignores a marker it can't read or a kit it doesn't know", () => {
    expect(kitsOf({ [KIT_MARKER]: "{not json" }, kits)).toEqual([]);
    expect(kitIdsOf({ [KIT_MARKER]: JSON.stringify({ kits: ["demo-kit", "gone-kit", "demo-kit", 7] }) }, kits)).toEqual(["demo-kit"]);
  });

  it("widens what the project may install and where it may write, and nothing else's", () => {
    const off = starterFiles();
    const on = withKit(off, demo, kits);
    expect(packagesFor(off, kits)).toEqual(BASE_ALLOWED_DEPENDENCIES);
    expect(Object.keys(packagesFor(on, kits))).toContain("date-fns");
    expect(kitAllowsPath("src/demo/water.glsl", on, kits)).toBe(true);
    expect(kitAllowsPath("src/demo/water.glsl", off, kits)).toBe(false);
    expect(pathProblem("src/demo/water.glsl")).toMatch(/Files must be under/);
    expect(pathProblem("src/demo/water.glsl", kits)).toBeNull();
    // A kit can't open the platform's own folders.
    expect(pathProblem("src/contracts/x.glsl", [{ ...demo, paths: [/.*/] }])).toMatch(/written by GoodBuild/);
    expect(pathProblem(KIT_MARKER, kits)).toMatch(/add_kit/);
  });

  it("is picked from a request's words only when it isn't on yet", () => {
    expect(detectKits("Build me a demo thing for my club", starterFiles(), kits)).toEqual([demo]);
    expect(detectKits("A tip jar", starterFiles(), kits)).toEqual([]);
    expect(detectKits("Another demo thing", withKit(starterFiles(), demo, kits), kits)).toEqual([]);
    expect(kitCatalog(kits)).toBe("- demo-kit: the request is for a demo thing");
  });
});

describe("kits in the builder's tools", () => {
  beforeEach(() => void KITS.push(demo));
  afterEach(() => void KITS.splice(KITS.indexOf(demo), 1));

  it("add_kit turns it on and hands back the guide, and says so when it is already on", () => {
    const ws = new Workspace(starterFiles());
    const first = ws.execute("add_kit", JSON.stringify({ name: "demo-kit" }), "build");
    expect(first.ok).toBe(true);
    expect(first.result).toContain("Turned on the demo-kit kit");
    expect(first.result).toContain("Build demo things with useDemo.");
    expect(first.guides).toEqual(["kit-demo-kit"]);
    expect(ws.files["src/demo/useDemo.ts"]).toContain("useDemo");
    expect(kitIdsOf(ws.files)).toEqual(["demo-kit"]);
    expect(ws.changed()).toBe(true);
    expect(ws.execute("add_kit", JSON.stringify({ name: "demo-kit" }), "build").result).toContain("already on");
    expect(ws.execute("add_kit", JSON.stringify({ name: "nope" }), "build")).toMatchObject({ ok: false });
    expect(new Workspace(starterFiles()).execute("add_kit", JSON.stringify({ name: "demo-kit" }), "plan")).toMatchObject({ ok: false });
  });

  it("lets the builder write the kit's file types only once the kit is on, and never the marker", () => {
    const ws = new Workspace(starterFiles());
    const write = () => ws.execute("create_file", JSON.stringify({ path: "src/demo/water.glsl", content: "void main() {}" }), "build");
    expect(write().ok).toBe(false);
    ws.execute("add_kit", JSON.stringify({ name: "demo-kit" }), "build");
    expect(write().ok).toBe(true);
    expect(ws.execute("create_file", JSON.stringify({ path: KIT_MARKER, content: "{}" }), "build")).toMatchObject({ ok: false });
    expect(ws.execute("delete_file", JSON.stringify({ path: KIT_MARKER }), "build")).toMatchObject({ ok: false });
  });

  it("runs the kit's own checks with the app checks", () => {
    const page = { ...starterFiles(), "src/App.tsx": "export default function App() { return <main>Ready</main>; }\n" };
    const on = withKit(page, demo);
    expect(checkApp(on).ok).toBe(true);
    expect(checkApp({ ...on, "src/demo/forbidden.ts": "export {};\n" }).errors.map((e) => e.message)).toContain("Demo kits can't have this file.");
    // The same file in a project without the kit is nobody's business.
    expect(checkApp({ ...page, "src/demo/forbidden.ts": "export {};\n" }).ok).toBe(true);
  });
});

describe("the builder's tool list", () => {
  it("only offers add_kit when there are kits", () => {
    expect(BUILD_TOOLS.some((t) => t.function.name === "add_kit")).toBe(KITS.length > 0);
  });
});
