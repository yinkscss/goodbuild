import type { CheckIssue } from "./checks";
import { readRange } from "./codebase";
import { unifiedDiff } from "./edits";
import { PLATFORM_DIR } from "./template";

/**
 * Focused conversations (D162, after GPT Engineer: every step is a new, short conversation with the files it
 * needs). A fix attempt or the fix after the visual check used to run on the build's whole conversation, so
 * each of its calls re-sent every earlier round. Now it gets the system prompt (the same text, so the cache
 * still hits), and one message: what the app is, the problems, and the files the problems name with line
 * numbers. The project's files are the source of truth, and read_file gets any other file.
 */

/** File text sent in full, in all. A file that doesn't fit is named, to be read with read_file. */
const FILES_BUDGET_CHARS = 40_000;
/** One file longer than this is sent as its first lines only. */
const FILE_MAX_CHARS = 16_000;
/** What the last attempt changed, for the different-approach retry. */
const DIFF_BUDGET_CHARS = 4_000;
const MAX_LISTED = 150;

export interface FixContextInput {
  /** The person's request for this turn. */
  request: string;
  /** The spec's one-paragraph summary, when there is a spec. */
  summary?: string;
  /** The problems, as formatIssues prints them. */
  issues: string;
  errors: CheckIssue[];
  files: Record<string, string>;
  /** Set on the retry after the same problems came back: the files as they were before the last attempt. */
  before?: Record<string, string>;
}

/** The fix rules every attempt gets (the same words the build's fix message used). */
export const FIX_RULES =
  "Fix these problems with edit_file. A [runtime] problem is what happened when GoodBuild opened the built app in a browser, and a [types] problem is TypeScript's: read the named file before changing it. If a contract test fails, decide whether the contract or the test is wrong: fix the contract when it misbehaves; change a test only when its expectation is mistaken, and never delete or weaken a check just to make it pass. Then stop with a very short note (the person sees the fix steps, not this note).";

const DIFFERENT_WAY =
  "Your last attempt didn't fix these problems: the same ones came back. Don't repeat it. Find the real cause first: read the files the problems point to and the files they import, and check names, props and imports against what those files really export. Then fix it another way. If a file is in a bad state, write it again whole with create_file.";

export function fixContext(input: FixContextInput): string {
  const named = [...new Set(input.errors.map((e) => e.file).filter((p) => p in input.files))];
  const about = [`The person asked for: ${input.request.trim().slice(0, 600)}`, input.summary ? `The plan for the app: ${input.summary.trim().slice(0, 600)}` : ""].filter(Boolean).join("\n");
  const retry = input.before ? `\n\n${DIFFERENT_WAY}\n\nWhat the last attempt changed:\n${changesSince(input.before, input.files)}` : "";
  return `FIX. GoodBuild built this app and its checks found problems.\n${about}${retry}\n\nProblems:\n${input.issues}\n\n${FIX_RULES}\n\n${filesBlock(input.files, named)}`;
}

/** The fix after the visual check (D87, D162): its list and the page files this turn changed. */
export function reviewFixContext(input: { request: string; message: string; files: Record<string, string>; changed: string[] }): string {
  const seen = input.changed.filter((p) => /^(src\/.*\.(tsx|jsx|css)|public\/index\.html)$/.test(p) && p in input.files);
  return `The person asked for: ${input.request.trim().slice(0, 600)}\n\n${input.message}\n\n${filesBlock(input.files, seen)}`;
}

function filesBlock(files: Record<string, string>, named: string[]): string {
  const blocks: string[] = [];
  const skipped: string[] = [];
  let used = 0;
  for (const path of named) {
    const text = files[path];
    const long = text.length > FILE_MAX_CHARS;
    const body = long ? `${readRange(text, 1, linesWithin(text, FILE_MAX_CHARS))}\n(${text.split("\n").length} lines in all: read_file ${path} with start_line and end_line for the rest)` : readRange(text, 1, text.split("\n").length);
    if (used + body.length > FILES_BUDGET_CHARS) {
      skipped.push(path);
      continue;
    }
    used += body.length;
    blocks.push(`=== ${path} ===\n${body}`);
  }
  const others = Object.keys(files).filter((p) => !named.includes(p) && !p.startsWith(PLATFORM_DIR)).sort();
  const listed = others.slice(0, MAX_LISTED).join("\n");
  const more = others.length > MAX_LISTED ? `\n(and ${others.length - MAX_LISTED} more: list_files)` : "";
  const shown = blocks.length ? `The files the problems name, as they are now (the "N| " prefix is not part of the file; don't copy it into edits):\n\n${blocks.join("\n\n")}` : "No file is named: read the files the problems describe.";
  const notShown = skipped.length ? `\n\nAlso named, not shown (too long to include): ${skipped.join(", ")}. Read them with read_file.` : "";
  return `${shown}${notShown}\n\nThe project's other files (read_file any of them):\n${listed}${more}`;
}

function linesWithin(text: string, chars: number): number {
  let n = 0;
  let used = 0;
  for (const line of text.split("\n")) {
    used += line.length + 8;
    if (used > chars) break;
    n++;
  }
  return Math.max(1, n);
}

/** The diff of every file the last attempt changed, cut to a budget. */
export function changesSince(before: Record<string, string>, after: Record<string, string>): string {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((p) => before[p] !== after[p] && !p.startsWith(PLATFORM_DIR)).sort();
  if (!paths.length) return "Nothing: it changed no files.";
  let out = "";
  for (const p of paths) {
    const d = after[p] === undefined ? `deleted ${p}\n` : unifiedDiff(p, before[p] ?? "", after[p]);
    if (out.length + d.length > DIFF_BUDGET_CHARS) {
      out += `\n(more changes in ${paths.slice(paths.indexOf(p)).join(", ")})`;
      break;
    }
    out += d;
  }
  return out.trim();
}
