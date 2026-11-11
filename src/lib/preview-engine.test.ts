import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TAILWIND_BROWSER_URL, TAILWIND_VERSION, chooseEngine, needsOwnBuild, parseOverride } from "./preview-engine";

const pkg = (deps: Record<string, string>) => ({ "package.json": JSON.stringify({ dependencies: deps }), "src/App.tsx": "" });

describe("needsOwnBuild", () => {
  it("is false for an ordinary dApp or website", () => {
    expect(needsOwnBuild(pkg({ react: "18.3.1", viem: "2.57.16", "lucide-react": "1.68.0" }))).toBe(false);
    expect(needsOwnBuild({ "src/App.tsx": "" })).toBe(false);
    expect(needsOwnBuild({ "package.json": "{not json" })).toBe(false);
  });
  it("is true for a game or 3D package, or a shader, sound or model file", () => {
    expect(needsOwnBuild(pkg({ react: "18.3.1", three: "0.170.0" }))).toBe(true);
    expect(needsOwnBuild(pkg({ phaser: "3.90.0" }))).toBe(true);
    expect(needsOwnBuild({ ...pkg({ react: "18.3.1" }), "src/shaders/water.glsl": "" })).toBe(true);
    expect(needsOwnBuild({ ...pkg({ react: "18.3.1" }), "public/sounds/jump.mp3": "" })).toBe(true);
  });
});

describe("chooseEngine", () => {
  const plain = pkg({ react: "18.3.1" });
  const game = pkg({ phaser: "3.90.0" });
  it("uses Sandpack for ordinary projects and the own build for heavy ones", () => {
    expect(chooseEngine({ files: plain, override: null, sandpackFailed: false })).toBe("sandpack");
    expect(chooseEngine({ files: game, override: null, sandpackFailed: false })).toBe("own");
  });
  it("falls back to the own build once Sandpack has failed", () => {
    expect(chooseEngine({ files: plain, override: null, sandpackFailed: true })).toBe("own");
  });
  it("lets the owner's override win either way", () => {
    expect(chooseEngine({ files: plain, override: "own", sandpackFailed: false })).toBe("own");
    expect(chooseEngine({ files: game, override: "sandpack", sandpackFailed: true })).toBe("sandpack");
  });
  it("only reads own, sandpack and auto from the address", () => {
    expect(parseOverride("own")).toBe("own");
    expect(parseOverride("sandpack")).toBe("sandpack");
    expect(parseOverride("auto")).toBe("auto");
    expect(parseOverride("1")).toBeUndefined();
    expect(parseOverride(null)).toBeUndefined();
  });
});

describe("the preview's Tailwind", () => {
  it("is the exact version publishing compiles with, never a floating one", () => {
    const installed = (JSON.parse(readFileSync("node_modules/tailwindcss/package.json", "utf8")) as { version: string }).version;
    expect(TAILWIND_VERSION).toBe(installed);
    expect(TAILWIND_BROWSER_URL).toBe(`https://cdn.jsdelivr.net/npm/@tailwindcss/browser@${installed}`);
  });
});
