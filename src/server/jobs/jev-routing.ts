import { ensureHold } from "../credits/holds";
import { sponsorshipCanCall } from "../credits/build-sponsorship";
import { chargedMicro, costMicro } from "../../lib/pricing";
import { recordUsage, loadFiles } from "../agent/store";
import { selectContext } from "../agent/codebase";
import { and, asc, desc, eq, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { buildDeliveries, messages, projects, turnJobs, type TurnJob } from "../db/schema";
import { classifyTurn, isContinuation, questions, thresholds, type IntentState, type JevDecision } from "../agent/jev";
import { disagreements } from "../agent/jev-legacy";
import { latestIntake, planBrief } from "../agent/plan-intake";
import { deliveryFor, extendDelivery } from "../agent/delivery";
import type { TurnJobContext } from "../agent/turn-progress";
import { keepsScope, type TurnAction } from "@/lib/turn-actions";


type Source = { id: string; content: string; createdAt: Date };
/** The facts Jev sees: this request, the first message, the plan answers and likely files. */
async function buildState(db: Db, job: TurnJob, source: Source) {
  const [project] = await db
    .select({ revision: projects.currentVersion })
    .from(projects)
    .where(eq(projects.id, job.projectId));
  const history = await db
    .select({ id: messages.id, role: messages.role, content: messages.content, meta: messages.meta })
    .from(messages)
    .where(and(eq(messages.projectId, job.projectId), lte(messages.createdAt, source.createdAt), ne(messages.id, source.id)))
    .orderBy(asc(messages.createdAt));
  const firstBuild = project.revision === 0;
  const goal = history.find((m) => m.role === "user")?.content ?? source.content;
  const intake = latestIntake(history);
  const answers = planBrief(intake, firstBuild).text;
  const files = firstBuild ? {} : await loadFiles(db, job.projectId);
  const candidates = selectContext(files, source.content)
    .slice(0, 16)
    .map((item) => item.path);
  const state: IntentState = {request:source.content,goal,firstBuild,answers,...(candidates.length ? {files:candidates} : {})};
  return { project, firstBuild, goal, state, candidates };
}

/**
 * A button turn (D175) reuses the newest decision saved on this project before it: the one made for the person's
 * own words. "Start building" after the questions reuses the first message's (its plan turn classified the goal).
 * Nothing is charged again, and the files Jev picked for that earlier request aren't carried over to this one.
 */
export async function reusedDecision(db: Db, projectId: string, source: Source, action: TurnAction): Promise<JevDecision | undefined> {
  const [prior] = await db
    .select({ id: messages.id, meta: messages.meta })
    .from(messages)
    .where(and(eq(messages.projectId, projectId), eq(messages.role, "user"), lt(messages.createdAt, source.createdAt), isNotNull(sql`${messages.meta}->'jev'->'decision'`)))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  const saved = (prior?.meta?.jev as { decision?: JevDecision } | undefined)?.decision;
  if (!prior || !saved) return undefined;
  const signals = action === "add_saved_data" ? { ...saved.signals, integrations: "requested" as const } : saved.signals;
  return { ...saved, signals, relevantFiles: [], chargedMicro: 0, reusedFrom: prior.id };
}

/**
 * Shadow mode (JEV_ROUTING=shadow): classify, compare with the built-in rules, record the comparison on the
 * message and in the log. Nothing the user sees depends on it, and it is never charged to them.
 */
export async function shadowJev(db: Db, job: TurnJob, classify = classifyTurn, signal?: AbortSignal) {
  try {
    const [source] = await db.select().from(messages).where(eq(messages.id, job.userMessageId));
    if (!source || source.role !== "user") return;
    // Button turns (D175) carry no new request: nothing to compare, nothing to pay for.
    if (source.meta?.turnAction) return;
    const { state } = await buildState(db, job, source);
    const decision = await classify(state, signal, undefined, { shadow: true });
    const diff = disagreements(source.content, decision.signals);
    // The shadow signals (D175): probabilities and which pass the "requested" bar. Recorded only; nothing acts on them.
    const extra = decision.shadow ? { probabilities: decision.shadow, flagged: Object.entries(decision.shadow).filter(([, p]) => p >= thresholds.high).map(([id]) => id) } : undefined;
    const record = { model: decision.model, version: decision.version, ms: decision.ms, tokens: decision.response.usage, signals: decision.signals, disagreements: diff, ...(extra ? { extra } : {}) };
    console.log(JSON.stringify({ event: "jev_shadow", jobId: job.id, ...record }));
    await db.update(messages).set({ meta: sql`coalesce(${messages.meta}, '{}'::jsonb) || ${JSON.stringify({ jevShadow: record })}::jsonb` }).where(eq(messages.id, source.id));
  } catch (error) {
    console.warn("Jev shadow run failed:", (error as Error).message);
  }
}

/** Called after admission, under the running worker's lease. Inference holds no SQL locks. */
export async function prepareJevRouting(db: Db, job: TurnJob, ctx: TurnJobContext, classify = classifyTurn) {
  if (ctx.resume?.setup) return;
  const [source] = await db.select().from(messages).where(eq(messages.id, job.userMessageId));
  const marker = source?.meta?.jev as { advance: boolean; completed?: number; decision?: JevDecision; unavailable?: boolean; reuse?: TurnAction } | undefined;
  if (!marker || marker.unavailable) return;
  if (marker.decision) {
    ctx.decision = job.retryOfJobId ? {...marker.decision,chargedMicro:0} : marker.decision;
    return;
  }
  const { project, firstBuild, goal, state, candidates } = await buildState(db, job, source);
  const decision = marker.reuse ? await reusedDecision(db, job.projectId, source, marker.reuse) : await classifyCharged(db, job, ctx, state, candidates, classify);
  ctx.signal?.throwIfAborted();
  const keep = keepsScope(marker.reuse);
  const index = await ctx.commit(async (tx) => {
    const [current] = await tx.select().from(projects).where(eq(projects.id, job.projectId)).for("update");
    if (current.currentVersion !== project.revision)
      throw new Error("Project changed during Jev classification. Retry this turn.");
    let index = job.deliveryIndex ?? undefined;
    if (job.mode === "build") {
      const [saved] = await tx.select().from(buildDeliveries).where(eq(buildDeliveries.projectId, job.projectId));
      if (saved || firstBuild) {
        let plan = saved?.plan ?? deliveryFor(goal, decision);
        index = 0;
        if (plan.completed > 0) {
          // A repair or resume keeps its milestone (D175): no new milestone, no advancing.
          const explicit = keep ? -1 : plan.milestones.findIndex((m) => m.title.toLowerCase() === source.content.trim().toLowerCase());
          const extension = keep ? { plan, picked: -1 } : extendDelivery(plan, source.content, decision);
          const picked = explicit >= 0 ? explicit : marker.advance ? -1 : extension.picked;
          if (explicit < 0 && !marker.advance) plan = extension.plan;
          const advance = !keep && (marker.advance || (decision ? decision.signals.advance === "requested" : isContinuation(source.content)) || picked >= plan.completed);
          if (advance && picked > plan.completed) {
            const milestones = [...plan.milestones];
            milestones.splice(plan.completed, 0, ...milestones.splice(picked, 1));
            plan = { ...plan, milestones };
          }
          // An ordinary edit keeps the scope it was admitted with, even if a milestone finished while it queued.
          index = advance ? plan.completed : Math.max(0, Math.min(plan.completed, marker.completed ?? plan.completed) - 1);
          if (index >= plan.milestones.length) {
            const pending = plan.milestones.findIndex((m) => !plan.verified?.includes(m.id));
            index = pending >= 0 ? pending : plan.milestones.length - 1;
          }
        }
        await tx
          .insert(buildDeliveries)
          .values({ projectId: job.projectId, plan })
          .onConflictDoUpdate({ target: buildDeliveries.projectId, set: { plan } });
      }
    }
    if (decision && !decision.reusedFrom) {
      const usage = await recordUsage(tx, {
        userId: job.userId,
        projectId: job.projectId,
        messageId: source.id,
        callId: `jev:${job.id}:${decision.revision}`,
        model: decision.model,
        inputTokens: decision.response.usage.input_tokens,
        outputTokens: decision.response.usage.output_tokens,
        cachedInputTokens: 0,
        funding: job.funding,
        jobId: job.id,
      });
      decision.chargedMicro = usage.chargedMicro;
    }
    await tx
      .update(turnJobs)
      .set({ deliveryIndex: index ?? null })
      .where(eq(turnJobs.id, job.id));
    await tx
      .update(messages)
      .set({
        meta: sql`coalesce(${messages.meta}, '{}'::jsonb) || ${JSON.stringify({ jev: { ...marker, ...(decision ? { decision } : { unavailable: true }) } })}::jsonb`,
      })
      .where(eq(messages.id, source.id));
    return index;
  });
  ctx.decision = decision;
  ctx.deliveryIndex = index;
}

/** Hold the worst case, then classify. A provider outage or malformed answer falls back to the built-in rules for this turn (nothing is charged). */
async function classifyCharged(db: Db, job: TurnJob, ctx: TurnJobContext, state: IntentState, candidates: string[], classify: typeof classifyTurn): Promise<JevDecision | undefined> {
  const inputBytes=Buffer.byteLength(JSON.stringify({state,questions}))+1024+candidates.reduce((n,p)=>n+Buffer.byteLength(p)+200,0);
  const worst=chargedMicro(costMicro("jev",{inputTokens:inputBytes,outputTokens:0}));
  if(job.funding==="paid" && !await ctx.commit(tx=>ensureHold(tx,job.id,worst))) throw new Error("Insufficient credit for classification");
  if(job.funding==="platform" && !await sponsorshipCanCall(db,job.id,worst)) throw new Error("Insufficient sponsored allowance for classification");
  let decision: JevDecision | undefined;
  try {
    decision = await classify(state, ctx.signal);
  } catch (error) {
    ctx.signal?.throwIfAborted();
    console.warn("Jev classification unavailable, using the built-in rules:", (error as Error).message);
  }
  return decision;
}
