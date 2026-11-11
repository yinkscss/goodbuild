import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { templateBriefFor } from "@/config/page-template-data";
import type { Db } from "@/server/db/client";
import { messages, projects } from "@/server/db/schema";
import { checkApp, checkContracts, formatIssues, mentionsGd, mentionsNativeCelo, type CheckIssue, type CheckReport, type ContractCheckOptions } from "./checks";
import { runContractTests } from "./contract-tests";
import { createHash } from "node:crypto";

import { detectKits, kitById, kitGuideName, kitsOf, withKit, withKitHelpers } from "./kits";
import { parseReview, reviewEnabled, reviewFixMessage, reviewPrompt, REVIEW_MAX_TOKENS, worthReviewing } from "./review";
import { runCheck, runCheckEnabled } from "./run-check";
import { typeCheck, typeCheckMode, type TypeCheckMode } from "./type-check";
import { dbAssetStore, type AssetStore } from "./asset-store";
import { ASSETS_MODULE, assetManifest, assetsModule, reviewImage, visionImage } from "./assets";
import { HISTORY_WINDOW, memoryBlock, updateMemory, type Memory, type MemoryMessage } from "./memory";
import { MODEL_IDS, TIER_FOR, ModelUnavailableError, type ChatMessage, type ModelClient, type ModelEvent, type ModelTier, type ToolCall, type UserPart } from "./model";
import { INTAKE_MAX_TOKENS, INTAKE_PROMPT, INTAKE_TOOLS, fallbackIntake, intakeContext, latestIntake, parseIntake, planBrief } from "./plan-intake";
import { BUILD_TOOLS, PLAN_TOOLS, contextWithPicks, systemPrompt } from "./prompt";
import { checkpoint, claimTurn, loadFiles, recordUsage, releaseTurn } from "./store";
import { decideFunding } from "@/server/credits/cap";
import { OutOfCreditsError, ensureHold, worstCaseCallMicro } from "@/server/credits/holds";
import { deploymentsBlock, loadDeployedAddresses } from "@/server/deploy/addresses";
import { isUpgradeableProject, liveStorage, upgradeChecksFor } from "@/server/deploy/upgradeable";
import { upgradeableRules } from "./upgradeable-rules";
import { PLATFORM_DIR, contractModule, contractsIndex, isStarterApp, starterFiles, withStarterHelpers } from "./template";
import {
  LeaseLostError,
  ResumeFailedError,
  TURN_SETUP_VERSION,
  TurnStoppedError,
  directJob,
  type LoggedUsage,
  type SavedMessage,
  type TurnJobContext,
  type TurnSetup,
} from "./turn-progress";
import { Workspace, type FileChange } from "./workspace";

import { applyPalette, ensureReadable, paletteById } from "@/lib/palettes";
import type { Step, TurnEvent, TurnMode, TurnRecord } from "@/lib/turn-types";

export type { Step, TurnEvent, TurnMode, TurnRecord };

export interface TurnDeps {
  db: Db;
  model: ModelClient;
  checkContracts?: typeof checkContracts;
  checkApp?: typeof checkApp;
  /** Opens the built app in a headless browser (D67). Default: the real one where the server turns it on, otherwise none. */
  runCheck?: typeof runCheck;
  /** TypeScript over the app (D68). Default: the real one in the mode the server sets (TYPE_CHECK), otherwise none. */
  typeCheck?: typeof typeCheck;
  /** "warn" notes type errors, "enforce" sends them to auto-fix. Default: TYPE_CHECK. */
  typeCheckMode?: TypeCheckMode;
  /** The builder looks at screenshots of the finished page and fixes what it sees (D87). Default: VISUAL_REVIEW. Needs the run check. */
  review?: boolean;
  /** Uploaded assets (default: the DB store). */
  assets?: AssetStore;
  /** The background job running this turn (P18). Without one the turn runs directly (tests). */
  job?: TurnJobContext;
  now?: () => Date;
}

/** Design-reference images sent with one turn (each is described in text for later turns). */
const MAX_IMAGES_PER_TURN = 2;

export interface TurnInput {
  projectId: string;
  userId: string;
  mode: TurnMode;
  /** The user message to answer (queued by POST /turns or the landing page). */
  userMessageId?: string;
  /** Or a new prompt (direct runs: tests, scripts). */
  prompt?: string;
  /** Direct runs: ask the plan-first questions. Queued turns carry this on their message (D32). */
  intake?: boolean;
}

/** Fix attempts per build. Later attempts only run while errors keep dropping (see fixProgress) and the fix spend stays under FIX_BUDGET_MICRO. */
export const MAX_FIX_ATTEMPTS = 5;
/** The most the auto-fix loop may charge on one build (micro-USD, what the person pays), so a hard failure can't run up the bill. */
export const FIX_BUDGET_MICRO = 300_000;
/** Stop after this many attempts in a row that didn't bring the error count below its best so far. */
const MAX_STALLED_ATTEMPTS = 2;
/**
 * Model calls in one build, and tool rounds in one pass (D82). A game with a contract, its tests and a kit's
 * files (live check, entry-fee game) used the old 30 and 16 before it could finish fixing a compile error, and
 * money contracts now need exploit tests too. What bounds the cost is not these counts: a paid build checks its
 * hold before every call (D49), and a free or exempt build stops at FREE_BUILD_CEILING_MICRO.
 */
const MAX_CALLS = 50;
const MAX_TOOL_ROUNDS_PER_PHASE = 20;
/**
 * The most one build on free AI (or an exempt wallet) may charge before it stops (D82). Free allowance is only
 * checked when a build starts, so without this a long build could run well past it. About three times the
 * dearest build seen (RESERVED_PER_BUILD_MICRO) and the same as a paid build's hold. When it is reached the
 * build stops working, writes its reply and saves what it made (no more fix attempts). A hard stop at twice the
 * ceiling catches any call that slips past. Change it with FREE_BUILD_CEILING_MICRO in the environment.
 */
export const FREE_BUILD_CEILING_MICRO = 1_000_000;

export function freeBuildCeilingMicro(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.FREE_BUILD_CEILING_MICRO);
  return Number.isSafeInteger(value) && value > 0 ? value : FREE_BUILD_CEILING_MICRO;
}
/** How often the builder may ask for the checks in one turn (the run_checks tool, D68). Each costs seconds of server time. */
export const MAX_TOOL_CHECKS = 3;
const MAX_TOKENS = 16_000;

export class TurnBusyError extends Error {
  constructor() {
    super("A build is already running for this project.");
  }
}

/**
 * One agent turn (AI_AGENT.md §2): plan, tool edits, checks with up to 3 auto-fix
 * attempts, one checkpoint. Streams events as it goes and persists the chat, files, version
 * and usage. Never throws after the turn starts (except when its job lease is lost): failures
 * end as an error record the user can retry.
 *
 * Resumable (P18): setup is saved once, every model response is committed with its usage, and
 * a resumed run replays those responses (emitting nothing) before going live again with a
 * `snapshot` event. Stop is checked between rounds, before compiling and before tests.
 */
