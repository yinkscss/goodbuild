import { TEMPLATE_IMAGE_MODULE } from "@/config/page-templates";
import { ASSET_EXTENSIONS } from "./assets";
import { MAX_FILES, MAX_FILE_BYTES, namingProblem, pathProblem } from "./checks";
import { findSymbol, manifest, readRange, searchCode } from "./codebase";
import { applyEdits, diffStat, unifiedDiff, type SearchReplace } from "./edits";
import { loadGuides } from "./guides";
import { KITS, kitById, kitForPackage, kitIdsOf, kitsOf, packagesFor, withKit } from "./kits";
import { COMPANION_PACKAGES, dependenciesOf, packageJson } from "./template";
import { SPEC_PATH, parseSpec, specPlan } from "./spec";

import type { FileChange } from "@/lib/turn-types";

export type { FileChange };

export interface ToolOutcome {
  /** Text returned to the model. */
  result: string;
  ok: boolean;
  change?: FileChange;
  plan?: { summary: string; steps: string[] };
  /** Next-step suggestions from suggest_next. */
  suggestions?: string[];
  /** From suggest_next (D163): what the person can do in the app now, and what doesn't work yet. */
  works?: string[];
  later?: string;
  /** Guides returned to the model by this call (for the build log). */
  guides?: string[];
  /** A read, listing or search, for the build log (the harness eval counts these). */
  access?: string;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The agent's working copy of a project's files for one turn. Tool calls mutate it in
 * memory; the runner persists it once the turn ends, as one checkpoint.
 */
/** v2: a whole read_file of a file longer than this returns its first lines (D162). */
const READ_MAX_CHARS = 16_000;

export class Workspace {
  readonly files: Record<string, string>;
  private readonly before: Record<string, string>;
  readonly touched = new Set<string>();

  /** Harness v2 (D152): the vetted v2 packages may be added. */
  private readonly v2: boolean;

  constructor(files: Record<string, string>, { v2 = false }: { v2?: boolean } = {}) {
    this.files = { ...files };
    this.before = { ...files };
    this.v2 = v2;
  }

  changed(): boolean {
    const a = Object.keys(this.before);
    const b = Object.keys(this.files);
    return a.length !== b.length || b.some((p) => this.before[p] !== this.files[p]);
  }

  /** Overall diff of this turn per file (for the version summary). */
  netChanges(): FileChange[] {
    const paths = new Set([...Object.keys(this.before), ...Object.keys(this.files)]);
    const out: FileChange[] = [];
    for (const path of [...paths].sort()) {
      const a = this.before[path];
      const b = this.files[path];
      if (a === b) continue;
      const stat = diffStat(a ?? "", b ?? "");
      out.push({ path, op: a === undefined ? "create" : b === undefined ? "delete" : "edit", ...stat, diff: unifiedDiff(path, a ?? "", b ?? "") });
    }
    return out;
  }

