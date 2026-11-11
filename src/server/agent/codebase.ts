/**
 * Codebase awareness for the agent (P17): a one-line manifest per file, a symbol index, code
 * search and per-request context selection. All lexical and computed from the files
 * themselves: no model calls and no embeddings. Projects are small (≤ 80 files of ≤ 120 KB),
 * so a full scan per call costs well under a millisecond per file; see docs/evals/HARNESS.md
 * for the measurement behind "no vector search".
 */

export interface SymbolDef {
  name: string;
  kind: "component" | "hook" | "function" | "const" | "type" | "class" | "contract" | "event" | "error" | "modifier" | "route" | "default";
  file: string;
  line: number;
}

// ---------------------------------------------------------------------------
// Manifest

const summaryCache = new Map<string, string>();

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** One line about a file: what it exports, its routes, its heading. Cached by content hash. */
export function summarizeFile(path: string, content: string): string {
  const key = `${path}\0${fnv1a(content)}`;
  const hit = summaryCache.get(key);
  if (hit !== undefined) return hit;
  const summary = computeSummary(path, content);
  if (summaryCache.size > 5000) summaryCache.clear();
  summaryCache.set(key, summary);
  return summary;
}

function computeSummary(path: string, content: string): string {
  const parts: string[] = [];
  if (path.endsWith(".sol")) {
    const contracts = [...content.matchAll(/\b(?:abstract\s+)?contract\s+(\w+)(?:\s+is\s+([\w\s,]+?))?\s*\{/g)].map((m) => (m[2] ? `${m[1]} is ${m[2].trim().replace(/\s+/g, " ")}` : m[1]));
    if (contracts.length) parts.push(`contract ${contracts.join("; ")}`);
    const fns = [...content.matchAll(/\bfunction\s+(\w+)\s*\(([^)]*)\)([^{;]*)/g)]
      .filter((m) => /\b(public|external)\b/.test(m[3]))
      .map((m) => `${m[1]}${/\b(view|pure)\b/.test(m[3]) ? "(view)" : "()"}`);
    if (fns.length) parts.push(`fns ${fns.slice(0, 12).join(", ")}${fns.length > 12 ? ", …" : ""}`);
    const events = [...content.matchAll(/\bevent\s+(\w+)/g)].map((m) => m[1]);
    if (events.length) parts.push(`events ${events.slice(0, 6).join(", ")}`);
  } else if (path.endsWith(".html")) {
    const title = content.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
    if (title) parts.push(`title "${title}"`);
    const tokens = [...content.matchAll(/--(color-(?:primary|accent|background)|font-display|font-sans)\s*:\s*([^;]+);/g)].map((m) => `${m[1]} ${m[2].split(",")[0].trim()}`);
    if (tokens.length) parts.push(tokens.slice(0, 5).join(", "));
    if (/rel=["']icon["']/i.test(content)) parts.push("favicon set");
  } else if (/\.(tsx?|jsx?)$/.test(path)) {
    const comment = content.match(/^\s*(?:\/\*\*?\s*\n?\s*\*?\s*([^\n*][^\n]*)|\/\/\s*([^\n]+))/)?.slice(1).find(Boolean)?.trim();
    const defs = symbolsIn(path, content);
    const def = defs.find((d) => d.kind === "default");
    const exported = defs.filter((d) => d.kind !== "default" && d.kind !== "route").map((d) => d.name);
    if (def) parts.push(`default ${def.name}`);
    if (exported.length) parts.push(`exports ${exported.slice(0, 8).join(", ")}${exported.length > 8 ? ", …" : ""}`);
    const routes = defs.filter((d) => d.kind === "route").map((d) => d.name);
    if (routes.length) parts.push(`routes ${routes.slice(0, 10).join(" ")}`);
    const h1 = content.match(/<h1[^>]*>\s*([^<{]{3,80})/)?.[1]?.trim().replace(/\s+/g, " ");
    if (h1) parts.push(`h1 "${h1}"`);
    const sections = [...content.matchAll(/<section[^>]*\bid=["']([\w-]+)["']/g)].map((m) => m[1]);
    if (sections.length) parts.push(`sections #${sections.slice(0, 8).join(" #")}`);
    if (comment && comment.length < 120 && !/^(eslint|@ts-|use client)/.test(comment)) parts.unshift(comment.replace(/\*\/$/, "").trim());
  } else if (path.endsWith(".css")) {
    parts.push("styles");
  }
  const text = parts.join(" · ");
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** The file tree for the model: path, size and its one-line summary. */
export function manifest(files: Record<string, string>): string {
  return Object.keys(files)
    .sort()
    .map((p) => {
      const s = summarizeFile(p, files[p]);
      return `${p} (${files[p].length} chars)${s ? ` · ${s}` : ""}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Symbols

/** Definitions in one file: exports, components, hooks, routes; contracts, functions, events. */
export function symbolsIn(file: string, content: string): SymbolDef[] {
  const out: SymbolDef[] = [];
  const lineOf = (index: number) => content.slice(0, index).split("\n").length;
  const add = (name: string, kind: SymbolDef["kind"], index: number) => out.push({ name, kind, file, line: lineOf(index) });
  if (file.endsWith(".sol")) {
    for (const m of content.matchAll(/\b(contract|interface|library)\s+(\w+)/g)) add(m[2], "contract", m.index);
    for (const m of content.matchAll(/\bfunction\s+(\w+)/g)) add(m[1], "function", m.index);
    for (const m of content.matchAll(/\bevent\s+(\w+)/g)) add(m[1], "event", m.index);
    for (const m of content.matchAll(/\berror\s+(\w+)\s*\(/g)) add(m[1], "error", m.index);
    for (const m of content.matchAll(/\bmodifier\s+(\w+)/g)) add(m[1], "modifier", m.index);
    return out;
  }
  if (!/\.(tsx?|jsx?)$/.test(file)) return out;
  const kindFor = (name: string, isFn: boolean): SymbolDef["kind"] =>
    /^use[A-Z]/.test(name) ? "hook" : /^[A-Z]/.test(name) && isFn && file.endsWith("x") ? "component" : isFn ? "function" : "const";
  for (const m of content.matchAll(/export\s+default\s+(?:async\s+)?function\s+(\w+)/g)) add(m[1], "default", m.index);
  for (const m of content.matchAll(/export\s+default\s+([A-Z]\w*)\s*;?\s*$/gm)) add(m[1], "default", m.index);
  for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) add(m[1], kindFor(m[1], true), m.index);
  for (const m of content.matchAll(/export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(\(|async\s*\(|React\.forwardRef|forwardRef|function)?/g)) add(m[1], kindFor(m[1], Boolean(m[2])), m.index);
  for (const m of content.matchAll(/export\s+(?:interface|type)\s+(\w+)/g)) add(m[1], "type", m.index);
  for (const m of content.matchAll(/export\s+class\s+(\w+)/g)) add(m[1], "class", m.index);
  for (const m of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const name of m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!.trim()).filter((s) => /^\w+$/.test(s))) add(name, kindFor(name, /^[A-Z]/.test(name)), m.index);
  }
  // Components that aren't exported (helpers inside a page) still help find_symbol.
  for (const m of content.matchAll(/^(?:function|const)\s+([A-Z]\w+)\s*(?:=\s*\(|\()/gm)) {
    if (!out.some((d) => d.name === m[1])) add(m[1], "component", m.index);
  }
  for (const m of content.matchAll(/<Route\b[^>]*?\bpath=["']([^"']+)["']/g)) add(`/${m[1].replace(/^\//, "")}`, "route", m.index);
  for (const m of content.matchAll(/<Route\b[^>]*?\bindex\b/g)) add("/", "route", m.index);
  return out.sort((a, b) => a.line - b.line);
}

export function symbolIndex(files: Record<string, string>): SymbolDef[] {
  return Object.entries(files).flatMap(([p, c]) => symbolsIn(p, c));
}

/** find_symbol: definitions matching the name (exact first, then partial), plus files that use it. */
export function findSymbol(files: Record<string, string>, query: string): string {
  const q = query.trim().replace(/^[<{(]|[>})]$/g, "");
  if (!q) return "Error: give a symbol name, e.g. Hero, useTipJar, tip or /about.";
  const all = symbolIndex(files);
  const lower = q.toLowerCase();
  let hits = all.filter((d) => d.name === q);
  if (!hits.length) hits = all.filter((d) => d.name.toLowerCase() === lower);
  if (!hits.length) hits = all.filter((d) => d.name.toLowerCase().includes(lower));
  if (!hits.length) return `No definition named like "${q}". Try search_code for text, or list_files.`;
  const defs = hits.slice(0, 15).map((d) => `${d.file}:${d.line} ${d.kind} ${d.name}`);
  const names = [...new Set(hits.map((d) => d.name))].filter((n) => /^\w+$/.test(n)).slice(0, 3);
  const users = new Set<string>();
  for (const n of names) {
    const re = new RegExp(`\\b${n}\\b`);
    for (const [p, c] of Object.entries(files)) if (re.test(c) && !hits.some((d) => d.file === p && d.name === n)) users.add(p);
  }
  return `${defs.join("\n")}${hits.length > 15 ? `\n… ${hits.length - 15} more` : ""}${users.size ? `\nUsed in: ${[...users].sort().slice(0, 12).join(", ")}` : ""}`;
}

// ---------------------------------------------------------------------------
// Search and ranged reads

const MAX_HITS = 40;

/** search_code: literal (default, case-insensitive) or regex over every file; file:line: text. */
export function searchCode(files: Record<string, string>, args: { query: string; regex?: boolean; path?: string; caseSensitive?: boolean }): string {
  const query = args.query ?? "";
  if (!query.trim()) return "Error: give a query.";
  let re: RegExp;
  try {
    re = args.regex ? new RegExp(query, args.caseSensitive ? "" : "i") : new RegExp(escapeRe(query), args.caseSensitive ? "" : "i");
  } catch (e) {
    return `Error: invalid regex: ${(e as Error).message}`;
  }
  const prefix = (args.path ?? "").replace(/^\/+/, "").replace(/\*+$/, "");
  const hits: string[] = [];
  let total = 0;
  const filesHit = new Set<string>();
  for (const p of Object.keys(files).sort()) {
    if (prefix && !p.startsWith(prefix)) continue;
    const lines = files[p].split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      total++;
      filesHit.add(p);
      if (hits.length < MAX_HITS) hits.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
    }
  }
  if (!total) return `No matches for ${args.regex ? "/" + query + "/" : `"${query}"`}${prefix ? ` under ${prefix}` : ""}.`;
  return `${hits.join("\n")}${total > hits.length ? `\n… ${total - hits.length} more matches in ${filesHit.size} files; narrow the query or path.` : ""}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A file's lines with numbers, optionally a range (1-based, inclusive). Whole small files have no numbers. */
export function readRange(content: string, start?: number, end?: number): string {
  if (start === undefined && end === undefined) return content;
  const lines = content.split("\n");
  const from = Math.max(1, Math.floor(start ?? 1));
  const to = Math.min(lines.length, Math.floor(end ?? lines.length));
  if (from > lines.length) return `Error: the file has ${lines.length} lines.`;
  const width = String(to).length;
  const body = lines
    .slice(from - 1, to)
    .map((l, i) => `${String(from + i).padStart(width)}| ${l}`)
    .join("\n");
  return `Lines ${from}-${to} of ${lines.length} (the "N| " prefix is not part of the file; don't copy it into edits):\n${body}`;
}

// ---------------------------------------------------------------------------
// Context selection

const STOP = new Set(
  "the and for with that this from into make add change update use can you please want some more less have like just also need page app my our your its it's what when where which there their them then than show button text colour color new all one two".split(" "),
);

/**
 * How users name things vs how files are named (HARNESS.md E3b: "404 page" missed NotFound.tsx).
 * Applied to the request only, never to paths.
 */
const ALIASES: Record<string, string[]> = {
  "404": ["found"],
  notfound: ["found"],
  nav: ["layout", "header", "navbar"],
  navbar: ["layout", "header", "nav"],
  navigation: ["layout", "header", "nav"],
  menu: ["layout", "header", "nav"],
  header: ["layout", "nav"],
  topbar: ["layout", "header"],
  landing: ["home", "hero"],
  homepage: ["home", "hero"],
  headline: ["hero"],
  banner: ["hero"],
  faq: ["question"],
  questions: ["faq"],
  question: ["faq"],
  cta: ["call", "action", "band"],
  stat: ["stats", "statsrow"],
  stats: ["stat", "statsrow"],
  leaderboard: ["top", "rank"],
  wallet: ["connect", "connectbutton"],
  colour: ["index", "theme"],
  color: ["index", "theme"],
  font: ["index", "theme"],
  theme: ["index"],
  favicon: ["index"],
};

/** Request words plus their aliases, for context ranking. */
export function requestTerms(text: string): string[] {
  const base = terms(text);
  return [...new Set(base.flatMap((w) => [w, ...(ALIASES[w] ?? [])]))];
}

/** Request words worth matching: lowercased, ≥ 3 letters, stopwords dropped, simple plural folding. */
export function terms(text: string): string[] {
  const words = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return [...new Set(words)];
}

function tokensOf(s: string): Set<string> {
  return new Set(terms(s.replace(/[./_-]/g, " ")));
}

/** Files always worth sending when they exist: the entry, the theme and the contracts. */
const ALWAYS = ["src/App.tsx", "public/index.html"];
const ASSETS = "src/assets/index.ts";
/** Platform and starter files the model knows from the prompt; sent only when the request names them. */
// The motion kit's pieces (src/fx/, D84) are here too: its guide documents every prop, so they go in
// only with budget to spare.
const LOW = /^(src\/components\/ui\/|src\/contracts\/|src\/lib\/(utils|chain|useWallet|tokens|format|hooks)\.ts$|src\/main\.tsx$|src\/assets\/|src\/fx\/)/;

export interface ContextPick {
  path: string;
  score: number;
  reason: string;
}

/**
 * Pick the files to send in full for this request, within budget: the entry and theme, the
 * contracts, then files ranked by how well their path, symbols and text match the request,
 * then files changed last turn, then import neighbours of the top picks. The rest is in the
 * manifest for search_code / find_symbol / read_file.
 */
export function selectContext(
  files: Record<string, string>,
  request: string,
  opts: { budgetChars?: number; recent?: string[]; history?: string } = {},
): ContextPick[] {
  const budget = opts.budgetChars ?? 40_000;
  // The app-data guide documents these two, and every turn on every small project would pay for them
  // (about 11k chars). The manifest still lists them, so read_file can fetch them.
  // The same goes for GoodBuild's wallet layer (src/lib/goodbuild/), which the prompt documents.
  // And the motion kit's stylesheet: keyframes the builder never edits or needs to read.
  files = Object.fromEntries(Object.entries(files).filter(([p]) => p !== "src/lib/db.ts" && p !== "src/lib/useDb.ts" && p !== "src/fx/fx.css" && !p.startsWith("src/lib/goodbuild/")));
  const want = requestTerms(request);
  const soft = terms(opts.history ?? "").filter((t) => !want.includes(t));
  const symbols = symbolIndex(files);
  const scored: ContextPick[] = [];
  for (const [p, content] of Object.entries(files)) {
    const pathTokens = tokensOf(p);
    const symTokens = new Set(symbols.filter((s) => s.file === p).flatMap((s) => [...tokensOf(s.name)]));
    const lower = content.toLowerCase();
    let score = 0;
    const why: string[] = [];
    for (const t of want) {
      if (pathTokens.has(t)) {
        score += 8;
        why.push(`path:${t}`);
      } else if (symTokens.has(t)) {
        score += 5;
        why.push(`symbol:${t}`);
      }
      const n = countOf(lower, t);
      if (n) score += Math.min(3, n) * (t.length >= 5 ? 1 : 0.5);
    }
    for (const t of soft) if (pathTokens.has(t) || symTokens.has(t)) score += 1;
    if (opts.recent?.includes(p)) {
      score += 3;
      why.push("changed last turn");
    }
    if (LOW.test(p)) score = why.some((w) => w.startsWith("path:")) ? score : score * 0.2;
    scored.push({ path: p, score, reason: why.join(" ") });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const picks: ContextPick[] = [];
  let used = 0;
  const take = (p: string, reason: string, score = 0) => {
    if (!(p in files) || picks.some((x) => x.path === p)) return;
    if (used + files[p].length > budget) return;
    used += files[p].length;
    picks.push({ path: p, score, reason });
  };
  for (const p of ALWAYS) take(p, "entry/theme");
  for (const p of Object.keys(files).sort()) if (/^contracts\/[^/]+\.sol$/.test(p)) take(p, "contract");
  // A project whose own files fit the budget is sent whole (minus starter pieces the prompt
  // already describes): a read round trip re-sends the whole conversation, which costs more
  // than the files. Measured: a typical 30-file project is about 28k chars (HARNESS.md).
  // Measured in HARNESS.md E1: without the starter pieces, a first build spent a round reading
  // button, card, badge and notice. So when everything fits, everything goes.
  const ownSize = Object.entries(files).reduce((n, [p, c]) => n + (LOW.test(p) ? 0 : c.length), 0);
  const allSize = Object.values(files).reduce((n, c) => n + c.length, 0);
  const fitsAll = allSize <= budget;
  const fitsWhole = ownSize <= budget;
  take(ASSETS, "uploaded assets");
  for (const s of scored) {
    // Platform ABI modules are large and the contract source is already in: over budget, they
    // only go in when the whole project fits (E3b: TipJar.ts took the room of small helpers).
    if (!fitsAll && s.path.startsWith("src/contracts/")) continue;
    if (s.score >= 2 || fitsAll || (fitsWhole && !LOW.test(s.path))) take(s.path, s.reason || (s.score >= 2 ? "text match" : "fits budget"), s.score);
  }
  // Import neighbours of the strongest matches (what they render or call).
  for (const s of picks.filter((x) => x.score >= 5).slice(0, 4)) {
    for (const dep of localImports(s.path, files[s.path], files)) if (!LOW.test(dep)) take(dep, `imported by ${s.path}`);
  }
  // Leftover budget: the small starter helpers and UI pieces, smallest first. Measured in
  // HARNESS.md E4 turn 10: without them a page-adding turn spent a round reading nine of them.
  // Platform ABI modules stay out (large; the manifest names their exports).
  for (const p of Object.keys(files)
    .filter((p) => LOW.test(p) && !p.startsWith("src/contracts/"))
    .sort((a, b) => files[a].length - files[b].length)) {
    take(p, "starter helper");
  }
  return picks;
}

function countOf(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i >= 0 && n < 5; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Relative imports of a TS file resolved to project paths. */
export function localImports(file: string, content: string, files: Record<string, string>): string[] {
  const dir = file.split("/").slice(0, -1);
  const out: string[] = [];
  for (const m of content.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    const parts = [...dir];
    for (const seg of m[1].split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    const base = parts.join("/");
    const hit = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((c) => c in files);
    if (hit) out.push(hit);
  }
  return out;
}