export async function runTurn(deps: TurnDeps, input: TurnInput, emit: (e: TurnEvent) => void): Promise<TurnRecord> {
  const { db } = deps;
  const job = deps.job ?? directJob(db);
  const model = checkedAgainstHold(deps.model, job);
  const compileWith = deps.checkContracts ?? checkContracts;
  // The saved turn setup only says "upgradeable" (it has to stay JSON); the checks are wired here.
  const compile: typeof checkContracts = (files, options = {}) => compileWith(files, options.upgradeable ? { ...options, upgradeChecks: upgradeChecksFor(db, input.projectId) } : options);
  const lintWith = deps.checkApp ?? checkApp;
  let assetNames: string[] = [];
  const lint = (files: Record<string, string>) => lintWith(files, { assets: assetNames });
  const openWith = deps.runCheck ?? (runCheckEnabled() ? runCheck : undefined);
  let chainId: number | undefined;
  const open = openWith ? (files: Record<string, string>) => openWith(files, { assets: assetNames, chainId }) : undefined;
  const reviewOn = (deps.review ?? reviewEnabled()) && Boolean(openWith);
  const typesMode = deps.typeCheckMode ?? (deps.typeCheck ? "enforce" : typeCheckMode());
  const types = typesMode === "off" ? undefined : { run: deps.typeCheck ?? typeCheck, enforce: typesMode === "enforce" };

  if (!job.lockHeld && !(await claimTurn(db, input.projectId, input.userId))) throw new TurnBusyError();
  // Every usage row of the turn takes the job's funding (D48).
  const funding = job.funding ?? (await decideFunding(db, input.userId));
  // A build on free AI or an exempt wallet stops working at this much (D82); paid builds are checked per call (D49).
  const ceilingMicro = freeBuildCeilingMicro();
  let ceilingNoted = false;
  const atFreeCeiling = () => {
    if (funding === "paid" || record.chargedMicro < ceilingMicro) return false;
    if (!ceilingNoted) log("! this build reached the most one build may spend on free AI; stopping and saving what it made");
    ceilingNoted = true;
    return true;
  };

  const saved = job.resume?.setup ?? null;
  const replayLog = saved ? (job.resume?.calls ?? []) : [];
  // While replaying logged responses nothing is emitted: the client gets one snapshot after.
  let replaying = replayLog.length > 0;
  const out = (e: TurnEvent) => {
    if (!replaying) emit(e);
  };

  const record: TurnRecord = { kind: "turn", mode: input.mode, steps: [], log: [], changes: [], chargedMicro: 0, status: "error" };
  let assistantId = "";
  let finalStatus = "draft";
  let text = "";
  const stopIfRequested = () => {
    if (job.signal?.aborted) throw new TurnStoppedError();
  };

  const step = (s: Step) => {
    const i = record.steps.findIndex((x) => x.id === s.id);
    if (i >= 0) record.steps[i] = s;
    else record.steps.push(s);
    out({ type: "step", step: s });
  };
  const log = (line: string) => {
    record.log.push(line);
    out({ type: "log", line });
  };

  let images: UserPart[] = [];
  try {
    // ---- Setup: done once; a resumed run restores it instead (memory call and all) ----
    let setup: TurnSetup;
    if (saved) {
      // Known before validating, so an unusable save still ends on the right message with Retry.
      assistantId = saved.assistantId || job.resume?.assistantMessageId || "";
      finalStatus = saved.priorStatus || "draft";
      if (saved.v !== TURN_SETUP_VERSION || !saved.assistantId || !saved.baseFiles) throw new ResumeFailedError("the saved progress is from an older version of GoodBuild.");
      setup = saved;
      Object.assign(record, structuredClone(setup.recordAtStart));
      text = setup.text;
      emit({ type: "start", messageId: assistantId, mode: input.mode });
      images = await loadImages(deps.assets ?? dbAssetStore(db), input.projectId, setup.imageAssetIds);
      if (images.length !== setup.imageAssetIds.length) throw new ResumeFailedError("a design reference this build used was deleted.");
    } else {
      setup = await runSetup();
    }
    assetNames = setup.assetNames;
    chainId = setup.chainId;
    const ws = new Workspace(setup.baseFiles);
    const firstBuild = setup.firstBuild;
    const contractOptions = setup.contractOptions;
    if (saved) log(`↻ resumed after an interruption (attempt ${job.resume?.attempt ?? 2}), replaying ${replayLog.length} saved ${replayLog.length === 1 ? "response" : "responses"}`);

    const intake = setup.intake === true;
    const convo: ChatMessage[] = [{ role: "system", content: intake ? INTAKE_PROMPT : systemPrompt(input.mode) }, ...rehydrate(setup.prefix, images)];
    const tools = intake ? INTAKE_TOOLS : input.mode === "plan" ? PLAN_TOOLS : BUILD_TOOLS;

    let calls = 0;
    let callIdx = 0;
    const replies: string[] = [];
    // Set by each model call: the response stopped at the output-token limit, so any tool
    // call it was writing (usually a big create_file) was lost.
    let cutOff = false;
    let cutAtLimit = false;

    /** Replay is over: tell the client the turn's state so far, then stream live again. */
    const goLive = () => {
      if (!replaying) return;
      replaying = false;
      emit({ type: "snapshot", text, record: structuredClone(record) });
    };

    // quiet: a fix pass. Its text goes to the model's history but not to the user, so the
    // first pass's reply (and its follow-up questions) stays the last thing they read; the
    // auto-fix steps already show what happened.
    // side: a question of its own (the review's screenshots), not part of the build's conversation. It is
    // saved and replayed like any other call, so a resumed build doesn't ask or pay for it twice.
    let sideReply = "";
    const callModel = async (tier: ModelTier, quiet = false, wrapUp = false, side?: { messages: ChatMessage[]; maxTokens: number }) => {
      if (side) quiet = true;
      stopIfRequested();
      if (++calls > MAX_CALLS) throw new Error("This build used too many steps. Try a smaller change.");
      const idx = callIdx++;
      const logged = replayLog[idx];
      if (logged && (logged.tier !== tier || logged.convoLen !== convo.length)) {
        throw new ResumeFailedError("the saved progress no longer matches this build's steps.");
      }
      if (!logged) goLive();
      if (!logged && funding !== "paid" && record.chargedMicro >= 2 * ceilingMicro) {
        throw new Error("This build reached the most one build can spend on free AI. Try a smaller change, or ask for it in two steps.");
      }
      let replyText = "";
      const toolCalls: ToolCall[] = [];
      const textBefore = text;
      cutOff = false;
      cutAtLimit = false;
      const onText = (d: string) => {
        if (quiet) {
          replyText += d;
          return;
        }
        // Separate replies from different calls with a blank line.
        const delta = !replyText && text && !text.endsWith("\n") ? `\n\n${d.replace(/^\s+/, "")}` : d;
        replyText += d;
        text += delta;
        out({ type: "text", delta });
      };
      const onDone = (finishReason: string | null) => {
        // "length": stopped at the output limit. "tool-calls" with no call that reached us:
        // the call was malformed or dropped on the way. Either way the work isn't done.
        cutAtLimit = finishReason === "length";
        cutOff = cutAtLimit || (/^tool[-_]calls$/.test(finishReason ?? "") && toolCalls.length === 0);
      };
      const addUsage = (u: LoggedUsage) => {
        record.chargedMicro += u.chargedMicro;
        out({ type: "usage", chargedMicro: u.chargedMicro, totalChargedMicro: record.chargedMicro, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cachedInputTokens: u.cachedInputTokens });
      };

      if (logged) {
        for (const d of logged.deltas) onText(d);
        toolCalls.push(...logged.toolCalls);
        onDone(logged.finishReason);
        for (const u of logged.usage) addUsage(u);
      } else {
        const deltas: string[] = [];
        const convoLen = convo.length;
        let finishReason: string | null = null;
        let usage: Array<Extract<ModelEvent, { type: "usage" }>> = [];
        // One retry when the provider fails mid-response (e.g. the SDK couldn't parse a chunk):
        // nothing from the failed attempt has been executed, so drop its partial text and calls.
        for (let attempt = 0; ; attempt++) {
          try {
            const ask = side ? { tier, messages: side.messages, maxTokens: side.maxTokens } : { tier, messages: convo, tools, maxTokens: intake ? INTAKE_MAX_TOKENS : MAX_TOKENS, ...(intake ? { noThinking: true } : {}) };
            for await (const ev of model.stream({ ...ask, signal: job.signal })) {
              if (ev.type === "text") {
                deltas.push(ev.delta);
                onText(ev.delta);
              } else if (ev.type === "tool_call") {
                toolCalls.push(ev.call);
              } else if (ev.type === "done") {
                finishReason = ev.finishReason;
                onDone(ev.finishReason);
              } else if (ev.type === "usage") {
                usage.push(ev);
              }
            }
            break;
          } catch (error) {
            stopIfRequested();
            if (attempt >= 1 || !(error instanceof ModelUnavailableError)) throw error;
            log("! the AI provider failed mid-response; retrying once");
            replyText = "";
            deltas.length = 0;
            toolCalls.length = 0;
            usage = [];
            cutOff = false;
            cutAtLimit = false;
            if (!quiet && text !== textBefore) {
              text = textBefore;
              out({ type: "text_set", text });
            }
          }
        }
        // The response and its usage are committed together: after this, a crash replays the
        // response instead of asking (and paying) the model again. A crash before it re-asks,
        // and that unfinished call is not billed (P18; M6 should account for it).
        const priced = await job.commit(async (tx) => {
          const rows: LoggedUsage[] = [];
          for (const [n, ev] of usage.entries()) {
            const callId = ev.callId || `${assistantId}:${idx}:${n}`;
            const cost = await recordUsage(tx, {
              userId: input.userId,
              projectId: input.projectId,
              messageId: assistantId,
              callId,
              model: ev.model,
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
              cachedInputTokens: ev.cachedInputTokens,
              funding,
              jobId: job.jobId,
            });
            rows.push({ model: ev.model, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, cachedInputTokens: ev.cachedInputTokens, callId, chargedMicro: cost.chargedMicro });
          }
          await job.saveCall(tx, idx, { tier, convoLen, deltas, toolCalls: [...toolCalls], finishReason, usage: rows });
          return rows;
        });
        for (const u of priced) addUsage(u);
      }
      if (side) {
        // Its answer goes to whoever asked, never into the build's conversation.
        sideReply = replyText;
        return toolCalls;
      }
      // A reply that repeats one already shown in this turn (models often restate the
      // summary after a fix) is dropped from what the user sees, live and saved.
      if (quiet) {
        // Nothing was shown.
      } else if (!wrapUp && input.mode === "build" && toolCalls.length && !onlySuggestions(toolCalls) && replyText.trim()) {
        // Narration before tool calls ("I'll start by planning this out.") isn't the reply;
        // the steps already show the work. Keep it in the model's history only.
        text = textBefore;
        out({ type: "text_set", text });
      } else if (replyText.trim() && isRepeat(replyText, replies)) {
        text = textBefore;
        out({ type: "text_set", text });
      } else if (replyText.trim()) {
        replies.push(replyText);
      }
      convo.push({
        role: "assistant",
        content: replyText || null,
        ...(toolCalls.length
          ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })) }
          : {}),
      });
      return toolCalls;
    };

    /** Record next-step chips from suggest_next. Fix passes (quiet) don't change them. */
    const takeSuggestions = (items: string[] | undefined, quiet: boolean) => {
      if (!items?.length || quiet) return;
      record.suggestions = items;
      out({ type: "suggestions", items });
    };

    /** Let the model work until it stops calling tools. False when it ran out of rounds. */
    const phase = async (tier: ModelTier, quiet = false) => {
      for (let round = 0; round < MAX_TOOL_ROUNDS_PER_PHASE; round++) {
        stopIfRequested();
        // Out of free spend: end the pass the way running out of rounds does, so the reply and the save still happen.
        if (atFreeCeiling()) return false;
        const toolCalls = await callModel(tier, quiet);
        if (cutOff) {
          // Not finished: the model was mid-write. Run whatever calls did complete, then
          // ask it to continue in smaller pieces (below), instead of ending the pass.
          log(cutAtLimit ? "! a response hit the output limit; asking for smaller files" : "! a response ended without a usable tool call; asking for smaller files");
        }
        if (!toolCalls.length && !cutOff) return true;
        // The final reply arrives with suggest_next: that ends the pass, no extra round.
        const final = onlySuggestions(toolCalls);
        for (const call of toolCalls) {
          // The model-call number keeps step ids unique even if a provider repeats a tool call
          // id across calls (replayed and live calls after a resume, say).
          const stepId = `tool:${calls}:${call.id}`;
          // Plan mode can't edit; a refused edit attempt isn't worth showing as a failed step.
          const label = input.mode === "plan" ? null : toolLabel(call);
          if (label) step({ id: stepId, label, status: "running" });
          if (call.name === "run_checks") {
            convo.push({ role: "tool", tool_call_id: call.id, content: await checkForTheBuilder() });
            continue;
          }
          const outcome = ws.execute(call.name, call.arguments, input.mode);
          if (outcome.guides?.length) log(`guides: ${outcome.guides.join(", ")}`);
          if (outcome.access) log(`· ${outcome.access}`);
          takeSuggestions(outcome.suggestions, quiet);
          if (outcome.plan) {
            record.plan = outcome.plan;
            out({ type: "plan", ...outcome.plan });
            step({ id: "plan", label: "Plan", detail: outcome.plan.summary || `${outcome.plan.steps.length} steps`, status: "done" });
          }
          if (outcome.change) {
            record.changes.push(outcome.change);
            out({ type: "file", change: outcome.change });
            log(`→ ${outcome.change.op === "delete" ? "deleted" : "wrote"} ${outcome.change.path}`);
          }
          if (label) {
            step({
              id: stepId,
              label,
              status: outcome.ok ? "done" : "error",
              detail: outcome.ok ? changeDetail(outcome.change) : outcome.result.replace(/^Error:\s*/, "").slice(0, 140),
            });
          }
          convo.push({ role: "tool", tool_call_id: call.id, content: outcome.result });
        }
        if (cutOff) {
          convo.push({
            role: "user",
            content:
              "Your last response hit the output limit and was cut off, so the file you were writing was lost. Continue the work in smaller pieces: one file per create_file call, under about 250 lines each (split big contracts and pages into several files or components), and keep going until everything is written.",
          });
          continue;
        }
        if (final) return true;
      }
      log("! stopped: too many tool rounds in one pass");
      return false;
    };

    // The person's colours stay, whatever the model wrote to the page (D32).
    const keepTheme = () => {
      const html = ws.files["public/index.html"];
      if (html === undefined) return;
      const palette = paletteById(setup.paletteId);
      if (palette) ws.files["public/index.html"] = applyPalette(html, palette);
      else if (setup.customColours) ws.files["public/index.html"] = ensureReadable(html);
    };

    /**
     * The run_checks tool (D68): the same checks GoodBuild runs at the end, on the files as they are
     * now, so the builder can fix its own mistakes while it still has the work in mind (and on the
     * build model, not the dearer fix model). The result is kept: if nothing changes afterwards, the
     * end of the turn uses it instead of checking the same files twice.
     */
    let toolChecks = 0;
    let checked: { key: string; report: CheckReport } | undefined;
    const checkForTheBuilder = async (): Promise<string> => {
      if (input.mode === "plan") return "Error: plan mode can't run the checks.";
      if (toolChecks >= MAX_TOOL_CHECKS) return `You have already run the checks ${MAX_TOOL_CHECKS} times this turn. Finish the work and reply; GoodBuild checks everything again when you're done.`;
      toolChecks++;
      keepTheme();
      log(`· run_checks (${toolChecks} of ${MAX_TOOL_CHECKS})`);
      const report = await runChecks(ws.files, compile, lint, step, log, `check${toolChecks}`, contractOptions, runContractTests, stopIfRequested, open, types);
      checked = { key: filesKey(ws.files), report };
      const found = [...report.errors, ...(report.notes ?? [])];
      if (!found.length) return "All checks pass. Don't run them again unless you edit more files.";
      return `${report.ok ? "Nothing blocks the build, but these are worth fixing" : "The checks found problems"}. Fix them with edit_file (read a file before editing it), then run_checks again if you changed more than a line or two:\n${formatIssues(found)}`;
    };
    /** The checks on the files as they are, or the builder's own last check if nothing changed since. */
    const checkNow = async (attempt: number | string): Promise<CheckReport> => {
      if (checked && checked.key === filesKey(ws.files)) {
        log("· checks: nothing changed since the builder's last check, using that result");
        return checked.report;
      }
      return runChecks(ws.files, compile, lint, step, log, attempt, contractOptions, runContractTests, stopIfRequested, open, types);
    };

    // Plan first (D32): one call and no tool rounds. The answers start the next turn, so nothing
    // waits on a job or a worker. An unusable reply gets fixed questions, not a paid second try.
    if (intake) {
      const replied = await callModel(TIER_FOR.plan);
      const asked = replied.find((c) => c.name === "ask_questions");
      const parsed = asked ? parseIntake(asked.arguments, setup.request) : null;
      // Plain words with no tool call are the model answering a question or refusing: leave those be.
      if (parsed || asked || cutOff || !text.trim()) {
        record.intake = parsed ?? fallbackIntake(setup.request);
        if (!text.trim()) {
          text = "A few quick questions so I build the right thing.";
          out({ type: "text_set", text });
        }
        out({ type: "questions", intake: record.intake });
      }
    }
    const finished = intake || (await phase(input.mode === "plan" ? TIER_FOR.plan : TIER_FOR.build));
    if (!finished || !text.trim()) {
      // Out of tool rounds, or the pass ended with nothing shown (its reply came with a tool
      // call and was dropped as narration): ask once for the reply, so the user gets a
      // summary and follow-ups instead of an empty message. Tools stay declared (some
      // providers require it once the history has tool calls) but any calls are not run.
      convo.push({ role: "user", content: "Stop editing: you've used all your tool steps for this pass. Reply to the user now, as instructed (suggest_next is the only tool you may still call)." });
      const extra = await callModel(input.mode === "plan" ? TIER_FOR.plan : TIER_FOR.build, false, true);
      for (const call of extra) {
        if (call.name === "suggest_next") {
          const outcome = ws.execute(call.name, call.arguments, input.mode);
          takeSuggestions(outcome.suggestions, false);
          convo.push({ role: "tool", tool_call_id: call.id, content: outcome.result });
        } else {
          convo.push({ role: "tool", tool_call_id: call.id, content: "Not run: no tool steps left in this pass." });
        }
      }
      if (!text.trim() && record.plan?.summary) {
        text = record.plan.summary;
        out({ type: "text_set", text });
      }
    }

    // The user's house style: no em dashes in what they read (the prompt asks too; models slip).
    const styled = plainDashes(text);
    if (styled !== text) {
      text = styled;
      out({ type: "text_set", text });
    }

    // Plan mode, or a build-mode question answered without touching files (not a first
    // build, which must still seed and check the starter): nothing to check or save.
    // A project whose page is still the starter sentence is not finished, so a build
    // turn runs the checks and the fix loop even when the model only replied.
    const unfinished = isStarterApp(ws.files["src/App.tsx"]);
    if (input.mode === "plan" || (!firstBuild && !ws.changed() && !unfinished)) {
      goLive();
      stopIfRequested();
      record.status = "answered";
      await job.commit(async (tx) => {
        await finish(tx, assistantId, text, record);
        await markImagesAttached(tx, setup);
        if (job.lockHeld) await releaseTurn(tx, input.projectId, finalStatus);
        await job.complete(tx, "done");
      });
      emit({ type: "done", status: "answered", summary: text.trim() });
      return record;
    }

    keepTheme();
    // The preview has shown the starter page since the turn began. Hand it what was written
    // before the checks and auto-fix, which can take minutes. A copy, so later edits don't
    // change this event while it waits to be saved. The checkpoint emit below still follows.
    emit({ type: "files", files: { ...ws.files } });
    // Checks and auto-fix (up to MAX_FIX_ATTEMPTS). Stops on the same errors twice, on two attempts in a row without progress, or at the fix budget.
    let report = await checkNow(0);
    let previous = "";
    const initialErrors = report.errors.length;
    let attemptsUsed = 0;
    let stoppedEarly = false;
    let stopNote = "";
    const fixStartMicro = record.chargedMicro;
    let progress = { best: report.errors.length, stalls: 0 };
    for (let attempt = 1; !report.ok && attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      const issues = formatIssues(report.errors);
      if (issues === previous) {
        log("! the same errors came back after a fix, stopping");
        stoppedEarly = true;
        break;
      }
      if (record.chargedMicro - fixStartMicro >= FIX_BUDGET_MICRO) {
        log("! the fix budget for this build is used up, stopping");
        stoppedEarly = true;
        stopNote = "the fix budget for one build was used up";
        break;
      }
      if (atFreeCeiling()) {
        stoppedEarly = true;
        stopNote = "this build reached the most one build may spend on free AI";
        break;
      }
      previous = issues;
      attemptsUsed = attempt;
      step({ id: `fix:${attempt}`, label: `Fixing errors (attempt ${attempt} of ${MAX_FIX_ATTEMPTS})`, detail: `${plural(report.errors.length, "error")} to fix: ${firstIssue(report.errors)}`, status: "running" });
      convo.push({
        role: "user",
        content: `GoodBuild's checks failed. Fix these errors with edit_file. A [runtime] error is what happened when GoodBuild opened the built app in a browser, and a [types] error is TypeScript's: read the named file before changing it. If a contract test fails, decide whether the contract or the test is wrong: fix the contract when it misbehaves; change a test only when its expectation is mistaken, and never delete or weaken a check just to make it pass. Then stop with a very short note (the user sees the fix steps, not this note):\n${issues}`,
      });
      await phase(fixTier(attempt, report.errors), true);
      report = await checkNow(attempt);
      step({
        id: `fix:${attempt}`,
        label: `Fixing errors (attempt ${attempt} of ${MAX_FIX_ATTEMPTS})`,
        detail: report.ok ? "all checks pass" : `${plural(report.errors.length, "error")} left: ${firstIssue(report.errors)}`,
        status: report.ok ? "done" : "error",
      });
      progress = fixProgress(progress.best, progress.stalls, report.errors.length);
      if (!report.ok && progress.stalls >= MAX_STALLED_ATTEMPTS) {
        log("! two fix attempts in a row made no progress, stopping");
        stoppedEarly = true;
        stopNote = "two attempts in a row made no progress";
        break;
      }
    }
    // The review (D87): the checks pass, so look at the page. Screenshots on a phone and a computer go
    // to the strong model, what it lists goes to the build model for one pass, and the result is kept
    // only if the checks still pass. It never leaves the build worse than it found it.
    if (reviewOn && openWith && report.ok && worthReviewing(firstBuild, ws.netChanges()) && record.chargedMicro - fixStartMicro < FIX_BUDGET_MICRO && !atFreeCeiling()) {
      stopIfRequested();
      keepTheme();
      step({ id: "review", label: "Looking at the page", status: "running" });
      // A resumed build that already asked has the answer saved: no need for the pictures again.
      const answered = replayLog[callIdx] !== undefined;
      const shots = answered ? [] : await screenshots(openWith, ws.files, report, { assets: assetNames, chainId });
      if (!answered && shots.length < 2) {
        log("· review: skipped, no screenshots of the page");
        step({ id: "review", label: "Looking at the page", detail: "skipped", status: "done" });
      } else {
        const direction = record.plan?.summary;
        await callModel(TIER_FOR.review, true, false, { messages: [{ role: "user", content: [{ type: "text", text: reviewPrompt({ request: setup.request, direction }) }, ...shots] }], maxTokens: REVIEW_MAX_TOKENS });
        const verdict = parseReview(sideReply);
        if (!verdict) {
          log(`· review: the reply couldn't be used (${sideReply.length} chars), nothing changed`);
          step({ id: "review", label: "Looking at the page", detail: "couldn't tell", status: "done" });
        } else if (verdict.ok) {
          record.review = { ok: true, issues: [], fixed: false };
          log("✓ review: the page looks right on a phone and a computer");
          step({ id: "review", label: "Looking at the page", detail: "looks right on a phone and a computer", status: "done" });
        } else {
          for (const i of verdict.issues) log(`! review: ${i}`);
          step({ id: "review", label: "Looking at the page", detail: `${plural(verdict.issues.length, "thing")} to fix: ${verdict.issues[0].slice(0, 110)}`, status: "done" });
          step({ id: "review:fix", label: "Fixing what it saw", status: "running" });
          const before = { ...ws.files };
          const beforeKey = filesKey(before);
          convo.push({ role: "user", content: reviewFixMessage(verdict.issues) });
          await phase(TIER_FOR.build, true);
          keepTheme();
          const untouched = filesKey(ws.files) === beforeKey;
          const after = untouched ? report : await checkNow("review");
          if (!untouched && after.ok) {
            report = after;
            record.review = { ok: false, issues: verdict.issues, fixed: true };
            log(`✓ review: fixed ${plural(verdict.issues.length, "thing")}, and the checks still pass`);
            step({ id: "review:fix", label: "Fixing what it saw", detail: `${plural(verdict.issues.length, "thing")} fixed`, status: "done" });
          } else {
            // A fix that breaks a check isn't worth a second round of fixing: the page goes back to how it was.
            for (const path of Object.keys(ws.files)) delete ws.files[path];
            Object.assign(ws.files, before);
            checked = undefined;
            record.review = { ok: false, issues: verdict.issues, fixed: false };
            log(untouched ? "· review: the builder changed nothing" : "! review: the fixes broke a check, so the page was left as it was");
            step({ id: "review:fix", label: "Fixing what it saw", detail: untouched ? "nothing was changed" : "left as it was: the fixes broke a check", status: "done" });
          }
        }
      }
    }
    keepTheme();
    // Replayed everything without reaching a new model call (a crash during the last checks).
    goLive();
    // Only contract tests are still failing: the contract compiled and the app's checks pass, so the build ships and says so.
    const testsOnly = onlyTestFailures(report.errors);
    if (initialErrors > 0 && testsOnly) {
      const detail = `${plural(report.errors.length, "test failure")} left (${firstIssue(report.errors)}). The contract compiled and the app checks pass, so you can still deploy.`;
      step({ id: "autofix", label: "Contract tests: not all passing", detail, status: "done" });
      log(`! ${detail}`);
    } else if (initialErrors > 0) {
      const detail = report.ok
        ? `Fixed ${plural(initialErrors, "error")} on attempt ${attemptsUsed} of ${MAX_FIX_ATTEMPTS}`
        : stoppedEarly
          ? `Failed after ${plural(attemptsUsed, "attempt")}: ${stopNote || `the same ${report.errors.length === 1 ? "error" : "errors"} came back`}`
          : `Failed after ${plural(attemptsUsed, "attempt")}: ${plural(report.errors.length, "error")} left`;
      step({ id: "autofix", label: report.ok ? "Auto-fix: fixed" : "Auto-fix: failed", detail, status: report.ok ? "done" : "error" });
      log(report.ok ? `✓ ${detail.toLowerCase()}` : `✗ ${detail.toLowerCase()}`);
    }

    // Platform-owned contract modules: ABIs the front end imports (addresses come in M5).
    if (report.contracts.length) {
      const names = report.contracts.map((c) => c.name);
      // Deployed addresses live in the deployments table (P3), so a rebuild never wipes them (M5).
      const deployed = await loadDeployedAddresses(db, input.projectId, Object.fromEntries(report.contracts.map((c) => [c.name, c.abi])));
      for (const c of report.contracts) ws.files[`${PLATFORM_DIR}${c.name}.ts`] = contractModule(c.name, c.abi, deployed[c.name] ?? {});
      ws.files[`${PLATFORM_DIR}index.ts`] = contractsIndex(names);
      record.contracts = report.contracts.map(({ name, file, bytecodeBytes }) => ({ name, file, bytecodeBytes }));
    }
    record.checks = { errors: testsOnly ? 0 : report.errors.length, warnings: report.warnings.length };
    record.status = report.ok || testsOnly ? "ready" : "needs_fix";
    const endStatus = record.status;

    const summary = firstLine(text) || (report.ok || testsOnly ? "Build updated." : "Build has errors to fix.");
    const save = ws.changed() || firstBuild;
    if (save) record.changes = ws.netChanges().filter((c) => !c.path.startsWith(PLATFORM_DIR));
    stopIfRequested();
    // One transaction: the checkpoint, the final message, the reference images marked as seen,
    // the turn lock and the job's end state. A crash after it leaves a finished job, never a
    // job that runs again.
    await job.commit(async (tx) => {
      if (save) record.version = await checkpoint(tx, { projectId: input.projectId, files: ws.files, summary, messageId: assistantId });
      await finish(tx, assistantId, text, record);
      await markImagesAttached(tx, setup);
      if (job.lockHeld) await releaseTurn(tx, input.projectId, endStatus);
      await job.complete(tx, "done");
    });
    finalStatus = endStatus;
    if (save) {
      emit({ type: "files", files: ws.files });
      emit({ type: "version", number: record.version! });
    }
    emit({ type: "done", status: record.status, summary });
    return record;
  } catch (error) {
    if (error instanceof LeaseLostError) throw error; // another worker owns the job now
    replaying = false;
    if (error instanceof TurnStoppedError || job.signal?.aborted) {
      // Stop: nothing is saved to the project (edits discarded); usage already recorded stays.
      record.status = "stopped";
      log("■ stopped by you; this turn's edits were discarded");
      await endWith("stopped").catch(rethrowLease);
      emit({ type: "done", status: "stopped", summary: text.trim() });
      return record;
    }
    const message =
      error instanceof ResumeFailedError
        ? `This build was interrupted and couldn't continue: ${error.message} Retry to run it again.`
        : error instanceof ModelUnavailableError
          ? error.message
          : error instanceof Error
            ? error.message
            : "The build failed unexpectedly.";
    record.status = "error";
    record.error = message;
    if (assistantId) await endWith("error", message).catch(rethrowLease);
    else
      await job
        .commit(async (tx) => {
          if (job.lockHeld) await releaseTurn(tx, input.projectId, finalStatus);
          await job.complete(tx, "error", message);
        })
        .catch(rethrowLease);
    emit({ type: "error", message });
    return record;
  } finally {
    if (!job.lockHeld) await releaseTurn(db, input.projectId, finalStatus).catch(() => undefined);
  }

  async function endWith(status: "stopped" | "error", message?: string) {
    await job.commit(async (tx) => {
      await finish(tx, assistantId, text, record);
      if (job.lockHeld) await releaseTurn(tx, input.projectId, finalStatus);
      await job.complete(tx, status, message);
    });
  }

  /** First run: record the prompt, create the reply, build the context. Saved once. */
  async function runSetup(): Promise<TurnSetup> {
    const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
    // A resumed-before-setup run sees "building"; the status from before the turn is unknown
    // then, and "draft" is the safe fallback.
    finalStatus = project.status === "building" ? "draft" : project.status;

    // The user's message: answer a queued one, or record the new prompt.
    let request = input.prompt?.trim() ?? "";
    let userMessageId = input.userMessageId;
    let isIntake = input.intake === true;
    if (userMessageId) {
      const [m] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.id, userMessageId), eq(messages.projectId, input.projectId)))
        .limit(1);
      request = m?.content ?? request;
      isIntake = isIntake || (m?.meta as { intake?: boolean } | null)?.intake === true;
      // The chat is ordered by time: a prompt queued behind other turns moves to the moment
      // its own turn starts, so its reply sits right under it (seen live with 3 queued prompts).
      await db.update(messages).set({ status: "done", createdAt: new Date() }).where(eq(messages.id, userMessageId));
    } else {
      const [m] = await db
        .insert(messages)
        .values({ projectId: input.projectId, role: "user", content: request, status: "done", meta: { mode: input.mode } })
        .returning({ id: messages.id });
      userMessageId = m.id;
    }

    // The reply message: reused when an earlier attempt of this job already created it.
    const existing = job.resume?.assistantMessageId;
    if (existing) {
      assistantId = existing;
      await db.update(messages).set({ content: "", status: "streaming", meta: record as unknown as Record<string, unknown> }).where(eq(messages.id, existing));
    } else {
      assistantId = await job.commit(async (tx) => {
        const [assistant] = await tx
          .insert(messages)
          .values({ projectId: input.projectId, role: "assistant", content: "", status: "streaming", meta: record as unknown as Record<string, unknown> })
          .returning({ id: messages.id });
        await job.setAssistant(tx, assistant.id);
        return assistant.id;
      });
    }
    emit({ type: "start", messageId: assistantId, mode: input.mode });

    let files = await loadFiles(db, input.projectId);
    const firstBuild = Object.keys(files).length === 0;
    files = withKitHelpers(firstBuild ? starterFiles(project.chainId) : withStarterHelpers(files, project.chainId));
    // Uploaded assets: the platform-owned module is refreshed before the workspace snapshot,
    // so a new upload alone doesn't count as an edit.
    const assetStore = deps.assets ?? dbAssetStore(db);
    const assets = await assetStore.list(input.projectId);
    const names = assets.filter((a) => a.kind !== "reference").map((a) => a.name);
    if (assets.length) files[ASSETS_MODULE] = assetsModule(assets);
    else delete files[ASSETS_MODULE];

    // Plan first (D32): the request and nothing else. No project files, history or images, so the
    // questions stay cheap; the images wait, unattached, for the build.
    if (isIntake) {
      const result: TurnSetup = {
        v: TURN_SETUP_VERSION,
        assistantId,
        userMessageId,
        request,
        firstBuild,
        intake: true,
        priorStatus: finalStatus,
        assetNames: names,
        chainId: project.chainId,
        contractOptions: {},
        baseFiles: files,
        prefix: [{ role: "user", content: intakeContext(request, assets) }],
        imageAssetIds: [],
        recordAtStart: structuredClone(record),
        text,
      };
      await job.commit((tx) => job.saveSetup(tx, result));
      return result;
    }

    // The plan's answers carry into every later turn. The first build also gets the palette, in
    // place before the model reads the page.
    const brief = planBrief(latestIntake(await db.select({ role: messages.role, meta: messages.meta }).from(messages).where(eq(messages.projectId, input.projectId)).orderBy(asc(messages.createdAt))), firstBuild);
    const chosenPalette = firstBuild ? paletteById(brief.paletteId) : undefined;
    if (chosenPalette && files["public/index.html"] !== undefined) files["public/index.html"] = applyPalette(files["public/index.html"], chosenPalette);

    // Kits (D71): one the request clearly asks for is on before the builder starts, so its packages and
    // starter files are there even if the builder forgets to ask. In place before the workspace
    // snapshot, like an upload's module, so it doesn't count as an edit by itself.
    const all = await conversation(db, input.projectId, [userMessageId, assistantId]);
    // On a first build the request is often just "Start building" (the plan-first questions came first, D32),
    // so what the person asked for is in their earlier messages: those words count too. Later turns go by
    // the request alone, so a word from long ago doesn't turn a kit on.
    const kitWords = [request, brief.answerWords, ...(firstBuild ? all.filter((m) => m.role === "user").map((m) => m.content) : [])].join("\n");
    const newKits = input.mode === "build" ? detectKits(kitWords, files) : [];
    // A Yes to the plan's MiniPay question (D88) turns the MiniPay kit on, whatever its words.
    const miniAppKit = kitById("mini-app");
    if (input.mode === "build" && brief.miniPay && miniAppKit && !kitsOf(files).includes(miniAppKit) && !newKits.includes(miniAppKit)) newKits.push(miniAppKit);
    // A gallery template is a designed page (D60): it gets the motion kit (D84) whatever its words say.
    const motionKit = kitById("motion");
    if (input.mode === "build" && firstBuild && motionKit && templateBriefFor(project.templateId) && !newKits.includes(motionKit)) newKits.push(motionKit);
    for (const kit of newKits) files = withKit(files, kit);
    if (newKits.length) log(`kits: turned on ${newKits.map((k) => k.id).join(", ")} for this request`);
    const kitsOn = kitsOf(files);
    const kitsBlock = kitsOn.length
      ? [
          `Kits on for this project: ${kitsOn.map((k) => `${k.id} (${k.title})`).join(", ")}. Their packages are installed and their starter files are in the project. Follow each kit's guide (read_guide ${kitsOn.map((k) => `"${kitGuideName(k.id)}"`).join(", ")}).`,
          ...newKits.map((k) => `<guide name="${kitGuideName(k.id)}">\n${k.guide}\n</guide>`),
        ].join("\n\n")
      : "";

    const history: ChatMessage[] = all.slice(-HISTORY_WINDOW).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    let memoryResult: { fallback: boolean; outputTokens: number; chars: number } | null = null;
    // The memory call's usage and the new memory are committed together: a crash in between
    // re-runs the call on resume, unbilled the first time, never billed twice.
    const memoryUsage: Array<Extract<ModelEvent, { type: "usage" }>> = [];
    const memory = await updateMemory(model, (project.memory as Memory | null) ?? null, all, (ev) => void memoryUsage.push(ev), (r) => (memoryResult = r));
    const advanced = memory.upTo > ((project.memory as Memory | null)?.upTo ?? 0);
    if (memoryUsage.length || advanced) await job.commit(async (tx) => {
      for (const [n, ev] of memoryUsage.entries()) {
        const cost = await recordUsage(tx, {
          userId: input.userId,
          projectId: input.projectId,
          messageId: assistantId,
          callId: ev.callId || `${assistantId}:memory:${n}`,
          model: ev.model,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          cachedInputTokens: ev.cachedInputTokens,
          funding,
          jobId: job.jobId,
        });
        record.chargedMicro += cost.chargedMicro;
      }
      if (advanced) await tx.update(projects).set({ memory }).where(eq(projects.id, input.projectId));
    });
    if (advanced) {
      // Output tokens and fallback are logged so empty replies (thinking on) can be measured.
      // Assigned in the callback above, which TypeScript can't see.
      const r = memoryResult as { fallback: boolean; outputTokens: number; chars: number } | null;
      const how = r ? `; model reply ${r.chars} chars, ${r.outputTokens} output tokens${r.fallback ? ", unusable: kept the user's words instead" : ""}` : "";
      log(`memory: ${memory.upTo} older messages summarised, ${memory.decisions.length} decisions kept${how}`);
    }

    const upgradeable = await isUpgradeableProject(db, input.projectId);
    const ctx = contextWithPicks({
      files,
      request,
      // Evals only: shrink the budget to exercise search on a mid-size project (HARNESS.md).
      budgetChars: Number(process.env.GOODBUILD_CONTEXT_BUDGET) || undefined,
      recent: await lastChanged(db, input.projectId, assistantId),
      history: history.map((m) => String(m.content)).join("\n"),
      lastSuggestions: await lastSuggestions(db, input.projectId, assistantId),
      assets: assetManifest(assets),
      memory: memoryBlock(memory),
      deployments: [upgradeable ? upgradeableRules(await liveStorage(db, project)) : "", deploymentsBlock(await loadDeployedAddresses(db, input.projectId), { upgradeable })].filter(Boolean).join("\n\n"),
      plan: [brief.text, firstBuild ? templateBriefFor(project.templateId) : "", kitsBlock].filter(Boolean).join("\n\n"),
      targetChain: project.chainId === 42220 ? "Celo Mainnet (42220)" : project.chainId === 11142220 ? "Celo Sepolia (11142220)" : `Unsupported chain ${project.chainId}`,
    });
    log(`context: ${ctx.picks.length} of ${Object.keys(files).length} files in full (${ctx.picks.map((p) => p.path.split("/").pop()).join(", ")})`);
    // Design references the model hasn't seen yet go in as images, once; the manifest keeps
    // their text spec for later turns. They are marked seen only when this turn commits, so a
    // stopped or failed turn shows them again next time.
    const fresh = (await assetStore.unattached(input.projectId)).slice(0, MAX_IMAGES_PER_TURN);
    images = await loadImages(assetStore, input.projectId, fresh.map((a) => a.id));
    if (images.length) log(`attached ${plural(images.length, "design reference")}: ${fresh.map((a) => a.name).join(", ")}`);
    const imageAssetIds = images.length ? fresh.map((a) => a.id) : [];

    // G$ anywhere in this project's prompts means the G$ ERC-20, never native CELO.
    const userText = [request, brief.answerWords, ...history.filter((m) => m.role === "user").map((m) => String(m.content))].join("\n");
    const prefix: SavedMessage[] = [
      // History messages are plain text (built above from message content).
      ...(history as SavedMessage[]),
      { role: "user", content: imageAssetIds.length ? [{ type: "text", text: ctx.text }, ...imageAssetIds.map((assetId) => ({ type: "asset-image" as const, assetId }))] : ctx.text, cache: true },
    ];
    const result: TurnSetup = {
      v: TURN_SETUP_VERSION,
      assistantId,
      userMessageId,
      request,
      firstBuild,
      ...(input.mode === "build" && chosenPalette ? { paletteId: chosenPalette.id } : {}),
      ...(input.mode === "build" && firstBuild && brief.customColours ? { customColours: true } : {}),
      priorStatus: finalStatus,
      assetNames: names,
      chainId: project.chainId,
      contractOptions: { gdToken: mentionsGd(userText), allowNative: mentionsNativeCelo(userText), ...(upgradeable ? { upgradeable } : {}) },
      baseFiles: files,
      prefix,
      imageAssetIds,
      recordAtStart: structuredClone(record),
      text,
    };
    await job.commit((tx) => job.saveSetup(tx, result));
    return result;
  }

  async function markImagesAttached(tx: Db, s: TurnSetup) {
    if (!s.imageAssetIds.length) return;
    await (deps.assets ?? dbAssetStore(tx)).markAttached(input.projectId, s.imageAssetIds, assistantId);
  }
}

