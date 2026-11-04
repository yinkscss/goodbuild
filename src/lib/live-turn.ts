import type { Step, TurnEvent, TurnMode, TurnRecord } from "./turn-types";

/** The in-progress turn the chat renders while events stream in. */
export interface LiveTurn {
  messageId: string | null;
  mode: TurnMode;
  text: string;
  record: TurnRecord;
  phase: "running" | "done" | "error" | "busy";
  /** Final files snapshot from the turn, for the preview. */
  files?: Record<string, string>;
}

export function emptyTurn(mode: TurnMode): LiveTurn {
  return {
    messageId: null,
    mode,
    text: "",
    phase: "running",
    record: { kind: "turn", mode, steps: [], log: [], changes: [], chargedMicro: 0, status: "answered" },
  };
}

function upsertStep(steps: Step[], step: Step): Step[] {
  const i = steps.findIndex((s) => s.id === step.id);
  if (i === -1) return [...steps, step];
  const next = steps.slice();
  next[i] = step;
  return next;
}

/** Apply one streamed event. Pure, so the same reducer works for tests and the UI. */
export function applyTurnEvent(turn: LiveTurn, e: TurnEvent): LiveTurn {
  const r = turn.record;
  switch (e.type) {
    case "start":
      return { ...turn, messageId: e.messageId, mode: e.mode, record: { ...r, mode: e.mode } };
    case "text":
      return { ...turn, text: turn.text + e.delta };
    case "plan":
      return { ...turn, record: { ...r, plan: { summary: e.summary, steps: e.steps } } };
    case "step":
      return { ...turn, record: { ...r, steps: upsertStep(r.steps, e.step) } };
    case "log":
      return { ...turn, record: { ...r, log: [...r.log, e.line] } };
    case "file": {
      const others = r.changes.filter((c) => c.path !== e.change.path);
      return { ...turn, record: { ...r, changes: [...others, e.change] } };
    }
    case "files":
      return { ...turn, files: e.files };
    case "version":
      return { ...turn, record: { ...r, version: e.number } };
    case "usage":
      return { ...turn, record: { ...r, chargedMicro: e.totalChargedMicro } };
    case "done":
      return { ...turn, phase: "done", record: { ...r, status: e.status } };
    case "error":
      return { ...turn, phase: "error", record: { ...r, status: "error", error: e.message } };
    case "busy":
      return { ...turn, phase: "busy" };
    default:
      return turn;
  }
}
