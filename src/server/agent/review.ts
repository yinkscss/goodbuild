import type { FileChange } from "@/lib/turn-types";

/**
 * The review (D87): after a build passes its checks, the builder looks at its own page. The run
 * check (D67) already opens the app in a browser on the server; here it also takes a picture at
 * phone and computer width, the strong model reads both and lists what a person would call broken
 * or unfinished, and the build model fixes that list in one pass.
 *
 * Why the strong model reviews and the cheap one fixes: reading two pictures costs about a cent on
 * the strong model, and the cheap model's own reviews were measured raising problems that weren't
 * there (HARNESS.md, "Weak spot"), which is harmless while a person decides and expensive once the
 * list goes straight to a fix. Writing is where the cheap model is cheap.
 *
 * It replaces the check in the person's browser (P17) for the builds it runs on: that one needed
 * the tab open and the in-browser preview, and never changed anything.
 */

/** Off unless the server says so, like the run check: it spends money on every build it looks at. */
export function reviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VISUAL_REVIEW === "1" || env.VISUAL_REVIEW === "on";
}

export const MAX_REVIEW_ISSUES = 5;
/** Enough for five short problems as JSON. */
export const REVIEW_MAX_TOKENS = 700;
/** A later turn is looked at only when it changed at least this many lines of what people see. */
export const REVIEW_MIN_CHANGED_LINES = 60;

const SEEN = /^(src\/.*\.(tsx|jsx|css)|public\/index\.html)$/;

/**
 * Whether this turn's work is worth a look. A first build always is. A later turn is when it
 * changed enough of the page: a look costs about twice what a small edit does, so a new label or
 * a colour change isn't worth it.
 */
export function worthReviewing(firstBuild: boolean, changes: FileChange[]): boolean {
  if (firstBuild) return true;
  const lines = changes.filter((c) => SEEN.test(c.path)).reduce((n, c) => n + c.added + c.removed, 0);
  return lines >= REVIEW_MIN_CHANGED_LINES;
}

export function reviewPrompt(args: { request: string; direction?: string; pictures?: string[] }): string {
  const direction = args.direction?.trim() ? `\nThe builder's own plan for it: "${args.direction.trim().slice(0, 400)}".` : "";
  // A game (D91): a start screen and a moment of play, so the reviewer judges each for what belongs on it.
  const what = args.pictures?.length
    ? `These are ${args.pictures.length} screenshots of a game GoodBuild just built, in this order: ${args.pictures.map((p, i) => `(${i + 1}) ${p}`).join("; ")}. The person asked for: "${args.request.slice(0, 600)}".${direction}
On the start screen, expect the game area drawn (not an empty or one-colour box), the game's name, how to play and a Play button; obstacles, characters and a moving score only appear once it runs, so judge those on the picture taken during play. An empty or one-colour game area on either is broken.
`
    : `These are two screenshots of a web app GoodBuild just built: the first is 375px wide (a phone), the second 1280px wide (a computer). Each shows the page from the top, about 1,500px down. The person asked for: "${args.request.slice(0, 600)}".${direction}
`;
  return `${what}
Look at them the way a careful designer looks at a build before it ships, and list what a person would call broken or unfinished. Only things you can SEE, and only things one edit could fix:
- broken layout: elements that overlap, are cut off, spill off the side of the phone, or leave a large empty gap that is clearly a mistake;
- text that is hard to read: low contrast against its background, text over a busy area, text smaller than about 12px on the phone;
- the phone: anything that only works on the wide screen (a row that doesn't stack, a table that doesn't fit, buttons too small to tap);
- no clear main thing to do at the top of the page, or a headline that doesn't say what this is;
- unstyled or unfinished parts: default browser styling, a section that looks different from the rest for no reason, placeholder words such as "Lorem ipsum" or "My dApp", a part the person asked for that is plainly missing.

These screenshots were taken with no network, no wallet and no blockchain, so do NOT report any of this:
- pictures the person uploaded appear as empty boxes;
- web fonts are replaced by the system font;
- numbers from a contract show as loading shapes, dashes or zeros, and there may be notices such as "Deploy the contract to go live", "No network" or a failed-to-load message;
- a "Connect wallet" button, and sample values that are labelled as examples;
- anything further down the page than these screenshots reach.
Don't report taste (you would have picked another colour or font) and don't ask for new features.

Reply with JSON only, no code fence: {"ok": true} when nothing needs fixing, or {"ok": false, "issues": ["which screen (phone, computer or both), where on the page, what is wrong, and what to change", ...]} with at most ${MAX_REVIEW_ISSUES} issues, the worst first.`;
}

/** The reviewer's reply as a verdict, or null when it can't be used (then nothing is changed). */
export function parseReview(text: string): { ok: boolean; issues: string[] } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1)) as { ok?: unknown; issues?: unknown };
    if (typeof j.ok !== "boolean") return null;
    const issues = Array.isArray(j.issues)
      ? j.issues
          .map((s) => String(s ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, 320))
          .filter(Boolean)
          .slice(0, MAX_REVIEW_ISSUES)
      : [];
    // "Not ok" with nothing named can't be acted on, and "ok" with a list is a list.
    if (!j.ok && !issues.length) return null;
    return { ok: issues.length === 0, issues };
  } catch {
    return null;
  }
}

/** What the builder is told to fix. One pass, and nothing but the list. */
export function reviewFixMessage(issues: string[]): string {
  return `GoodBuild opened the app you built and looked at it on a phone (375px wide) and on a computer (1280px wide). The checks pass, but these problems show on the page. Fix each one with edit_file (read a file before changing it), and change nothing else: no new features, no rewrites, no new files unless a fix needs one. Keep to the theme tokens and keep everything that already works. When they are fixed, call run_checks once, then stop with a very short note (the person sees the steps, not this note):
${issues.map((i) => `- [visual] ${i}`).join("\n")}`;
}
