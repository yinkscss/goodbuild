import { AUTO_FIX_LEAD, CONTINUE_PROMPT, FIX_PROMPT, PREVIEW_ERROR_LEAD } from "./preview-errors";
import { SKIP_PLAN_TEXT, START_BUILDING_TEXT } from "./plan";

/**
 * What a canned button asks for (D173). The client sends the id with the button's text, so the server routes on
 * the id and never asks Jev to read button words ("Start building") or a pasted error as a fresh request.
 * - start_building / skip_questions: build the goal the person already described.
 * - repair: fix what a check reported (a crash, visual problems, a stopped deploy, errors left by the last build).
 * - resume: carry on a build that paused (for credits), from its saved files.
 * - add_saved_data: the backend card's request for saved data and wallet sign-in.
 */
export const TURN_ACTIONS = ["start_building", "skip_questions", "repair", "resume", "add_saved_data"] as const;
export type TurnAction = (typeof TURN_ACTIONS)[number];

export const VISUAL_FIX_LEAD = "Fix these visual problems the preview check found";
export const REVIEW_FIX_LEAD = "Fix these problems you saw when you looked at the page";
export const DEPLOY_STOPPED_LEAD = "The deploy to Celo was stopped";
export const SAVED_DATA_LEAD = "Add saved data to this app (GoodBuild's built-in backend";

/** Repairs and resumes keep the milestone they're in: an error that mentions a contract must not start one. */
export function keepsScope(action: TurnAction | undefined): boolean {
  return action === "repair" || action === "resume";
}

/**
 * Old clients send no id: recognise the exact texts this app's own buttons write (the constants above, not
 * keyword lists). Anything else is the person's own words.
 */
export function actionFromText(text: string | undefined): TurnAction | undefined {
  const t = text?.trim() ?? "";
  if (!t) return undefined;
  if (t === START_BUILDING_TEXT) return "start_building";
  if (t === SKIP_PLAN_TEXT) return "skip_questions";
  if (t === CONTINUE_PROMPT) return "resume";
  if (t === FIX_PROMPT || t.startsWith(FIX_PROMPT) || t.startsWith(AUTO_FIX_LEAD) || t.startsWith(PREVIEW_ERROR_LEAD) || t.startsWith(VISUAL_FIX_LEAD) || t.startsWith(REVIEW_FIX_LEAD) || t.startsWith(DEPLOY_STOPPED_LEAD)) return "repair";
  if (t.startsWith(SAVED_DATA_LEAD)) return "add_saved_data";
  return undefined;
}
