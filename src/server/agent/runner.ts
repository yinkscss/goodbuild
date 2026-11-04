import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { messages, projects } from "@/server/db/schema";
import { checkApp, checkContracts, formatIssues, type CheckReport } from "./checks";
import { ModelUnavailableError, type ChatMessage, type ModelClient, type ModelTier, type ToolCall } from "./model";
import { BUILD_TOOLS, PLAN_TOOLS, contextMessage, systemPrompt } from "./prompt";
import { checkpoint, claimTurn, loadFiles, recordUsage, releaseTurn } from "./store";
import { PLATFORM_DIR, contractModule, contractsIndex, starterFiles } from "./template";
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
    if (firstBuild) files = starterFiles();
    const ws = new Workspace(files);

    const history = await recentHistory(db, input.projectId, [userMessageId, assistantId]);
    const convo: ChatMessage[] = [
      { role: "system", content: systemPrompt(input.mode) },
      ...history,
      { role: "user", content: contextMessage({ files: ws.files, request }) },
    ];
    const tools = input.mode === "plan" ? PLAN_TOOLS : BUILD_TOOLS;

    let calls = 0;
    const callModel = async (tier: ModelTier) => {
      if (++calls > MAX_CALLS) throw new Error("This build used too many steps. Try a smaller change.");
      let replyText = "";
      const toolCalls: ToolCall[] = [];
      for await (const ev of model.stream({ tier, messages: convo, tools, maxTokens: MAX_TOKENS })) {
        if (ev.type === "text") {
          // Separate replies from different calls with a blank line.
          const delta = !replyText && text && !text.endsWith("\n") ? `\n\n${ev.delta.replace(/^\s+/, "")}` : ev.delta;
          replyText += ev.delta;
          text += delta;
          emit({ type: "text", delta });
        } else if (ev.type === "tool_call") {
          toolCalls.push(ev.call);
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
          emit({ type: "usage", chargedMicro: cost.chargedMicro, totalChargedMicro: record.chargedMicro });
        }
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

    /** Let the model work until it stops calling tools. */
    const phase = async (tier: ModelTier) => {
      for (let round = 0; round < MAX_TOOL_ROUNDS_PER_PHASE; round++) {
        const toolCalls = await callModel(tier);
        if (!toolCalls.length) return;
        for (const call of toolCalls) {
          const stepId = `tool:${call.id}`;
          // Plan mode can't edit; a refused edit attempt isn't worth showing as a failed step.
          const label = input.mode === "plan" ? null : toolLabel(call);
          if (label) step({ id: stepId, label, status: "running" });
          const outcome = ws.execute(call.name, call.arguments, input.mode);
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
      }
      log("! stopped: too many tool rounds in one pass");
    };

    await phase("strong");

    if (input.mode === "plan") {
      record.status = "answered";
      emit({ type: "done", status: "answered", summary: text.trim() });
      await finish(db, assistantId, text, record);
      return record;
    }

    // Checks and auto-fix (max 3; cheap model first, then strong). Same errors twice → stop.
    let report = await runChecks(ws.files, compile, lint, step, log, 0);
    let previous = "";
    for (let attempt = 1; !report.ok && attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      const issues = formatIssues(report.errors);
      if (issues === previous) {
        log("! the same errors came back after a fix, stopping");
        break;
      }
      previous = issues;
      step({ id: `fix:${attempt}`, label: `Fixing errors (attempt ${attempt} of ${MAX_FIX_ATTEMPTS})`, detail: `${report.errors.length} to fix`, status: "running" });
      convo.push({
        role: "user",
        content: `GoodBuild's checks failed. Fix these errors with edit_file, then reply with one sentence on what you changed:\n${issues}`,
      });
      await phase(attempt === 1 ? "cheap" : "strong");
      report = await runChecks(ws.files, compile, lint, step, log, attempt);
      step({ id: `fix:${attempt}`, label: `Fixing errors (attempt ${attempt} of ${MAX_FIX_ATTEMPTS})`, detail: report.ok ? "fixed" : `${report.errors.length} left`, status: report.ok ? "done" : "error" });
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
): Promise<CheckReport> {
  const suffix = attempt ? `:${attempt}` : "";
  const hasContracts = Object.keys(files).some((p) => p.startsWith("contracts/") && p.endsWith(".sol"));
  let contracts: CheckReport = { ok: true, errors: [], warnings: [], contracts: [] };
  if (hasContracts) {
    step({ id: `compile${suffix}`, label: "Compiling contracts", status: "running" });
    contracts = await compile(files);
    const version = contracts.compilerVersion?.split("+")[0] ?? "";
    for (const c of contracts.contracts) log(`✓ solc ${version} · ${c.name} · ${(c.bytecodeBytes / 1024).toFixed(1)} kB bytecode`);
    if (!contracts.ok) log(`✗ ${contracts.errors.length} contract error${contracts.errors.length === 1 ? "" : "s"}`);
    step({
      id: `compile${suffix}`,
      label: `Compiling with solc ${version || "0.8.28"}`,
      detail: `${contracts.errors.length} errors · ${contracts.warnings.length} warnings`,
      status: contracts.ok ? "done" : "error",
    });
  }
  step({ id: `app${suffix}`, label: "Checking the app", status: "running" });
  const app = lint(files);
  if (!app.ok) log(`✗ ${app.errors.length} app error${app.errors.length === 1 ? "" : "s"}`);
  else log("✓ app checks passed");
  step({ id: `app${suffix}`, label: "Checking the app", detail: app.ok ? "imports and syntax ok" : `${app.errors.length} errors`, status: app.ok ? "done" : "error" });
  return {
    ok: contracts.ok && app.ok,
    errors: [...contracts.errors, ...app.errors],
    warnings: contracts.warnings,
    contracts: contracts.contracts,
    compilerVersion: contracts.compilerVersion,
  };
}

/** Last few user prompts and assistant replies (text only), oldest first. */
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
