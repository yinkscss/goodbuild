/**
 * Agent turn events and the record stored on each assistant message. Shared by the
 * server runner and the workspace UI (which replays the same events from the stream).
 */
export interface FileChange {
  path: string;
  op: "create" | "edit" | "delete" | "rename";
  added: number;
  removed: number;
  diff: string;
  from?: string;
}

export type TurnMode = "build" | "plan";

export interface Step {
  id: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "error";
}

export type TurnEvent =
  | { type: "start"; messageId: string; mode: TurnMode }
  | { type: "text"; delta: string }
  /** Replace the turn's text (used to drop a reply that repeated an earlier one). */
  | { type: "text_set"; text: string }
  | { type: "plan"; summary: string; steps: string[] }
  | { type: "step"; step: Step }
  | { type: "log"; line: string }
  | { type: "file"; change: FileChange }
  | { type: "files"; files: Record<string, string> }
  | { type: "version"; number: number }
  | { type: "usage"; chargedMicro: number; totalChargedMicro: number }
  | { type: "done"; status: "ready" | "needs_fix" | "answered"; summary: string }
  | { type: "error"; message: string }
  /** Sent instead of a turn when one is already running for the project. */
  | { type: "busy" };

/** What an assistant message stores in `meta`, so the chat re-renders exactly after reload. */
export interface TurnRecord {
  kind: "turn";
  mode: TurnMode;
  plan?: { summary: string; steps: string[] };
  steps: Step[];
  log: string[];
  changes: FileChange[];
  version?: number;
  chargedMicro: number;
  status: "ready" | "needs_fix" | "answered" | "error";
  checks?: { errors: number; warnings: number };
  contracts?: Array<{ name: string; file: string; bytecodeBytes: number }>;
  error?: string;
}

