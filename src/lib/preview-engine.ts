/**
 * Which preview a project gets (D64, D69). People never choose and never see the difference: the
 * workspace decides from what the project contains, and falls back by itself when one fails.
 *
 * - "sandpack": CodeSandbox's in-browser bundler. Updates in place, needs CodeSandbox and a CDN.
 * - "own": GoodBuild's own build, served from the project's preview host. Needs neither, and can
 *   carry packages and files the in-browser bundler can't.
 */
export type PreviewEngine = "sandpack" | "own";

/** Packages too heavy, or too tied to real files and workers, for the in-browser bundler. */
export const OWN_BUILD_PACKAGES = new Set(["three", "@react-three/fiber", "@react-three/drei", "phaser", "pixi.js", "matter-js", "@dimforge/rapier2d-compat", "@dimforge/rapier3d-compat", "kaplay"]);

/** Shaders, sound and 3D models: the in-browser bundler can't serve them. */
const OWN_BUILD_FILES = /\.(glsl|vert|frag|wgsl|mp3|ogg|wav|glb|gltf)$/i;

export function needsOwnBuild(files: Record<string, string>): boolean {
  if (Object.keys(files).some((p) => OWN_BUILD_FILES.test(p))) return true;
  try {
    const deps = (JSON.parse(files["package.json"] ?? "{}") as { dependencies?: Record<string, string> }).dependencies ?? {};
    return Object.keys(deps).some((d) => OWN_BUILD_PACKAGES.has(d));
  } catch {
    return false;
  }
}

/** The owner's switch for comparing the two: add ?preview=own, ?preview=sandpack or ?preview=auto to a project's address. */
export type EngineOverride = PreviewEngine | null;

export function parseOverride(value: string | null | undefined): EngineOverride | "auto" | undefined {
  return value === "own" || value === "sandpack" ? value : value === "auto" ? "auto" : undefined;
}

/**
 * One-way within a visit: once a project needs its own build, or Sandpack has failed, it stays on
 * the own build, so the preview never flips back and forth between turns.
 */
export function chooseEngine(args: { files: Record<string, string>; override: EngineOverride; sandpackFailed: boolean }): PreviewEngine {
  if (args.override) return args.override;
  return needsOwnBuild(args.files) || args.sandpackFailed ? "own" : "sandpack";
}

export const OVERRIDE_KEY = "gb-preview-engine";
export const failedKey = (projectId: string) => `gb-preview-fallback:${projectId}`;
