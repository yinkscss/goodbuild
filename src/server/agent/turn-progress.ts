import type { Db } from "@/server/db/client";
import type { FundingSource } from "@/server/db/schema";
import type { TurnRecord } from "@/lib/turn-types";
import type { ContractCheckOptions } from "./checks";
import type { ChatMessage, ToolCall } from "./model";

/**
 * Resumable turns (P18, user decision: option C). A turn saves what setup produced once, then
 * commits every completed model response together with its usage rows. A run that resumes
 * after a crash rebuilds the setup, replays the logged responses through the same loop (tools
 * and checks are deterministic, so they are simply re-run) and only then calls the model again.
 * No tool call is repeated against the model and no usage is billed twice.
 */

export const TURN_SETUP_VERSION = 1;

/** A user message part as saved: images are referenced by asset id, never stored as base64. */
export type SavedPart = { type: "text"; text: string } | { type: "asset-image"; assetId: string };
export type SavedMessage = Exclude<ChatMessage, { role: "user" }> | { role: "user"; content: string | SavedPart[]; cache?: boolean };

export interface TurnSetup {
  v: number;
  assistantId: string;
  userMessageId: string;
  request: string;
  firstBuild: boolean;
  /** This turn asks the plan-first questions (D32): one small call, no files, no edits. */
  intake?: boolean;
  /** The curated palette kept in public/index.html on this first build (D32). */
  paletteId?: string;
  /** They described their own colours: keep text readable after the model picks them (D32). */
  customColours?: boolean;
  /** Project status before the turn ("building" while it runs). */
  priorStatus: string;
  assetNames: string[];
  contractOptions: ContractCheckOptions;
  /** The project's files when the turn started (starter helpers and the assets module included). */
  baseFiles: Record<string, string>;
  /** The conversation up to and including the context message (the system prompt is rebuilt). */
  prefix: SavedMessage[];
  /** Design references attached as images to this turn (marked attached only when it commits). */
  imageAssetIds: string[];
  /** The record after setup (start-of-turn log lines). */
  recordAtStart: TurnRecord;
  text: string;
}

export interface LoggedUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  callId: string;
  chargedMicro: number;
}

/** One completed model response, exactly as the loop consumed it. */
export interface LoggedCall {
  /**
   * Where in the loop the call was made: its tier and the conversation length before it. A
   * replay that reaches a call with different values has diverged (the code or a check
   * result changed between attempts) and must not feed this response to the wrong step.
   */
  tier: string;
  convoLen: number;
  deltas: string[];
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage: LoggedUsage[];
}

/** Thrown when this worker no longer holds the job (its lease expired and another took it). */
export class LeaseLostError extends Error {
  constructor() {
    super("This worker lost the job's lease.");
    this.name = "LeaseLostError";
  }
}

/** Thrown at a safe point after a stop was requested. */
export class TurnStoppedError extends Error {
  constructor() {
    super("Stopped.");
    this.name = "TurnStoppedError";
  }
}

/** Saved progress was unusable (format changed, files missing): the job ends with Retry. */
export class ResumeFailedError extends Error {}

/**
 * What the runner needs from the job system. The direct implementation (no job: tests, demo)
 * commits plainly and saves nothing; the worker's version fences every commit on its lease.
 */
export interface TurnJobContext {
  /** True when the caller holds the project's turn lock (the job lease). */
  lockHeld: boolean;
  /** Who funds the job, fixed when it was created (D48). Without a job, the runner decides it. */
  funding?: FundingSource;
  signal?: AbortSignal;
  /** An earlier attempt of this job got this far. */
  resume?: { assistantMessageId?: string | null; setup?: TurnSetup | null; calls: LoggedCall[]; attempt: number };
  /** Run fn in one transaction that also proves this worker still holds the job. */
  commit<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  setAssistant(tx: Db, id: string): Promise<void>;
  saveSetup(tx: Db, setup: TurnSetup): Promise<void>;
  saveCall(tx: Db, idx: number, call: LoggedCall): Promise<void>;
  /** Inside the final commit: the job's end state. */
  complete(tx: Db, status: "done" | "error" | "stopped", error?: string): Promise<void>;
}

export function directJob(db: Db): TurnJobContext {
  return {
    lockHeld: false,
    commit: (fn) => db.transaction((tx) => fn(tx as unknown as Db)),
    setAssistant: async () => undefined,
    saveSetup: async () => undefined,
    saveCall: async () => undefined,
    complete: async () => undefined,
  };
}