/**
 * On a paid job, every live model call is checked first (D49): its hold must cover the most the call
 * could be charged, extended from the rest of the balance if it can be. Otherwise the build stops here,
 * before paying for a call it can't cover, and ends like any failed build, which returns the hold. It
 * wraps the client so that nothing can miss it: the build, fix and wrap-up calls, the memory call and a
 * retry. Saved responses replayed after a crash never reach the model, so they never reach this.
 */
function checkedAgainstHold(model: ModelClient, job: TurnJobContext): ModelClient {
  if (job.funding !== "paid" || !job.jobId) return model;
  const jobId = job.jobId;
  return {
    async *stream(request) {
      const worst = worstCaseCallMicro(MODEL_IDS[request.tier], request);
      if (!(await job.commit((tx) => ensureHold(tx, jobId, worst)))) throw new OutOfCreditsError();
      yield* model.stream(request);
    },
  };
}

function rethrowLease(error: unknown): never | void {
  if (error instanceof LeaseLostError) throw error;
}

/** Design references as model image parts (rasterised for the vision call). */
async function loadImages(store: AssetStore, projectId: string, ids: string[]): Promise<UserPart[]> {
  const out: UserPart[] = [];
  for (const id of ids) {
    const full = await store.get(projectId, id);
    if (full) out.push({ type: "image", ...(await visionImage(full.bytes, full.mime)) });
  }
  return out;
}

