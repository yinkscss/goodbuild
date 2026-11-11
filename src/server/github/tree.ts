import type { TreeEntry } from "./api";

const MAX_FILES = 600;
const MAX_FILE_BYTES = 1_000_000;

/** A path GitHub and git will take, that isn't a secret file or git's own. */
export function safePath(path: string): boolean {
  if (!path || path.length > 240 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.toLowerCase() === ".git")) return false;
  if (parts.includes("node_modules")) return false;
  // Environment files hold secrets in most projects; never push them.
  if (parts.some((p) => /^\.env(rc)?(\.|$)/i.test(p))) return false;
  return true;
}

export function readme(name: string): string {
  return `# ${name}\n\nBuilt with [GoodBuild](https://goodbuildit.xyz). Edits made in GoodBuild are pushed here automatically.\n`;
}

const GITIGNORE = "node_modules\ndist\n.env\n.env.*\n.DS_Store\n";

/** The project's files as a git tree: safe paths only, plus a README and .gitignore when the project has none. */
export function buildTree(files: Record<string, string>, projectName: string): { tree: TreeEntry[]; skipped: string[] } {
  const skipped: string[] = [];
  const tree: TreeEntry[] = [];
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!safePath(path) || typeof content !== "string" || Buffer.byteLength(content) > MAX_FILE_BYTES || tree.length >= MAX_FILES) {
      skipped.push(path);
      continue;
    }
    tree.push({ path, mode: "100644", type: "blob", content });
  }
  const has = (p: string) => tree.some((t) => t.path.toLowerCase() === p);
  if (!has("readme.md")) tree.push({ path: "README.md", mode: "100644", type: "blob", content: readme(projectName) });
  if (!has(".gitignore")) tree.push({ path: ".gitignore", mode: "100644", type: "blob", content: GITIGNORE });
  return { tree, skipped };
}

/** A GitHub repository name from the project's name. */
export function repoName(projectName: string, attempt = 0): string {
  const base =
    projectName
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "goodbuild-app";
  return attempt === 0 ? base : `${base}-${attempt + 1}`;
}
