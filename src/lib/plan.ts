import { paletteById } from "./palettes";
import type { PlanAnswer, PlanIntake, PlanQuestion } from "./turn-types";

/** How many words of "Other" one answer may carry. */
export const PLAN_OTHER_MAX = 300;

export const START_BUILDING_TEXT = "Start building";
export const SKIP_PLAN_TEXT = "Skip the questions, just build it";

/** The next question to ask, or questions.length when all are answered (show the summary). */
export function nextQuestion(intake: PlanIntake): number {
  const i = intake.questions.findIndex((q) => !intake.answers[q.id]);
  return i === -1 ? intake.questions.length : i;
}

/** An answer in the person's words: the labels they picked, then their own text. */
export function answerText(question: PlanQuestion, answer: PlanAnswer): string {
  const picks = answer.picks.map((id) => {
    if (question.kind === "palette") return paletteById(id)?.name ?? id;
    return question.options.find((o) => o.id === id)?.label ?? id;
  });
  return [...picks, ...(answer.other ? [answer.other] : [])].join(", ");
}

/** An answer as saved: only offered options, one pick unless the question allows more, trimmed text. */
export function cleanAnswer(question: PlanQuestion, answer: PlanAnswer): PlanAnswer | null {
  const offered = new Set(question.options.map((o) => o.id));
  const picks = [...new Set(answer.picks)].filter((id) => offered.has(id));
  const other = answer.other?.replace(/\s+/g, " ").trim().slice(0, PLAN_OTHER_MAX);
  const kept = question.multiple ? picks : other ? [] : picks.slice(0, 1);
  if (!kept.length && !other) return null;
  return { picks: kept, ...(other ? { other } : {}) };
}