/** Saved messages back to model messages: asset references become the images loaded for them. */
function rehydrate(prefix: SavedMessage[], images: UserPart[]): ChatMessage[] {
  let next = 0;
  return prefix.map((m) => {
    if (m.role !== "user" || typeof m.content === "string") return m as ChatMessage;
    const content: UserPart[] = m.content.map((p) => (p.type === "asset-image" ? images[next++] : p)).filter(Boolean);
    return { ...m, content };
  });
}

async function runChecks(
  files: Record<string, string>,
  compile: typeof checkContracts,
  lint: typeof checkApp,
  step: (s: Step) => void,
  log: (l: string) => void,
  /** A fix attempt's number, or a name for a check the builder asked for: it keeps the step ids apart. */
  attempt: number | string,
  contractOptions: ContractCheckOptions = {},
  runTests: typeof runContractTests = runContractTests,
  /** Stop point: solc and the test EVM can't be interrupted mid-run, so check before each. */
  stopIfRequested: () => void = () => undefined,
  /** The run check (D67), when this server has it on. */
  open?: (files: Record<string, string>) => ReturnType<typeof runCheck>,
  /** The type check (D68), when this server has it on. */
  types?: { run: typeof typeCheck; enforce: boolean },
): Promise<CheckReport> {
  const suffix = attempt ? `:${attempt}` : "";
  const hasContracts = Object.keys(files).some((p) => p.startsWith("contracts/") && p.endsWith(".sol"));
  let contracts: CheckReport = { ok: true, errors: [], warnings: [], contracts: [] };
  if (hasContracts) {
    stopIfRequested();
    step({ id: `compile${suffix}`, label: "Compiling contracts", status: "running" });
    contracts = await compile(files, contractOptions);
    const version = contracts.compilerVersion?.split("+")[0] ?? "";
    for (const c of contracts.contracts) log(`✓ solc ${version} · ${c.name} · ${(c.bytecodeBytes / 1024).toFixed(1)} kB bytecode`);
    for (const e of contracts.errors.slice(0, 3)) log(`✗ ${e.file.split("/").pop()}${e.line ? `:${e.line}` : ""} ${e.message}`);
    step({
      id: `compile${suffix}`,
      label: `Compiling with solc ${version || "0.8.28"}`,
      detail: contracts.ok
        ? `0 errors · ${plural(contracts.warnings.length, "warning")}`
        : `${plural(contracts.errors.length, "error")}: ${firstIssue(contracts.errors)}`,
      status: contracts.ok ? "done" : "error",
    });
  }
  if (hasContracts && contracts.ok && contracts.tests?.length) {
    stopIfRequested();
    step({ id: `test${suffix}`, label: "Testing contracts", status: "running" });
    const { results, issues } = await runTests(contracts);
    const passed = results.filter((r) => r.ok).length;
    for (const r of results) log(`${r.ok ? "✓" : "✗"} ${r.contract}.${r.test}${r.ok ? "" : `: ${r.reason}`}`);
    if (!results.length) for (const i of issues) log(`✗ ${i.message}`);
    contracts = { ...contracts, ok: issues.length === 0, errors: [...contracts.errors, ...issues] };
    step({
      id: `test${suffix}`,
      label: "Testing contracts",
      detail: issues.length ? `${plural(issues.length, "failure")}: ${issues[0].message.slice(0, 120)}` : `${plural(passed, "test")} passed in a local EVM`,
      status: issues.length ? "error" : "done",
    });
  }
  stopIfRequested();
  step({ id: `app${suffix}`, label: "Checking the app", status: "running" });
  const app = lint(files);
  for (const e of app.errors.slice(0, 3)) log(`✗ ${e.file.split("/").pop()}${e.line ? `:${e.line}` : ""} ${e.message}`);
  if (app.ok) log("✓ app checks passed");
  step({
    id: `app${suffix}`,
    label: "Checking the app",
    detail: app.ok ? "imports and syntax ok" : `${plural(app.errors.length, "error")}: ${firstIssue(app.errors)}`,
    status: app.ok ? "done" : "error",
  });
  // Type-check and open the app only once everything before them passes: a build that doesn't
  // compile can't run, and those errors are cheaper to fix first. The two run side by side.
  let runtime: CheckIssue[] = [];
  let typed: CheckIssue[] = [];
  if ((open || types) && contracts.ok && app.ok) {
    stopIfRequested();
    // The app imports its contracts' ABIs from platform modules that are written at the end of the
    // turn. The checks get them now, with no addresses, as the app is before anything is deployed.
    const withContracts = withContractModules(files, contracts.contracts);
    if (types) step({ id: `types${suffix}`, label: "Checking types", status: "running" });
    if (open) step({ id: `run${suffix}`, label: "Opening the app", status: "running" });
    const [typeResult, runResult] = await Promise.all([types?.run(withContracts), open?.(withContracts)]);
    if (typeResult && types) {
      typed = typeResult.issues;
      log(`${!typeResult.ran ? "·" : typed.length ? (types.enforce ? "✗" : "!") : "✓"} type check: ${typeResult.note}${typed.length && !types.enforce ? ", noted, not blocking" : ""} (${(typeResult.ms / 1000).toFixed(1)}s)`);
      for (const e of typed.slice(0, 3)) log(`${types.enforce ? "✗" : "!"} ${e.file.split("/").pop()}${e.line ? `:${e.line}` : ""} ${e.message.slice(0, 200)}`);
      step({
        id: `types${suffix}`,
        label: "Checking types",
        detail: !typeResult.ran ? "skipped" : typed.length ? `${plural(typed.length, "type error")}${types.enforce ? `: ${firstIssue(typed)}` : " noted"}` : "types are consistent",
        status: typed.length && types.enforce ? "error" : "done",
      });
    }
    if (runResult) {
      runtime = runResult.issues;
      log(`${!runResult.ran ? "·" : runtime.length ? "✗" : "✓"} run check: ${runResult.note} (${(runResult.ms / 1000).toFixed(1)}s)`);
      for (const e of runtime.slice(0, 3)) log(`✗ ${e.file.split("/").pop()} ${e.message}`);
      step({
        id: `run${suffix}`,
        label: "Opening the app",
        detail: !runResult.ran ? "skipped" : runtime.length ? `${plural(runtime.length, "problem")}: ${firstIssue(runtime)}` : "it runs",
        status: runtime.length ? "error" : "done",
      });
    }
  }
  const blocking = types?.enforce ? typed : [];
  return {
    ok: contracts.ok && app.ok && runtime.length === 0 && blocking.length === 0,
    errors: [...contracts.errors, ...app.errors, ...blocking, ...runtime],
    warnings: contracts.warnings,
    contracts: contracts.contracts,
    compilerVersion: contracts.compilerVersion,
    // Type errors in "warn" mode: shown to the builder when it asks, never held against the build.
    ...(typed.length && !types?.enforce ? { notes: typed } : {}),
  };
}

