import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { messages, projects } from "@/server/db/schema";
import { checkApp, checkContracts, formatIssues, mentionsGd, mentionsNativeCelo, type CheckIssue, type CheckReport, type ContractCheckOptions } from "./checks";
import { runContractTests } from "./contract-tests";
import { TIER_FOR, ModelUnavailableError, type ChatMessage, type ModelClient, type ModelTier, type ToolCall } from "./model";
import { BUILD_TOOLS, PLAN_TOOLS, contextMessage, systemPrompt } from "./prompt";
import { checkpoint, claimTurn, loadFiles, recordUsage, releaseTurn } from "./store";
import { PLATFORM_DIR, contractModule, contractsIndex, starterFiles, withStarterHelpers } from "./template";
import { Workspace, type FileChange } from "./workspace";


import type { Step, TurnEvent, TurnMode, TurnRecord } from "@/lib/turn-types";

export type { Step, TurnEvent, TurnMode, TurnRecord };

export interface TurnDeps {
  db: Db;
  model: ModelClient;
  checkContracts?: typeof checkContracts;
  checkApp?: typeof checkApp;
  now?: () => Date;
}

export interface TurnInput {
  projectId: string;
  userId: string;
  mode: TurnMode;
  /** A queued user message to answer (e.g. the first prompt from the landing page). */
  userMessageId?: string;
  /** Or a new prompt. */
  prompt?: string;
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
 * attempts (cheap model first, then strong), one checkpoint. Streams events as it goes
 * and persists the chat, files, version and usage. Never throws after the turn starts:
 * failures end as an error record the user can retry.
 */
export async function runTurn(deps: TurnDeps, input: TurnInput, emit: (e: TurnEvent) => void): Promise<TurnRecord> {
  const { db, model } = deps;
  const compile = deps.checkContracts ?? checkContracts;
  const lint = deps.checkApp ?? checkApp;

  if (!(await claimTurn(db, input.projectId, input.userId))) throw new TurnBusyError();

  const record: TurnRecord = { kind: "turn", mode: input.mode, steps: [], log: [], changes: [], chargedMicro: 0, status: "error" };
  let assistantId = "";
  let finalStatus = "draft";
  let text = "";

  const step = (s: Step) => {
    const i = record.steps.findIndex((x) => x.id === s.id);
    if (i >= 0) record.steps[i] = s;
    else record.steps.push(s);
    emit({ type: "step", step: s });
  };
  const log = (line: string) => {
    record.log.push(line);
    emit({ type: "log", line });
  };

  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
    finalStatus = project.status === "building" ? "draft" : project.status;

    // The user's message: answer a queued one, or record the new prompt.
    let request = input.prompt?.trim() ?? "";
    let userMessageId = input.userMessageId;
    if (userMessageId) {
      const [m] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.id, userMessageId), eq(messages.projectId, input.projectId)))
        .limit(1);
      request = m?.content ?? request;
      await db.update(messages).set({ status: "done" }).where(eq(messages.id, userMessageId));
    } else {
      const [m] = await db
        .insert(messages)
        .values({ projectId: input.projectId, role: "user", content: request, status: "done", meta: { mode: input.mode } })
        .returning({ id: messages.id });
      userMessageId = m.id;
    }

    const [assistant] = await db
      .insert(messages)
      .values({ projectId: input.projectId, role: "assistant", content: "", status: "streaming", meta: record as unknown as Record<string, unknown> })
      .returning({ id: messages.id });
    assistantId = assistant.id;
    emit({ type: "start", messageId: assistantId, mode: input.mode });

    let files = await loadFiles(db, input.projectId);
    const firstBuild = Object.keys(files).length === 0;
    files = firstBuild ? starterFiles() : withStarterHelpers(files);
    const ws = new Workspace(files);

    const history = await recentHistory(db, input.projectId, [userMessageId, assistantId]);
    const convo: ChatMessage[] = [
      { role: "system", content: systemPrompt(input.mode) },
      ...history,
      { role: "user", content: contextMessage({ files: ws.files, request, lastSuggestions: await lastSuggestions(db, input.projectId, assistantId) }), cache: true },
    ];
    const tools = input.mode === "plan" ? PLAN_TOOLS : BUILD_TOOLS;

    // G$ anywhere in this project's prompts means the G$ ERC-20, never native CELO.
    const userText = [request, ...history.filter((m) => m.role === "user").map((m) => String(m.content))].join("\n");
    const contractOptions: ContractCheckOptions = { gdToken: mentionsGd(userText), allowNative: mentionsNativeCelo(userText) };

    let calls = 0;
    const replies: string[] = [];
    // Set by each model call: the response stopped at the output-token limit, so any tool
    // call it was writing (usually a big create_file) was lost.
    let cutOff = false;
    let cutAtLimit = false;
    // quiet: a fix pass. Its text goes to the model's history but not to the user, so the
    // first pass's reply (and its follow-up questions) stays the last thing they read; the
    // auto-fix steps already show what happened.
    const callModel = async (tier: ModelTier, quiet = false, wrapUp = false) => {
      if (++calls > MAX_CALLS) throw new Error("This build used too many steps. Try a smaller change.");
      let replyText = "";
      const toolCalls: ToolCall[] = [];
      const textBefore = text;
      cutOff = false;
      cutAtLimit = false;
      // One retry when the provider fails mid-response (e.g. the SDK couldn't parse a chunk):
      // nothing from the failed attempt has been executed, so drop its partial text and calls.
      for (let attempt = 0; ; attempt++) {
        try {
          for await (const ev of model.stream({ tier, messages: convo, tools, maxTokens: MAX_TOKENS })) {
            if (ev.type === "text") {
              if (quiet) {
                replyText += ev.delta;
                continue;
              }
              // Separate replies from different calls with a blank line.
              const delta = !replyText && text && !text.endsWith("\n") ? `\n\n${ev.delta.replace(/^\s+/, "")}` : ev.delta;
              replyText += ev.delta;
              text += delta;
              emit({ type: "text", delta });
            } else if (ev.type === "tool_call") {
              toolCalls.push(ev.call);
            } else if (ev.type === "done") {
              // "length": stopped at the output limit. "tool-calls" with no call that reached us:
              // the call was malformed or dropped on the way. Either way the work isn't done.
              cutAtLimit = ev.finishReason === "length";
              cutOff = cutAtLimit || (/^tool[-_]calls$/.test(ev.finishReason ?? "") && toolCalls.length === 0);
            } else if (ev.type === "usage") {
              const cost = await recordUsage(db, {
                userId: input.userId,
                projectId: input.projectId,
                messageId: assistantId,
                callId: ev.callId || `${assistantId}:${calls}`,
                model: ev.model,
                inputTokens: ev.inputTokens,
                outputTokens: ev.outputTokens,
                cachedInputTokens: ev.cachedInputTokens,
              });
              record.chargedMicro += cost.chargedMicro;
              emit({
                type: "usage",
                chargedMicro: cost.chargedMicro,
                totalChargedMicro: record.chargedMicro,
                model: ev.model,
                inputTokens: ev.inputTokens,
                outputTokens: ev.outputTokens,
                cachedInputTokens: ev.cachedInputTokens,
              });
            }
          }
          break;
        } catch (error) {
          if (attempt >= 1 || !(error instanceof ModelUnavailableError)) throw error;
          log("! the AI provider failed mid-response; retrying once");
          replyText = "";
          toolCalls.length = 0;
          cutOff = false;
          cutAtLimit = false;
          if (!quiet && text !== textBefore) {
            text = textBefore;
            emit({ type: "text_set", text });
          }
        }
      }
      // A reply that repeats one already shown in this turn (models often restate the
      // summary after a fix) is dropped from what the user sees, live and saved.
      if (quiet) {
        // Nothing was shown.
      } else if (!wrapUp && input.mode === "build" && toolCalls.length && !onlySuggestions(toolCalls) && replyText.trim()) {
        // Narration before tool calls ("I'll start by planning this out.") isn't the reply;
        // the steps already show the work. Keep it in the model's history only.
        text = textBefore;
        emit({ type: "text_set", text });
      } else if (replyText.trim() && isRepeat(replyText, replies)) {
        text = textBefore;
        emit({ type: "text_set", text });
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
      emit({ type: "suggestions", items });
    };

    /** Let the model work until it stops calling tools. False when it ran out of rounds. */
    const phase = async (tier: ModelTier, quiet = false) => {
      for (let round = 0; round < MAX_TOOL_ROUNDS_PER_PHASE; round++) {
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
          const stepId = `tool:${call.id}`;
          // Plan mode can't edit; a refused edit attempt isn't worth showing as a failed step.
          const label = input.mode === "plan" ? null : toolLabel(call);
          if (label) step({ id: stepId, label, status: "running" });
          const outcome = ws.execute(call.name, call.arguments, input.mode);
          if (outcome.guides?.length) log(`guides: ${outcome.guides.join(", ")}`);
          takeSuggestions(outcome.suggestions, quiet);
          if (outcome.plan) {
            record.plan = outcome.plan;
            emit({ type: "plan", ...outcome.plan });
            step({ id: "plan", label: "Plan", detail: outcome.plan.summary || `${outcome.plan.steps.length} steps`, status: "done" });
          }
          if (outcome.change) {
            record.changes.push(outcome.change);
            emit({ type: "file", change: outcome.change });
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

    const finished = await phase(input.mode === "plan" ? TIER_FOR.plan : TIER_FOR.build);
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
        emit({ type: "text_set", text });
      }
    }

    // Plan mode, or a build-mode question answered without touching files (not a first
    // build, which must still seed and check the starter): nothing to check or save.
    if (input.mode === "plan" || (!firstBuild && !ws.changed())) {
      record.status = "answered";
      emit({ type: "done", status: "answered", summary: text.trim() });
      await finish(db, assistantId, text, record);
      return record;
    }

    // Checks and auto-fix (max 3, all on the fix tier). Same errors twice → stop.
    let report = await runChecks(ws.files, compile, lint, step, log, 0, contractOptions);
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
        content: `GoodBuild's checks failed. Fix these errors with edit_file. Then stop with a very short note (the user sees the fix steps, not this note):\n${issues}`,
      });
      await phase(TIER_FOR.fix, true);
      report = await runChecks(ws.files, compile, lint, step, log, attempt, contractOptions);
      step({
        id: `fix:${attempt}`,
        label: `Fixing errors (attempt ${attempt} of ${MAX_FIX_ATTEMPTS})`,
        detail: report.ok ? "all checks pass" : `${plural(report.errors.length, "error")} left: ${firstIssue(report.errors)}`,
        status: report.ok ? "done" : "error",
      });
    }
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
      for (const c of report.contracts) ws.files[`${PLATFORM_DIR}${c.name}.ts`] = contractModule(c.name, c.abi);
      ws.files[`${PLATFORM_DIR}index.ts`] = contractsIndex(names);
      record.contracts = report.contracts.map(({ name, file, bytecodeBytes }) => ({ name, file, bytecodeBytes }));
    }
    record.checks = { errors: report.errors.length, warnings: report.warnings.length };
    record.status = report.ok ? "ready" : "needs_fix";
    finalStatus = record.status;

    const summary = firstLine(text) || (report.ok ? "Build updated." : "Build has errors to fix.");
    if (ws.changed() || firstBuild) {
      record.changes = ws.netChanges().filter((c) => !c.path.startsWith(PLATFORM_DIR));
      record.version = await checkpoint(db, { projectId: input.projectId, files: ws.files, summary, messageId: assistantId });
      emit({ type: "files", files: ws.files });
      emit({ type: "version", number: record.version });
    }
    emit({ type: "done", status: record.status, summary });
    await finish(db, assistantId, text, record);
    return record;
  } catch (error) {
    const message =
      error instanceof ModelUnavailableError ? error.message : error instanceof Error ? error.message : "The build failed unexpectedly.";
    record.status = "error";
    record.error = message;
    emit({ type: "error", message });
    if (assistantId) await finish(db, assistantId, text, record).catch(() => undefined);
    return record;
  } finally {
    await releaseTurn(db, input.projectId, finalStatus).catch(() => undefined);
  }
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
): Promise<CheckReport> {
  const suffix = attempt ? `:${attempt}` : "";
  const hasContracts = Object.keys(files).some((p) => p.startsWith("contracts/") && p.endsWith(".sol"));
  let contracts: CheckReport = { ok: true, errors: [], warnings: [], contracts: [] };
  if (hasContracts) {
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

/** Last few user prompts and assistant replies (text only), oldest first. */
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

async function recentHistory(db: Db, projectId: string, exclude: string[]): Promise<ChatMessage[]> {
  const rows = await db.select().from(messages).where(eq(messages.projectId, projectId)).orderBy(asc(messages.createdAt));
  return rows
    .filter((m) => !exclude.includes(m.id) && (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-8)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) }));
}

async function finish(db: Db, id: string, text: string, record: TurnRecord) {
  await db
    .update(messages)
    .set({ content: text.trim(), status: record.status === "error" ? "error" : "done", meta: record as unknown as Record<string, unknown> })
    .where(eq(messages.id, id));
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
