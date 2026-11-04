import { MAX_FILES, MAX_FILE_BYTES, namingProblem, pathProblem } from "./checks";
import { findSymbol, manifest, readRange, searchCode } from "./codebase";
import { applyEdits, diffStat, unifiedDiff, type SearchReplace } from "./edits";
import { loadGuides } from "./guides";
import { ALLOWED_DEPENDENCIES, dependenciesOf, packageJson } from "./template";

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
export class Workspace {
  readonly files: Record<string, string>;
  private readonly before: Record<string, string>;
  readonly touched = new Set<string>();

  constructor(files: Record<string, string>) {
    this.files = { ...files };
    this.before = { ...files };
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
    const editing = ["create_file", "edit_file", "delete_file", "rename_file", "add_dependency"].includes(name);
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
      case "suggest_next": {
        const items = (Array.isArray(args.suggestions) ? args.suggestions : [])
          .map((x) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 90))
          .filter(Boolean)
          .slice(0, 2);
        if (!items.length) return { ok: false, result: "Error: give one or two suggestions." };
        return { ok: true, result: "Suggestions shown. You're done; don't call more tools.", suggestions: items };
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
        const upload = /(?:^|\/)assets\/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp|svg))$/i.exec(path);
        if (upload && !(path in this.files)) {
          return {
            ok: true,
            result: `${upload[1]} is an uploaded image, not a code file, so there is nothing to read. Use it by its path "/assets/${upload[1]}" or through import { assets } from the src/assets folder (its key, size, palette and description are in the context under Uploaded assets).`,
            access: `read_file ${path} (uploaded image)`,
          };
        }
        if (!(path in this.files)) return { ok: false, result: `Error: ${path} doesn't exist. Use list_files or find_symbol.`, access: `read_file ${path} (missing)` };
        const start = num(args.start_line);
        const end = num(args.end_line);
        const ranged = start !== undefined || end !== undefined;
        return { ok: true, result: readRange(this.files[path], start, end), access: `read_file ${path}${ranged ? `:${start ?? 1}-${end ?? ""}` : ""}` };
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
        const problem = pathProblem(path) ?? (path in this.files ? null : namingProblem(path)) ?? this.sizeProblem(path, content);
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
        const problem = pathProblem(path);
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
        return {
          ok: true,
          result: `Edited ${path}${r.fuzzy ? " (matched ignoring whitespace)" : ""}.`,
          change: { path, op: "edit", ...diffStat(prev, r.content), diff: unifiedDiff(path, prev, r.content) },
        };
      }
      case "delete_file": {
        const path = String(args.path ?? "");
        const problem = pathProblem(path);
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
        const problem = pathProblem(from) ?? pathProblem(to) ?? namingProblem(to);
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
        if (!(dep in ALLOWED_DEPENDENCIES)) {
          return { ok: false, result: `Error: "${dep}" isn't on the allowed list: ${Object.keys(ALLOWED_DEPENDENCIES).join(", ")}.` };
        }
        const deps = dependenciesOf(this.files);
        if (deps.includes(dep)) return { ok: true, result: `${dep} is already installed.` };
        const prev = this.files["package.json"] ?? "";
        this.files["package.json"] = packageJson([...deps, dep]);
        this.touched.add("package.json");
        return {
          ok: true,
          result: `Added ${dep}@${ALLOWED_DEPENDENCIES[dep]}.`,
          change: { path: "package.json", op: "edit", ...diffStat(prev, this.files["package.json"]), diff: unifiedDiff("package.json", prev, this.files["package.json"]) },
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
