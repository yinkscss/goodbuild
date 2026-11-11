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

/** One answer choice on a plan question. For a palette question the id is the palette's id. */
export interface PlanOption {
  id: string;
  label: string;
  detail?: string;
  recommended?: boolean;
}

export interface PlanQuestion {
  id: string;
  kind: "choice" | "palette";
  question: string;
  /** One to three words, for the summary list. */
  label: string;
  /** Several options can apply together. */
  multiple: boolean;
  options: PlanOption[];
}

export interface PlanAnswer {
  /** Ids of the options picked. */
  picks: string[];
  /** Their own words, from "Other". */
  other?: string;
}

/** The plan-first questions (D32), stored on the turn that asked them, with answers as they come. */
/** A game's pitch from the planner (D90), shown with the plan and given to the builder as the spec. */
export interface GameBrief {
  name: string;
  pitch: string;
  /** What you do over and over: "dodge, collect, survive". */
  loop: string;
  lose: string;
  harder: string;
  extras: string[];
}

export interface PlanIntake {
  summary: string;
  questions: PlanQuestion[];
  answers: Record<string, PlanAnswer>;
  /** A game: the planner's pitch for it. */
  game?: GameBrief;
  /** A game whose request already asked for a leaderboard, so the card wasn't shown. */
  leaderboard?: boolean;
}

export type TurnEvent =
  | { type: "start"; messageId: string; mode: TurnMode }
  | { type: "text"; delta: string }
  /** Replace the turn's text (used to drop a reply that repeated an earlier one). */
  | { type: "text_set"; text: string }
  | { type: "plan"; summary: string; steps: string[] }
  /** Next steps the user can click (Lovable-style chips), from the suggest_next tool. */
  | { type: "suggestions"; items: string[] }
  /** Plan-first questions for the person to answer; the turn ends after this (D32). */
  | { type: "questions"; intake: PlanIntake }
  | { type: "step"; step: Step }
  | { type: "log"; line: string }
  | { type: "file"; change: FileChange }
  | { type: "files"; files: Record<string, string> }
  | { type: "version"; number: number }
  | {
      type: "usage";
      chargedMicro: number;
      totalChargedMicro: number;
      /** Per-call detail, for evals and cost debugging. */
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
    }
  | { type: "done"; status: "ready" | "needs_fix" | "answered" | "stopped"; summary: string }
  /** After a resumed run replays its saved progress: the turn so far, replacing what the client had (P18). */
  | { type: "snapshot"; text: string; record: TurnRecord }
  /** The job is waiting in the queue behind another turn (P18). */
  | { type: "queued"; position: number }
  | { type: "error"; message: string }
  /** Sent instead of a turn when one is already running for the project. */
  | { type: "busy" };

/** What an assistant message stores in `meta`, so the chat re-renders exactly after reload. */
export interface TurnRecord {
  kind: "turn";
  mode: TurnMode;
  plan?: { summary: string; steps: string[] };
  /** Clickable next steps shown under the reply. */
  suggestions?: string[];
  /** Plan-first questions and their answers (D32). */
  intake?: PlanIntake;
  steps: Step[];
  log: string[];
  changes: FileChange[];
  version?: number;
  chargedMicro: number;
  status: "ready" | "needs_fix" | "answered" | "error" | "stopped";
  checks?: { errors: number; warnings: number };
  contracts?: Array<{ name: string; file: string; bytecodeBytes: number }>;
  error?: string;
  /** Screenshot review of the preview right after this build (P17 visual check). */
  visualCheck?: VisualCheck;
  /** The builder's own look at the page on the server (D87). When it is here, the browser's visual check isn't run. */
  review?: PageReview;
}

export interface PageReview {
  /** Nothing needed fixing. */
  ok: boolean;
  /** What it saw, at most five. */
  issues: string[];
  /** The builder fixed them and the checks still pass. False: the page is as it was, and the person can ask. */
  fixed: boolean;
}

export interface VisualCheck {
  ok: boolean;
  /** Concrete visible defects, at most four. */
  issues: string[];
  /** Preview width the screenshot was taken at. */
  width: number;
  chargedMicro: number;
}

