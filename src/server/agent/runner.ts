import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { templateBriefFor } from "@/config/page-template-data";
import type { Db } from "@/server/db/client";
import { messages, projects } from "@/server/db/schema";
import { checkApp, checkContracts, formatIssues, mentionsGd, mentionsNativeCelo, type CheckIssue, type CheckReport, type ContractCheckOptions } from "./checks";
import { runContractTests } from "./contract-tests";
import { dbAssetStore, type AssetStore } from "./asset-store";
import { ASSETS_MODULE, assetManifest, assetsModule, visionImage } from "./assets";
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
import { PLATFORM_DIR, contractModule, contractsIndex, starterFiles, withStarterHelpers } from "./template";
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

export const MAX_FIX_ATTEMPTS = 3;
const MAX_CALLS = 30;
const MAX_TOOL_ROUNDS_PER_PHASE = 16;
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

  if (!job.lockHeld && !(await claimTurn(db, input.projectId, input.userId))) throw new TurnBusyError();
  // Every usage row of the turn takes the job's funding (D48).
  const funding = job.funding ?? (await decideFunding(db, input.userId));

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
    const callModel = async (tier: ModelTier, quiet = false, wrapUp = false) => {
      stopIfRequested();
      if (++calls > MAX_CALLS) throw new Error("This build used too many steps. Try a smaller change.");
      const idx = callIdx++;
      const logged = replayLog[idx];
      if (logged && (logged.tier !== tier || logged.convoLen !== convo.length)) {
        throw new ResumeFailedError("the saved progress no longer matches this build's steps.");
      }
      if (!logged) goLive();
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
            for await (const ev of model.stream({ tier, messages: convo, tools, maxTokens: intake ? INTAKE_MAX_TOKENS : MAX_TOKENS, signal: job.signal, ...(intake ? { noThinking: true } : {}) })) {
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
    if (input.mode === "plan" || (!firstBuild && !ws.changed())) {
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

    // The person's colours stay, whatever the model wrote to the page (D32).
    const keepTheme = () => {
      const html = ws.files["public/index.html"];
      if (html === undefined) return;
      const palette = paletteById(setup.paletteId);
      if (palette) ws.files["public/index.html"] = applyPalette(html, palette);
      else if (setup.customColours) ws.files["public/index.html"] = ensureReadable(html);
    };
    keepTheme();
    // Checks and auto-fix (max 3, all on the fix tier). Same errors twice → stop.
    let report = await runChecks(ws.files, compile, lint, step, log, 0, contractOptions, runContractTests, stopIfRequested);
    let previous = "";
    const initialErrors = report.errors.length;
    let attemptsUsed = 0;
    let stoppedEarly = false;
    for (let attempt = 1; !report.ok && attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      const issues = formatIssues(report.errors);
      if (issues === previous) {
        log("! the same errors came back after a fix, stopping");
        stoppedEarly = true;
        break;
      }
      previous = issues;
      attemptsUsed = attempt;
      step({ id: `fix:${attempt}`, label: `Fixing errors (attempt ${attempt} of ${MAX_FIX_ATTEMPTS})`, detail: `${plural(report.errors.length, "error")} to fix: ${firstIssue(report.errors)}`, status: "running" });
      convo.push({
        role: "user",
        content: `GoodBuild's checks failed. Fix these errors with edit_file. If a contract test fails, decide whether the contract or the test is wrong: fix the contract when it misbehaves; change a test only when its expectation is mistaken, and never delete or weaken a check just to make it pass. Then stop with a very short note (the user sees the fix steps, not this note):\n${issues}`,
      });
      await phase(fixTier(attempt, report.errors), true);
      report = await runChecks(ws.files, compile, lint, step, log, attempt, contractOptions, runContractTests, stopIfRequested);
      step({
        id: `fix:${attempt}`,
        label: `Fixing errors (attempt ${attempt} of ${MAX_FIX_ATTEMPTS})`,
        detail: report.ok ? "all checks pass" : `${plural(report.errors.length, "error")} left: ${firstIssue(report.errors)}`,
        status: report.ok ? "done" : "error",
      });
    }
    keepTheme();
    // Replayed everything without reaching a new model call (a crash during the last checks).
    goLive();
    if (initialErrors > 0) {
      const detail = report.ok
        ? `Fixed ${plural(initialErrors, "error")} on attempt ${attemptsUsed} of ${MAX_FIX_ATTEMPTS}`
        : stoppedEarly
          ? `Failed after ${plural(attemptsUsed, "attempt")}: the same ${report.errors.length === 1 ? "error" : "errors"} came back`
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
    record.checks = { errors: report.errors.length, warnings: report.warnings.length };
    record.status = report.ok ? "ready" : "needs_fix";
    const endStatus = record.status;

    const summary = firstLine(text) || (report.ok ? "Build updated." : "Build has errors to fix.");
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
    files = firstBuild ? starterFiles(project.chainId) : withStarterHelpers(files, project.chainId);
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

    const all = await conversation(db, input.projectId, [userMessageId, assistantId]);
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
      plan: [brief.text, firstBuild ? templateBriefFor(project.templateId) : ""].filter(Boolean).join("\n\n"),
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
  attempt: number,
  contractOptions: ContractCheckOptions = {},
  runTests: typeof runContractTests = runContractTests,
  /** Stop point: solc and the test EVM can't be interrupted mid-run, so check before each. */
  stopIfRequested: () => void = () => undefined,
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
  return {
    ok: contracts.ok && app.ok,
    errors: [...contracts.errors, ...app.errors],
    warnings: contracts.warnings,
    contracts: contracts.contracts,
    compilerVersion: contracts.compilerVersion,
  };
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
  const testOnly = errors.length > 0 && errors.every((i) => i.source === "test" || (i.source === "solc" && i.file.startsWith("contracts/test/")));
  return attempt === 1 && testOnly ? TIER_FOR.testFix : TIER_FOR.fix;
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
