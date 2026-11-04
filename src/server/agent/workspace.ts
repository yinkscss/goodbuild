import { MAX_FILES, MAX_FILE_BYTES, pathProblem } from "./checks";
import { applyEdits, diffStat, unifiedDiff, type SearchReplace } from "./edits";
import { ALLOWED_DEPENDENCIES, dependenciesOf, packageJson } from "./template";

import type { FileChange } from "@/lib/turn-types";

export type { FileChange };

export interface ToolOutcome {
  /** Text returned to the model. */
  result: string;
  ok: boolean;
  change?: FileChange;
  plan?: { summary: string; steps: string[] };
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
        const steps = Array.isArray(args.steps) ? args.steps.map((s) => String(s).slice(0, 160)).slice(0, 8) : [];
        return { ok: true, result: "Plan noted.", plan: { summary, steps } };
      }
      case "list_files":
        return {
          ok: true,
          result: Object.keys(this.files)
            .sort()
            .map((p) => `${p} (${this.files[p].length} chars)`)
            .join("\n"),
        };
      case "read_file": {
        const path = String(args.path ?? "");
        if (!(path in this.files)) return { ok: false, result: `Error: ${path} doesn't exist. Use list_files.` };
        return { ok: true, result: this.files[path] };
      }
      case "create_file": {
        const path = String(args.path ?? "");
        const content = typeof args.content === "string" ? args.content : "";
        const problem = pathProblem(path) ?? this.sizeProblem(path, content);
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
        const problem = pathProblem(from) ?? pathProblem(to);
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
