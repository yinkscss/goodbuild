import { ensureHold } from "../credits/holds";
import { sponsorshipCanCall } from "../credits/build-sponsorship";
import { chargedMicro, costMicro } from "../../lib/pricing";
import { recordUsage, loadFiles } from "../agent/store";
import { selectContext } from "../agent/codebase";
import { and, asc, eq, lte, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { buildDeliveries, messages, projects, turnJobs, type TurnJob } from "../db/schema";
import { classifyTurn, questions, type JevDecision } from "../agent/jev";
import { latestIntake, planBrief } from "../agent/plan-intake";
import { deliveryFor, extendDelivery } from "../agent/delivery";
import type { TurnJobContext } from "../agent/turn-progress";

/** Called after admission, under the running worker's lease. Inference holds no SQL locks. */
export async function prepareJevRouting(db: Db, job: TurnJob, ctx: TurnJobContext, classify = classifyTurn) {
  if (ctx.resume?.setup) return;
  const [source] = await db.select().from(messages).where(eq(messages.id, job.userMessageId));
  const marker = source?.meta?.jev as { advance: boolean; decision?: JevDecision } | undefined;
  if (!marker) return;
  if (marker.decision) {
    ctx.decision = job.retryOfJobId ? {...marker.decision,chargedMicro:0} : marker.decision;
    return;
  }
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
  const state={request:source.content,goal,firstBuild,answers,...(candidates.length ? {files:candidates} : {})};
  const inputBytes=Buffer.byteLength(JSON.stringify({state,questions}))+1024+candidates.reduce((n,p)=>n+Buffer.byteLength(p)+200,0);
  const worst=chargedMicro(costMicro("jev",{inputTokens:inputBytes,outputTokens:0}));
  if(job.funding==="paid" && !await ctx.commit(tx=>ensureHold(tx,job.id,worst))) throw new Error("Insufficient credit for classification");
  if(job.funding==="platform" && !await sponsorshipCanCall(db,job.id,worst)) throw new Error("Insufficient sponsored allowance for classification");
  const decision=await classify(state,ctx.signal);
  ctx.signal?.throwIfAborted();
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
          const explicit = plan.milestones.findIndex((m) => m.title.toLowerCase() === source.content.trim().toLowerCase());
          const extension = extendDelivery(plan, source.content, decision);
          const picked = explicit >= 0 ? explicit : marker.advance ? -1 : extension.picked;
          if (explicit < 0 && !marker.advance) plan = extension.plan;
          const advance = marker.advance || decision.signals.advance === "requested" || picked >= plan.completed;
          if (advance && picked > plan.completed) {
            const milestones = [...plan.milestones];
            milestones.splice(plan.completed, 0, ...milestones.splice(picked, 1));
            plan = { ...plan, milestones };
          }
          index = advance ? plan.completed : plan.completed - 1;
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
    if (!marker.decision) {
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
        meta: sql`coalesce(${messages.meta}, '{}'::jsonb) || ${JSON.stringify({ jev: { ...marker, decision } })}::jsonb`,
      })
      .where(eq(messages.id, source.id));
    return index;
  });
  ctx.decision = decision;
  ctx.deliveryIndex = index;
}