/** The app as the checks see it: with its contracts' ABI modules, which are otherwise written at the end of the turn. */
function withContractModules(files: Record<string, string>, contracts: CheckReport["contracts"]): Record<string, string> {
  const out = { ...files };
  for (const c of contracts) out[`${PLATFORM_DIR}${c.name}.ts`] = contractModule(c.name, c.abi, {});
  if (contracts.length) out[`${PLATFORM_DIR}index.ts`] = contractsIndex(contracts.map((c) => c.name));
  return out;
}

/** The finished page at phone and computer width, as images for the review (D87). Empty when the run check couldn't take them. */
async function screenshots(open: typeof runCheck, files: Record<string, string>, report: CheckReport, options: { assets: string[]; chainId?: number }): Promise<UserPart[]> {
  const result = await open(withContractModules(files, report.contracts), { ...options, screenshots: true });
  if (!result.ran || result.issues.length || !result.screenshots?.length) return [];
  const out: UserPart[] = [];
  for (const shot of result.screenshots) out.push({ type: "image", ...(await reviewImage(shot.png, shot.width)) });
  return out;
}

/** A fingerprint of the project's files, to tell whether anything changed between two checks. */
function filesKey(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const path of Object.keys(files).sort()) hash.update(path).update("\0").update(files[path]).update("\0");
  return hash.digest("hex");
}

