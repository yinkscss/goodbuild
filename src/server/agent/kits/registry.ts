import type { CheckIssue } from "../checks";

import { game2d } from "./game-2d";

/**
 * A kit (D71): everything GoodBuild needs to build one more kind of app, in one place. Turning a
 * kit on for a project adds its packages and starter files, opens its guide to the builder, allows
 * its file types and runs its checks. Before kits, each of those lived in a different file, so a
 * new kind of app meant changing the package list, the publish runtime, the prompt, the guides and
 * the checks separately.
 *
 * Kits add up and never come off: a tip jar can gain a game later and keeps everything it had.
 *
 * This module imports nothing from the template, so the template can read the package lists from it.
 */
export interface Kit {
  /** Lowercase, hyphenated. Also the guide's name, as `kit-<id>`. */
  id: string;
  /** A few plain words, for people: "2D games". */
  title: string;
  /** When the builder should turn it on, for the catalog in its prompt. */
  when: string;
  /** Words in a request that mean this kit, so it is on before the builder starts even if it forgets to ask. */
  keywords: RegExp;
  /** Packages the kit brings, pinned. They must also be in publish-runtime/package.json (a test checks). */
  packages: Record<string, string>;
  /** Starter files, added once and never overwritten. Paths like "src/game/useGame.ts". */
  files: Record<string, string>;
  /** How to build this kind of app well. Returned when the kit is turned on. */
  guide: string;
  /** Extra project paths the builder may write, beyond src/**.ts(x)|css|json and contracts. */
  paths?: RegExp[];
  /** Checks of this kind's own, run with the app checks. */
  checks?: (files: Record<string, string>) => CheckIssue[];
  /** "own" when the in-browser bundler can't carry this kind, so the workspace uses GoodBuild's own build (D69). */
  preview?: "own";
}

/** Every kit GoodBuild has. Each kit is a module beside this one, listed here. */
export const KITS: Kit[] = [game2d];

/** The file that says which kits a project has on. GoodBuild writes it; the builder can't. */
export const KIT_MARKER = "src/goodbuild.json";

export function kitById(id: string, kits: Kit[] = KITS): Kit | undefined {
  return kits.find((k) => k.id === id);
}

/** Ids of the kits a project has on, in the order they were turned on. Unknown ids are ignored. */
export function kitIdsOf(files: Record<string, string>, kits: Kit[] = KITS): string[] {
  try {
    const parsed = JSON.parse(files[KIT_MARKER] ?? "{}") as { kits?: unknown };
    const ids = Array.isArray(parsed.kits) ? parsed.kits.filter((k): k is string => typeof k === "string") : [];
    return [...new Set(ids)].filter((id) => kits.some((k) => k.id === id));
  } catch {
    return [];
  }
}

export function kitsOf(files: Record<string, string>, kits: Kit[] = KITS): Kit[] {
  return kitIdsOf(files, kits).map((id) => kitById(id, kits)!);
}

export function kitMarker(ids: string[]): string {
  return JSON.stringify({ kits: ids }, null, 2) + "\n";
}

/** Every package any kit brings. */
export function allKitPackages(kits: Kit[] = KITS): Record<string, string> {
  return Object.assign({}, ...kits.map((k) => k.packages)) as Record<string, string>;
}

/** The kit that brings a package, if any. */
export function kitForPackage(name: string, kits: Kit[] = KITS): Kit | undefined {
  return kits.find((k) => name in k.packages);
}

/** Kits a request asks for by its words, that the project doesn't have yet. */
export function detectKits(request: string, files: Record<string, string>, kits: Kit[] = KITS): Kit[] {
  const on = new Set(kitIdsOf(files, kits));
  return kits.filter((k) => !on.has(k.id) && k.keywords.test(request));
}

/** The kit list for the builder's prompt. Empty when there are no kits. */
export function kitCatalog(kits: Kit[] = KITS): string {
  return kits.map((k) => `- ${k.id}: ${k.when}`).join("\n");
}

export const kitGuideName = (id: string) => `kit-${id}`;
