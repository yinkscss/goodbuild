/**
 * The live-values build rule (D159), checked: values that can change must come from useRead or
 * useCollection (which refresh by themselves after transactions and saved-data writes), and a page
 * that shows them needs a RefreshButton. These are notes, never errors: they're shown to the builder
 * when it runs the checks and logged for the owner, and a build never fails on them. Once real builds
 * show how often they fire (and how often wrongly), they can be made to block, like TYPE_CHECK.
 *
 * Plain text matching on purpose: cheap, no parse, and false positives only cost a note.
 */
import type { CheckIssue } from "./checks";
import { kitsOf } from "./kits/registry";

/** GoodBuild's own files and the starter helpers: they're how values stay live, not app code. */
const OWN = new Set(["src/lib/hooks.ts", "src/lib/chain.ts", "src/lib/db.ts", "src/lib/useDb.ts", "src/lib/useWallet.ts"]);
const OWN_DIRS = ["src/lib/goodbuild/", "src/contracts/", "src/components/ui/"];

/** A read of chain state or saved data: these give values that change. */
const READ = /\bpublicClient\s*\.\s*(?:readContract|getBalance|multicall|getLogs|getContractEvents)\s*\(|\bcollection\s*(?:<[^>()]*>)?\s*\([^)]*\)\s*\.\s*(?:list|get)\s*\(/;
/** A hand-rolled effect or timer: the body that follows is searched for a READ. */
const HAND_ROLLED = /\b(?:useEffect|useLayoutEffect|setInterval)\s*\(/g;
const RELOAD = /\b(?:window\s*\.\s*)?location\s*\.\s*reload\s*\(/;
const LIVE_HOOK = /\b(?:useRead|useCollection|useLive|useLeaderboard|useShop)\s*(?:<[^>()]*>)?\s*\(/;

const lineOf = (content: string, index: number) => content.slice(0, index).split("\n").length;

/**
 * The body of the call that opens at `open` (the index of its "("), by bracket count, at most 2,000
 * characters. Strings and comments aren't skipped: close enough for a note.
 */
function callBody(content: string, open: number): string {
  let depth = 0;
  const end = Math.min(content.length, open + 2000);
  for (let i = open; i < end; i++) {
    const c = content[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return content.slice(open, i + 1);
  }
  return content.slice(open, end);
}

export function liveValueIssues(files: Record<string, string>): CheckIssue[] {
  const kitFiles = new Set(kitsOf(files).flatMap((k) => Object.keys(k.files)));
  const appFiles = Object.entries(files).filter(
    ([file]) => /\.(tsx?|jsx?)$/.test(file) && !OWN.has(file) && !OWN_DIRS.some((d) => file.startsWith(d)) && !kitFiles.has(file) && !/\.test\.[jt]sx?$/.test(file),
  );
  const issues: CheckIssue[] = [];

  for (const [file, content] of appFiles) {
    for (const m of content.matchAll(HAND_ROLLED)) {
      const body = callBody(content, m.index + m[0].length - 1);
      if (!READ.test(body)) continue;
      issues.push({
        file,
        line: lineOf(content, m.index),
        message:
          "This reads the chain or saved data inside a useEffect or timer, so the value won't update after a transaction or a save, and other visitors' changes need a reload. Read it with useRead (src/lib/hooks.ts) or useCollection (src/lib/useDb.ts): they refresh by themselves.",
        source: "live",
      });
      break; // One note per file is enough to fix the pattern.
    }
    const reload = RELOAD.exec(content);
    if (reload) {
      issues.push({
        file,
        line: lineOf(content, reload.index),
        message: "Don't reload the page to show new values: useRead and useCollection already fetch again after transactions and saved-data writes. Remove the reload.",
        source: "live",
      });
    }
  }

  // A page that shows live values needs one way to "check now", in each card or section that shows them.
  const usesLive = appFiles.find(([, content]) => LIVE_HOOK.test(content));
  const hasButton = appFiles.some(([, content]) => /<RefreshButton\b/.test(content));
  if (usesLive && !hasButton) {
    const [file, content] = usesLive;
    issues.push({
      file,
      line: lineOf(content, LIVE_HOOK.exec(content)!.index),
      message:
        'This app shows values that change but has no refresh button. Put <RefreshButton read={...} /> (src/components/ui/refresh-button.tsx) in the header of each card or section that shows live values (one per card, not one per number), or <RefreshButton /> once in the page header.',
      source: "live",
    });
  }
  return issues;
}