/**
 * The chips on the latest earlier reply. They aren't in the reply text, so the context
 * block names them and "yes" or "the second one" has a referent. (Put in the user-side
 * context, not appended to the assistant's history, so the model doesn't copy the format.)
 */
async function lastSuggestions(db: Db, projectId: string, exclude: string): Promise<string[]> {
  const rows = await db.select().from(messages).where(eq(messages.projectId, projectId)).orderBy(asc(messages.createdAt));
  const last = rows.filter((m) => m.role === "assistant" && m.id !== exclude).at(-1);
  return (last?.meta as { suggestions?: string[] } | null)?.suggestions ?? [];
}

/** Every user prompt and assistant reply with text, oldest first (the window and memory split it). */
async function conversation(db: Db, projectId: string, exclude: string[]): Promise<MemoryMessage[]> {
  const rows = await db.select().from(messages).where(eq(messages.projectId, projectId)).orderBy(asc(messages.createdAt));
  return rows
    .filter((m) => !exclude.includes(m.id) && (m.role === "user" || m.role === "assistant") && m.content.trim() && !["queued", "cancelled"].includes(m.status))
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

/** Files the previous turn changed: likely what a follow-up is about. */
async function lastChanged(db: Db, projectId: string, exclude: string): Promise<string[]> {
  const rows = await db.select().from(messages).where(eq(messages.projectId, projectId)).orderBy(asc(messages.createdAt));
  const last = rows.filter((m) => m.role === "assistant" && m.id !== exclude).at(-1);
  return ((last?.meta as { changes?: FileChange[] } | null)?.changes ?? []).map((c) => c.path);
}

async function finish(db: Db, id: string, text: string, record: TurnRecord) {
  const status = record.status === "error" ? "error" : record.status === "stopped" ? "stopped" : "done";
  await db
    .update(messages)
    .set({ content: text.trim(), status, meta: record as unknown as Record<string, unknown> })
    .where(eq(messages.id, id));
}

/**
 * D19 amendment: when the only failures are contract tests, the cheap model gets the first
 * fix attempt (TIER_FOR.testFix); anything else, or a later attempt, goes to TIER_FOR.fix.
 * A compile error inside a test file (contracts/test/) counts as a test failure (second D19
 * amendment, HARNESS.md E5: Sonnet's fix of one was $0.20 of a $0.26 build).
 */
export function fixTier(attempt: number, errors: CheckIssue[]): ModelTier {
  // Third D19 amendment (D68): type errors alone also get the cheap model first. They name the line and say what is wrong.
  const onlyTypes = errors.length > 0 && errors.every((i) => i.source === "types");
  return attempt === 1 && (onlyTestFailures(errors) || onlyTypes) ? TIER_FOR.testFix : TIER_FOR.fix;
}

/** Every remaining error is a contract test failing or a test file that won't compile: nothing is wrong with the contract or the app themselves. */
export function onlyTestFailures(errors: CheckIssue[]): boolean {
  return errors.length > 0 && errors.every((i) => i.source === "test" || (i.source === "solc" && i.file.startsWith("contracts/test/")));
}

/** Track the best error count and how many attempts in a row failed to beat it. */
export function fixProgress(best: number, stalls: number, errorsNow: number): { best: number; stalls: number } {
  return errorsNow < best ? { best: errorsNow, stalls: 0 } : { best, stalls: stalls + 1 };
}

function onlySuggestions(calls: ToolCall[]): boolean {
  return calls.length > 0 && calls.every((c) => c.name === "suggest_next");
}

function toolLabel(call: ToolCall): string | null {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}");
  } catch {
    /* label without args */
  }
  const path = typeof args.path === "string" ? args.path : "";
  const base = path.split("/").pop() ?? path;
  switch (call.name) {
    case "create_file":
    case "edit_file":
      return `Writing ${base}`;
    case "delete_file":
      return `Deleting ${base}`;
    case "read_guide":
      return `Reading the ${String(args.name ?? "")} guide`;
    case "rename_file":
      return `Renaming ${String(args.from ?? "").split("/").pop()}`;
    case "add_dependency":
      return `Adding ${String(args.name ?? "package")}`;
    case "add_kit":
      return `Adding the ${String(args.name ?? "")} kit`;
    default:
      return null; // set_plan, reads and listings aren't shown as steps
  }
}