  execute(name: string, rawArgs: string, mode: "build" | "plan"): ToolOutcome {
    let args: Record<string, unknown>;
    try {
      args = rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      return { ok: false, result: `Error: the arguments for ${name} weren't valid JSON. Call it again with valid JSON.` };
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, result: "Error: tool arguments must be a JSON object." };
    const editing = ["create_file", "edit_file", "delete_file", "rename_file", "add_dependency", "add_kit"].includes(name);
    if (mode === "plan" && editing) return { ok: false, result: "Error: plan mode can't edit files." };

    switch (name) {
      case "set_plan": {
        const summary = String(args.summary ?? "").slice(0, 400);
        const steps = Array.isArray(args.steps) ? args.steps.map((s) => stepText(s).slice(0, 160)).filter(Boolean).slice(0, 8) : [];
        if (args.guides === undefined || (Array.isArray(args.guides) && !args.guides.length)) {
          return { ok: true, result: "Plan noted.", plan: { summary, steps } };
        }
        const g = loadGuides(args.guides);
        return { ok: true, result: `Plan noted. Guides for this work:\n\n${g.text}`, plan: { summary, steps }, guides: g.loaded };
      }
      case "write_spec": {
        // The spec call (D152): the one tool that writes the platform-owned spec file.
        if (mode === "plan") return { ok: false, result: "Error: plan mode can't write the spec." };
        const parsed = parseSpec(args);
        if (!parsed.ok) return { ok: false, result: `Error: ${parsed.error} Call write_spec again.` };
        const prev = this.files[SPEC_PATH];
        const content = JSON.stringify(parsed.spec, null, 2) + "\n";
        this.files[SPEC_PATH] = content;
        this.touched.add(SPEC_PATH);
        return {
          ok: true,
          result: "Spec saved. The builders take it from here; stop now.",
          plan: specPlan(parsed.spec),
          change: { path: SPEC_PATH, op: prev === undefined ? "create" : "edit", ...diffStat(prev ?? "", content), diff: unifiedDiff(SPEC_PATH, prev ?? "", content) },
        };
      }
      case "suggest_next": {
        const items = (Array.isArray(args.suggestions) ? args.suggestions : [])
          .map((x) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 90))
          .filter(Boolean)
          .slice(0, 2);
        if (!items.length) return { ok: false, result: "Error: give one or two suggestions." };
        // D163: what works now, as a short list the person reads under the reply's first sentence.
        const line = (x: unknown, max: number) => String(x ?? "").replace(/\s+/g, " ").replace(/^[-*•\d.)\s]+/, "").trim().slice(0, max);
        const works = (Array.isArray(args.works) ? args.works : []).map((x) => line(x, 120)).filter(Boolean).slice(0, 3);
        const later = line(args.later, 160);
        return { ok: true, result: "Suggestions shown. You're done; don't call more tools.", suggestions: items, ...(works.length ? { works } : {}), ...(later ? { later } : {}) };
      }
      case "read_guide": {
        const g = loadGuides(args.name);
        return { ok: g.loaded.length > 0, result: g.text || "Error: give a guide name.", guides: g.loaded };
      }
      case "list_files":
        return { ok: true, result: manifest(this.files), access: "list_files" };
      case "read_file": {
        const path = String(args.path ?? "");
        // Measured live: models try to read an uploaded image as a file (public/assets/logo.svg).
        const upload = new RegExp(`(?:^|/)assets/([A-Za-z0-9][A-Za-z0-9._-]*\\.(?:${ASSET_EXTENSIONS}))$`, "i").exec(path);
        if (upload && !(path in this.files)) {
          return {
            ok: true,
            result: `${upload[1]} is an uploaded file, not a code file, so there is nothing to read. Use it by its path "/assets/${upload[1]}" or through import { assets } from the src/assets folder (its key, size, palette and description are in the context under Uploaded assets).`,
            access: `read_file ${path} (uploaded image)`,
          };
        }
        if (!(path in this.files)) return { ok: false, result: `Error: ${path} doesn't exist. Use list_files or find_symbol.`, access: `read_file ${path} (missing)` };
        if (path === TEMPLATE_IMAGE_MODULE) {
          return {
            ok: true,
            result: "Bundled photograph: import { templateImage } from this module and use src, alt, width and height. Encoded pixels are omitted here; the real module already contains them. Do not rewrite it.\n" + this.files[path].replace(/data:image\/webp;base64,[A-Za-z0-9+/=]+/g, "[embedded photograph]"),
            access: `read_file ${path} (image metadata)`,
          };
        }
        const start = num(args.start_line);
        const end = num(args.end_line);
        const ranged = start !== undefined || end !== undefined;
        const text = this.files[path];
        // v2 (D162, after Codex's tool-output limit): a whole read of a very long file comes back as its first
        // lines, numbered, with how to read the rest. Every later call re-sends what a read returned.
        if (this.v2 && !ranged && text.length > READ_MAX_CHARS) {
          const lines = text.split("\n");
          let upTo = 0;
          for (let used = 0; upTo < lines.length && used + lines[upTo].length + 8 <= READ_MAX_CHARS; upTo++) used += lines[upTo].length + 8;
          return { ok: true, result: `${readRange(text, 1, Math.max(1, upTo))}\n(${lines.length} lines in all. Read the rest with start_line and end_line, a part at a time.)`, access: `read_file ${path} (first ${upTo} lines)` };
        }
        return { ok: true, result: readRange(text, start, end), access: `read_file ${path}${ranged ? `:${start ?? 1}-${end ?? ""}` : ""}` };
      }
      case "search_code": {
        const query = String(args.query ?? "");
        const result = searchCode(this.files, { query, regex: args.regex === true, path: typeof args.path === "string" ? args.path : undefined });
        return { ok: !result.startsWith("Error"), result, access: `search_code "${query.slice(0, 60)}"` };
      }
      case "find_symbol": {
        const name = String(args.name ?? "");
        const result = findSymbol(this.files, name);
        return { ok: !result.startsWith("Error"), result, access: `find_symbol ${name.slice(0, 60)}` };
      }
      case "create_file": {
        const path = String(args.path ?? "");
        const content = typeof args.content === "string" ? args.content : "";
        const problem = pathProblem(path, kitsOf(this.files)) ?? (path in this.files ? null : namingProblem(path)) ?? this.sizeProblem(path, content);
        if (problem) return { ok: false, result: `Error: ${problem}` };
        const prev = this.files[path];
        this.files[path] = content;
        this.touched.add(path);
        const stat = diffStat(prev ?? "", content);
        return {
          ok: true,
          result: prev === undefined ? `Created ${path}.` : `Replaced ${path}.`,
          change: { path, op: prev === undefined ? "create" : "edit", ...stat, diff: unifiedDiff(path, prev ?? "", content) },
        };
      }
      case "edit_file": {
        const path = String(args.path ?? "");
        const problem = pathProblem(path, kitsOf(this.files));
        if (problem) return { ok: false, result: `Error: ${problem}` };
        if (!(path in this.files)) return { ok: false, result: `Error: ${path} doesn't exist. Use create_file for new files.` };
        const edits = (Array.isArray(args.edits) ? args.edits : []) as SearchReplace[];
        const r = applyEdits(this.files[path], edits.map((e) => ({ search: String(e?.search ?? ""), replace: String(e?.replace ?? "") })));
        if (!r.ok) return { ok: false, result: `Error in ${path}: ${r.error}` };
        const size = this.sizeProblem(path, r.content);
        if (size) return { ok: false, result: `Error: ${size}` };
        const prev = this.files[path];
        if (r.content === prev) {
          // Cheap models can loop on edits that change nothing; say so plainly.
          return {
            ok: true,
            result: `No change: ${path} already contains this. Don't repeat the edit. If the work is done, stop calling tools and write your reply.`,
          };
        }
        this.files[path] = r.content;
        this.touched.add(path);
        // Some edits applied and some didn't (D162): keep the good ones, ask again only for the rest.
        const partly = r.failed?.length
          ? ` ${edits.length - r.failed.length} of ${edits.length} edits applied and are kept. These didn't apply; read_file ${path} and send only these again:\n${r.failed.join("\n")}`
          : "";
        return {
          ok: true,
          result: `Edited ${path}${r.fuzzy ? " (matched ignoring whitespace)" : ""}.${partly}`,
          change: { path, op: "edit", ...diffStat(prev, r.content), diff: unifiedDiff(path, prev, r.content) },
        };
      }
      case "delete_file": {
        const path = String(args.path ?? "");
        const problem = pathProblem(path, kitsOf(this.files));
        if (problem) return { ok: false, result: `Error: ${problem}` };
        if (path === "src/App.tsx") return { ok: false, result: "Error: src/App.tsx is the entry and can't be deleted." };
        if (!(path in this.files)) return { ok: false, result: `Error: ${path} doesn't exist.` };
        const prev = this.files[path];
        delete this.files[path];
        this.touched.add(path);
        return { ok: true, result: `Deleted ${path}.`, change: { path, op: "delete", added: 0, removed: prev.split("\n").length, diff: "" } };
      }
      case "rename_file": {
        const from = String(args.from ?? "");
        const to = String(args.to ?? "");
        const problem = pathProblem(from, kitsOf(this.files)) ?? pathProblem(to, kitsOf(this.files)) ?? namingProblem(to);
        if (problem) return { ok: false, result: `Error: ${problem}` };
        if (!(from in this.files)) return { ok: false, result: `Error: ${from} doesn't exist.` };
        if (to in this.files) return { ok: false, result: `Error: ${to} already exists.` };
        this.files[to] = this.files[from];
        delete this.files[from];
        this.touched.add(from).add(to);
        return { ok: true, result: `Renamed ${from} to ${to}. Update any imports.`, change: { path: to, from, op: "rename", added: 0, removed: 0, diff: "" } };
      }
      case "add_dependency": {
        const dep = String(args.name ?? "");
        const allowed = packagesFor(this.files, KITS, { v2: this.v2 });
        if (!(dep in allowed)) {
          const kit = kitForPackage(dep);
          if (kit) return { ok: false, result: `Error: "${dep}" comes with the ${kit.id} kit. Call add_kit("${kit.id}") to turn it on.` };
          return { ok: false, result: `Error: "${dep}" isn't on the allowed list: ${Object.keys(allowed).join(", ")}.` };
        }
        const deps = dependenciesOf(this.files);
        if (deps.includes(dep)) return { ok: true, result: `${dep} is already installed.` };
        const prev = this.files["package.json"] ?? "";
        // A package the preview needs installed beside it (recharts needs react-is).
        const companions = Object.keys(COMPANION_PACKAGES[dep] ?? {});
        this.files["package.json"] = packageJson([...deps, dep, ...companions]);
        this.touched.add("package.json");
        return {
          ok: true,
          result: `Added ${dep}@${allowed[dep]}${companions.length ? ` (and ${companions.join(", ")}, which it needs)` : ""}.`,
          change: { path: "package.json", op: "edit", ...diffStat(prev, this.files["package.json"]), diff: unifiedDiff("package.json", prev, this.files["package.json"]) },
        };
      }
      case "add_kit": {
        const id = String(args.name ?? "").trim();
        const kit = kitById(id);
        if (!kit) return { ok: false, result: KITS.length ? `Error: there is no kit "${id}". Kits: ${KITS.map((k) => k.id).join(", ")}.` : "Error: there are no kits to add." };
        const guide = `<guide name="kit-${kit.id}">\n${kit.guide}\n</guide>`;
        if (kitIdsOf(this.files).includes(kit.id)) return { ok: true, result: `The ${kit.id} kit is already on. Its guide:\n\n${guide}`, guides: [`kit-${kit.id}`] };
        const before = this.files;
        const after = withKit(before, kit);
        const added = Object.keys(after).filter((p) => !(p in before));
        for (const p of Object.keys(this.files)) delete this.files[p];
        Object.assign(this.files, after);
        for (const p of [...added, "package.json"]) this.touched.add(p);
        const prev = before["package.json"] ?? "";
        const packages = Object.keys(kit.packages);
        return {
          ok: true,
          result: `Turned on the ${kit.id} kit.${packages.length ? ` Installed: ${packages.join(", ")}.` : ""}${added.filter((p) => p.startsWith("src/") && !p.endsWith("goodbuild.json")).length ? ` Starter files added: ${added.filter((p) => !p.endsWith("goodbuild.json")).join(", ")}.` : ""} Its guide:\n\n${guide}`,
          guides: [`kit-${kit.id}`],
          change: { path: "package.json", op: "edit", ...diffStat(prev, after["package.json"]), diff: unifiedDiff("package.json", prev, after["package.json"]) },
        };
      }
      default:
        return { ok: false, result: `Error: unknown tool ${name}.` };
    }
  }

  private sizeProblem(path: string, content: string): string | null {
    if (new TextEncoder().encode(content).length > MAX_FILE_BYTES) return `${path} is too large (max ${MAX_FILE_BYTES / 1000} KB). Split it up.`;
    if (!(path in this.files) && Object.keys(this.files).length >= MAX_FILES) return `Too many files (max ${MAX_FILES}).`;
    return null;
  }
}

/** A plan step as text. Models sometimes send objects ({title, detail}) instead of strings. */
function stepText(step: unknown): string {
  if (typeof step === "string") return step.trim();
  if (step && typeof step === "object") {
    const o = step as Record<string, unknown>;
    const main = [o.title, o.step, o.name, o.text, o.description, o.summary].find((v) => typeof v === "string" && v.trim());
    if (typeof main === "string") return main.trim();
    const firstString = Object.values(o).find((v) => typeof v === "string" && v.trim());
    return typeof firstString === "string" ? firstString.trim() : "";
  }
  return step === undefined || step === null ? "" : String(step);
}
