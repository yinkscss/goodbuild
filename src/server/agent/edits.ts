import { diffLines, createTwoFilesPatch } from "diff";

/**
 * Search/replace edits (AI_AGENT.md §2, Aider/Cursor style). Each `search` must match
 * exactly one place. If an exact match fails, a whitespace-tolerant line match is tried
 * (indentation and trailing spaces ignored); it must also be unique. Errors are returned
 * as text for the model to correct, never thrown.
 */
export interface SearchReplace {
  search: string;
  replace: string;
}

export type EditResult = { ok: true; content: string; fuzzy: boolean } | { ok: false; error: string };

export function applyEdits(original: string, edits: SearchReplace[]): EditResult {
  if (!edits.length) return { ok: false, error: "No edits given." };
  let content = original;
  let fuzzy = false;
  for (const [i, edit] of edits.entries()) {
    const label = edits.length > 1 ? `Edit ${i + 1}: ` : "";
    if (!edit.search) return { ok: false, error: `${label}"search" is empty. Use create_file to write a whole file.` };
    const exact = countOccurrences(content, edit.search);
    if (exact === 1) {
      content = content.replace(edit.search, () => edit.replace);
      continue;
    }
    if (exact > 1) {
      return { ok: false, error: `${label}"search" matches ${exact} places. Include more surrounding lines so it's unique.` };
    }
    const range = fuzzyFind(content, edit.search);
    if (range === "ambiguous") {
      return { ok: false, error: `${label}"search" matches several places when whitespace is ignored. Add more context.` };
    }
    if (!range) {
      return {
        ok: false,
        error: `${label}"search" text was not found. Read the file again (read_file) and copy the lines exactly.`,
      };
    }
    const lines = content.split("\n");
    const replacement = reindent(edit.replace, lines[range.start], edit.search);
    content = [...lines.slice(0, range.start), ...replacement.split("\n"), ...lines.slice(range.end)].join("\n");
    fuzzy = true;
  }
  return { ok: true, content, fuzzy };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + 1;
  }
}

const norm = (line: string) => line.trim();

/** Line range [start, end) whose trimmed lines equal the trimmed search lines. */
function fuzzyFind(content: string, search: string): { start: number; end: number } | "ambiguous" | null {
  const lines = content.split("\n");
  const needle = search.replace(/\n+$/, "").split("\n").map(norm);
  while (needle.length && needle[0] === "") needle.shift();
  while (needle.length && needle[needle.length - 1] === "") needle.pop();
  if (!needle.length) return null;
  const hits: number[] = [];
  for (let i = 0; i + needle.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (norm(lines[i + j]) !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(i);
  }
  if (hits.length > 1) return "ambiguous";
  if (!hits.length) return null;
  return { start: hits[0], end: hits[0] + needle.length };
}

/** Shift the replacement so its first line takes the indentation of the matched line. */
function reindent(replace: string, matchedFirstLine: string, search: string): string {
  const target = matchedFirstLine.match(/^\s*/)?.[0] ?? "";
  const firstSearchLine = search.split("\n").find((l) => l.trim()) ?? "";
  const source = firstSearchLine.match(/^\s*/)?.[0] ?? "";
  if (target === source) return replace.replace(/\n$/, "");
  return replace
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => (l.startsWith(source) ? target + l.slice(source.length) : l))
    .join("\n");
}

export interface DiffStat {
  added: number;
  removed: number;
}

export function diffStat(before: string, after: string): DiffStat {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    if (part.added) added += part.count ?? 0;
    else if (part.removed) removed += part.count ?? 0;
  }
  return { added, removed };
}

/** Unified diff for the collapsible diff view, capped so huge rewrites stay light. */
export function unifiedDiff(path: string, before: string, after: string, maxLines = 400): string {
  const patch = createTwoFilesPatch(path, path, before, after, "", "", { context: 2 });
  const lines = patch.split("\n").slice(4); // drop the file headers
  return lines.length > maxLines ? [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`].join("\n") : lines.join("\n");
}
