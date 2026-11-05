/** A runtime or compile error the Sandpack preview reported. */
export interface PreviewError {
  title: string;
  message: string;
  path?: string;
  line?: number;
}

/** Marks prompts GoodBuild sent by itself, so an auto-fix never triggers another one. */
export const AUTO_FIX_LEAD = "Automatic check:";

/** Bundler, CDN and network hiccups: not the app's fault, so never auto-fixed. */
export function isInfraError(e: Pick<PreviewError, "title" | "message">): boolean {
  return /timed? ?out|TIME_OUT|Failed to fetch|NetworkError|Could not fetch|ERR_CONNECTION|ECONN|Couldn't connect|dependency.*(fetch|download)|npm registry/i.test(`${e.title} ${e.message}`);
}

/** The prompt that asks the agent to fix a preview error (by the user's button, or automatically). */
export function previewFixPrompt(e: PreviewError, automatic: boolean): string {
  const where = e.path ? ` in ${e.path.replace(/^\//, "")}${e.line ? `:${e.line}` : ""}` : "";
  const lead = automatic ? `${AUTO_FIX_LEAD} the preview showed this error${where} right after the last build. Fix it:` : `The preview shows this error${where}. Fix it:`;
  return `${lead}\n${e.title}\n${e.message}`.slice(0, 3000);
}

/**
 * Auto-fix policy (P17): only for the version the last turn in this browser just built, only
 * once per version, never for a version an auto-fix built, never for infrastructure errors.
 */
export function shouldAutoFix(args: { error: PreviewError; version: number; eligibleVersion: number | null; running: boolean }): boolean {
  return !args.running && args.eligibleVersion !== null && args.eligibleVersion === args.version && !isInfraError(args.error);
}

/** What "Try fix" sends after a build with errors left. */
export const FIX_PROMPT = "Fix the remaining errors from the last build.";