function changeDetail(change?: FileChange): string | undefined {
  if (!change) return undefined;
  if (change.op === "delete") return "removed";
  if (change.op === "rename") return `from ${change.from}`;
  return `+${change.added}${change.removed ? ` −${change.removed}` : ""}`;
}

function firstLine(text: string): string {
  return text.trim().split(/\n+/)[0]?.slice(0, 300) ?? "";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "TipJar.sol:34 Expected ';'" for step details, kept short. */
function firstIssue(issues: CheckIssue[]): string {
  const e = issues[0];
  if (!e) return "";
  const where = `${e.file.split("/").pop()}${e.line ? `:${e.line}` : ""}`;
  const text = e.message.length > 90 ? `${e.message.slice(0, 89)}…` : e.message;
  return `${where} ${text}`;
}

/** Em dashes in a reply become commas (a spaced or unspaced dash between words). Replies only, never files. */
export function plainDashes(text: string): string {
  return text.replace(/\s*—\s*/g, ", ").replace(/, ,/g, ",");
}

function normalise(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Same text as an earlier reply, or contained in one (ignoring case, spacing, punctuation). */
export function isRepeat(reply: string, earlier: string[]): boolean {
  const r = normalise(reply);
  if (r.length < 12) return false;
  return earlier.some((e) => {
    const n = normalise(e);
    return n === r || n.includes(r);
  });
}
