import { createHash } from "node:crypto";

import { BASE_ALLOWED_DEPENDENCIES, dependenciesOf, packageJson } from "../template";

import { KITS, KIT_MARKER, kitIdsOf, kitMarker, kitsOf, type Kit } from "./registry";

export * from "./registry";

/**
 * Turn a kit on: its packages go into package.json, its starter files are added where the project
 * has none of that name (or still has an untouched earlier version, see Kit.superseded), and the
 * marker file records it. Doing it twice changes nothing.
 */
export function withKit(files: Record<string, string>, kit: Kit, kits: Kit[] = KITS): Record<string, string> {
  const out = { ...files };
  const ids = kitIdsOf(out, kits);
  if (!ids.includes(kit.id)) out[KIT_MARKER] = kitMarker([...ids, kit.id]);
  out["package.json"] = packageJson([...dependenciesOf(out), ...Object.keys(kit.packages)]);
  for (const [path, content] of Object.entries(kit.files)) {
    if (!(path in out) || isSuperseded(kit, path, out[path])) out[path] = content;
  }
  return out;
}

/** The project's copy of a kit file is an earlier version GoodBuild shipped, exactly as shipped. */
function isSuperseded(kit: Kit, path: string, content: string): boolean {
  const old = kit.superseded?.[path];
  return Boolean(old?.length) && old!.includes(createHash("sha256").update(content).digest("hex"));
}

/** The packages this project may add: the base list, plus those of the kits it has on. */
export function packagesFor(files: Record<string, string>, kits: Kit[] = KITS): Record<string, string> {
  return Object.assign({}, BASE_ALLOWED_DEPENDENCIES, ...kitsOf(files, kits).map((k) => k.packages)) as Record<string, string>;
}

/**
 * Keep a project's kits whole at the start of a turn, the way withStarterHelpers does for the
 * starter: a kit file that went missing comes back, and a kit's packages stay installed.
 */
export function withKitHelpers(files: Record<string, string>, kits: Kit[] = KITS): Record<string, string> {
  return kitsOf(files, kits).reduce((acc, kit) => withKit(acc, kit, kits), files);
}

/** Paths the project's kits allow beyond the usual ones. */
export function kitAllowsPath(path: string, files: Record<string, string>, kits: Kit[] = KITS): boolean {
  return kitsOf(files, kits).some((k) => k.paths?.some((re) => re.test(path)));
}
export { assertsSomething, exploitTestIssues, exploitTests, neededTests, rolesOf, unmetNeeds } from "./dao-vault";
