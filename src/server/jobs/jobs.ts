import "server-only";

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { buildDeliveries, buildDrafts, buildSponsorships, messages, projects, users, turnEvents, turnJobCalls, turnJobs, type FundingSource, type TurnJob } from "@/server/db/schema";
import { decideFunding, decideStart, type CapRefusal } from "@/server/credits/cap";
import { findReservationMismatches, repairReservations, type ReservationMismatch } from "@/server/credits/holds";
import { LeaseLostError, type LoggedCall, type TurnJobContext, type TurnSetup } from "@/server/agent/turn-progress";
import { Workspace } from "@/server/agent/workspace";
import { deliveryFor, extendDelivery } from "@/server/agent/delivery";
import { reserveSponsorship, sponsorshipSettings } from "@/server/credits/build-sponsorship";
import type { GoodIdentity } from "@/server/credits/free-grants";
import type { Address } from "viem";
import type { TurnEvent, TurnMode } from "@/lib/turn-types";

/** Lease length and renewal (P18): renewed every 5 s, expires 30 s after the last renewal. */
export const LEASE_MS = 30_000;
export const RENEW_MS = 5_000;
/** A job that crashed this many times ends with Retry instead of running again. */
export const MAX_ATTEMPTS = 3;
/** Events of a finished job are kept this long for clients still catching up. */
export const EVENTS_GRACE_MS = 2 * 60_000;

export type JobStatus = "queued" | "running" | "done" | "error" | "stopped" | "cancelled";
export const ACTIVE: JobStatus[] = ["queued", "running"];

/**
 * When a paid job's hold counts as stuck (D49). A worker picks up an expired lease within seconds
 * unless it's full or down, and a queued job waits only for the builds ahead of it, so these are far
 * past anything normal. There's no other limit on how long a build runs: its worker renews the lease
 * however long the model takes, so the last is what stops one hung for good from keeping the credit.
 */
export const HOLD_STUCK_LEASE_MS = 30 * 60_000;
export const HOLD_STUCK_QUEUED_MS = 6 * 60 * 60_000;
export const HOLD_MAX_RUN_MS = 3 * 60 * 60_000;

const STUCK_MESSAGE = "This build was stopped because it stalled. The credit set aside for it has been returned. Retry to run it again.";

function rowsOf<T>(result: unknown): T[] {
  // postgres-js returns an array; PGlite returns { rows }.
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

type QueueArgs = {
  projectId: string;
  userId: string;
  mode: TurnMode;
  prompt?: string;
  userMessageId?: string;
  intake?: boolean;
  retryOfJobId?: string;
  /** With a retry (D163): what else is wrong, such as the preview's error, added to the saved draft's notes for the builder. */
  retryNote?: string;
  continueDelivery?: boolean;
  useCredits?: boolean;
  baseVersion?: number;
  deliveryIndex?: number;
  /** Files sent with this message (shown in its bubble). Checked against the project by the caller. */
  assetIds?: string[];
};

/**
 * Queue a turn. The user message is saved now (queued), so a reload before the job starts
 * still shows the prompt. Answering an existing queued message (the landing page's first
 * prompt) reuses it; the unique index on user_message_id makes a double submit harmless.
 * Who funds the job is decided before this and never changes (D48).
 */
async function queueTurn(tx: Db, args: QueueArgs, funding: FundingSource, holdMicro: number): Promise<TurnJob> {
  let messageId = args.userMessageId;
  let prompt = args.prompt?.trim() ?? "";
  if (messageId) {
    const [existing] = await tx.select().from(turnJobs).where(eq(turnJobs.userMessageId, messageId)).limit(1);
    if (existing) return existing;
    const [m] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.projectId, args.projectId)))
      .limit(1);
    if (!m || m.role !== "user") throw new Error("message_not_found");
    prompt = m.content;
    if (m.status !== "queued") await tx.update(messages).set({ status: "queued" }).where(eq(messages.id, m.id));
  } else {
    const [m] = await tx
      .insert(messages)
      .values({ projectId: args.projectId, role: "user", content: prompt, status: "queued", meta: { mode: args.mode, ...(args.retryOfJobId ? { action: "retry", retryOfJobId: args.retryOfJobId } : {}), ...(args.assetIds ? { assetIds: args.assetIds } : {}) } })
      .returning({ id: messages.id });
    messageId = m.id;
  }
  const [job] = await tx.insert(turnJobs).values({ projectId: args.projectId, userId: args.userId, mode: args.mode, prompt, userMessageId: messageId, funding, holdMicro, retryOfJobId: args.retryOfJobId, baseVersion: args.baseVersion ?? 0, deliveryIndex: args.deliveryIndex }).returning();
  await tx.update(messages).set({ meta: sql`coalesce(${messages.meta}, '{}'::jsonb) || ${JSON.stringify({ mode: args.mode, jobId: job.id, ...(args.intake ? { intake: true } : {}) })}::jsonb` }).where(eq(messages.id, messageId));
  return job;
}

export type StartResult = { job: TurnJob } | { refused: CapRefusal };

/**
 * Start a turn for someone: the check, the hold and the queueing as one step, under a lock on that
 * user's balance (D49). What the turns route uses. Builds sent at the same moment take turns here,
 * and each sees the jobs and holds of those before it. Only a job's first submit sets anything aside.
 */
export async function startTurn(db: Db, args: QueueArgs, env: Record<string, string | undefined> = process.env, deps?: { readIdentity: (wallet: Address) => Promise<GoodIdentity> }): Promise<StartResult> {
  if (args.retryOfJobId) {
    const [existing] = await db.select().from(turnJobs).where(and(eq(turnJobs.retryOfJobId, args.retryOfJobId), eq(turnJobs.userId, args.userId), eq(turnJobs.projectId, args.projectId)));
    if (existing) return { job: existing };
  }
  // Live chain verification is outside the DB transaction. A stale client/root cache cannot claim a grant.
  let root: string | null = null;
  if (args.mode === "build" && deps?.readIdentity) {
    const [user] = await db.select().from(users).where(eq(users.id, args.userId));
    if (user?.verifiedAt) {
      try {
        const identity = await deps.readIdentity(user.wallet as Address);
        if (identity.root && (!identity.expiresAt || identity.expiresAt > new Date())) root = identity.root.toLowerCase();
      } catch { /* A verification outage cannot grant a subsidy. Normal funding still works. */ }
    }
  }
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    // Serialise retries, milestone advancement and first-delivery admission per project.
    const [project] = await tx.select().from(projects).where(and(eq(projects.id, args.projectId), eq(projects.ownerId, args.userId))).for("update");
    if (!project) throw new Error("project_not_found");
    if (args.userMessageId) {
      const [existing] = await tx.select().from(turnJobs).where(eq(turnJobs.userMessageId, args.userMessageId));
      if (existing) return { job: existing };
    }
    let source: TurnJob | undefined;
    let creditPaused = false;
    if (args.retryOfJobId) {
      [source] = await tx.select().from(turnJobs).where(and(eq(turnJobs.id, args.retryOfJobId), eq(turnJobs.projectId, args.projectId), eq(turnJobs.userId, args.userId)));
      if (!source) throw new Error("retry_not_found");
      const [existing] = await tx.select().from(turnJobs).where(eq(turnJobs.retryOfJobId, source.id));
      if (existing) return { job: existing };
      const [reply] = source.assistantMessageId ? await tx.select().from(messages).where(eq(messages.id, source.assistantMessageId)) : [];
      const needsFix = (reply?.meta as { status?: string } | null)?.status === "needs_fix";
      creditPaused = reply?.meta?.paused === "credits";
      if (!["error", "stopped"].includes(source.status) && !needsFix) throw new Error("retry_not_failed");
      if (source.baseVersion !== project.currentVersion) throw new Error("retry_stale");
      if ((await activeJobs(tx, project.id)).length) throw new Error("retry_busy");
      const [original] = await tx.select().from(messages).where(eq(messages.id, source.userMessageId));
      args = { ...args, mode: source.mode as TurnMode, prompt: /^(Skip the questions, just build it|Start building)[.!]?$/i.test(source.prompt) ? (await tx.select().from(buildDeliveries).where(eq(buildDeliveries.projectId, project.id)))[0]?.plan.goal ?? source.prompt : source.prompt, userMessageId: undefined, intake: Boolean(original?.meta?.intake), assetIds: original?.meta?.assetIds as string[] | undefined, deliveryIndex: source.deliveryIndex ?? undefined };
    }
    args.baseVersion = project.currentVersion;
    let [delivery] = await tx.select().from(buildDeliveries).where(eq(buildDeliveries.projectId, project.id));
    if (args.mode === "build" && !delivery && project.currentVersion === 0) {
      const [first] = await tx.select().from(messages).where(and(eq(messages.projectId, project.id), eq(messages.role, "user"))).orderBy(asc(messages.createdAt)).limit(1);
      const plan = deliveryFor(first?.content || args.prompt || "Build the requested app");
      [delivery] = await tx.insert(buildDeliveries).values({ projectId: project.id, plan }).returning();
    }
    if (delivery && source && source.deliveryIndex === null) args.deliveryIndex = 0;
    if (delivery && args.mode === "build" && !source) {
      // Answering a queued message names only its id: pick the milestone from that message's text, as the build reads it.
      const [queued] = args.prompt || !args.userMessageId ? [] : await tx.select({ content: messages.content }).from(messages).where(and(eq(messages.id, args.userMessageId), eq(messages.projectId, project.id))).limit(1);
      const prompt = (args.prompt ?? queued?.content ?? "").trim();
      let picked = delivery.plan.milestones.findIndex((m) => m.title.toLowerCase() === prompt.toLowerCase());
      // D153: a request naming work the plan hasn't delivered (a G$ tip jar on a portfolio site) adds
      // that milestone if the first message didn't, and builds it, instead of staying scoped forever.
      // Only once the first interface is delivered (until then every build stays the interface), and
      // not behind a running build: that one may still advance the plan, and a queued edit keeps queueing.
      if (picked < 0 && !args.continueDelivery && delivery.plan.completed > 0 && !(await activeJobs(tx, project.id)).length) {
        const extended = extendDelivery(delivery.plan, prompt);
        if (extended.picked >= 0) {
          picked = extended.picked;
          if (extended.added) {
            await tx.update(buildDeliveries).set({ plan: extended.plan }).where(eq(buildDeliveries.projectId, project.id));
            delivery = { ...delivery, plan: extended.plan };
          }
        }
      }
      const advance = args.continueDelivery || /^(continue|continue building|build next|next milestone)[.!]?$/i.test(prompt) || picked >= delivery.plan.completed;
      if (advance && (await activeJobs(tx, project.id)).length) throw new Error("retry_busy");
      if (advance && picked > delivery.plan.completed) {
        const plan = { ...delivery.plan, milestones: [...delivery.plan.milestones] };
        const [chosen] = plan.milestones.splice(picked, 1);
        plan.milestones.splice(plan.completed, 0, chosen);
        await tx.update(buildDeliveries).set({ plan }).where(eq(buildDeliveries.projectId, project.id));
        delivery = { ...delivery, plan };
      }
      // Ordinary edits preserve scope; only explicit continuation or a saved choice advances it.
      args.deliveryIndex = advance ? delivery.plan.completed : Math.max(0, delivery.plan.completed - 1);
      if (args.deliveryIndex >= delivery.plan.milestones.length) {
        const unverified = delivery.plan.milestones.findIndex((m) => !(delivery.plan.verified ?? []).includes(m.id));
        args.deliveryIndex = unverified < 0 ? undefined : unverified;
      }
    }

    const settings = sponsorshipSettings(env);
    const key = root && source && !source.retryOfJobId && source.mode === "build" && source.status !== "stopped" && !creditPaused && !args.useCredits && source.startedAt ? `repair:${root}:${new Date().toISOString().slice(0, 7)}` : !source && !args.useCredits && root && project.currentVersion === 0 && args.mode === "build" ? `first:${root}` : null;
    const limit = source ? settings.repair : settings.first;
    const sponsored = key && await reserveSponsorship(tx, key, limit, env);
    if (source && source.mode === "build" && source.status !== "stopped" && !sponsored && !args.useCredits) return { refused: { allowed: false, reason: "funding_unavailable", message: "The included repair allowance is unavailable or used up. Your progress is saved. You can request a smaller change using credits in the composer." } };
    const decision = sponsored ? { allowed: true as const, funding: "platform" as const, holdMicro: 0 } : await decideStart(tx, { userId: args.userId, projectId: args.projectId, mode: args.mode }, env);
    if (!decision.allowed) return { refused: decision };
    const job = await queueTurn(tx, args, decision.funding, decision.holdMicro);
    if (sponsored && key) await tx.insert(buildSponsorships).values({ jobId: job.id, allowanceKey: key, limitMicro: limit });
    if (source) {
      const [draft] = await tx.select().from(buildDrafts).where(eq(buildDrafts.jobId, source.id));
      const note = args.retryNote?.trim().slice(0, 3000);
      if (draft) await tx.insert(buildDrafts).values({ ...draft, jobId: job.id, updatedAt: new Date(), ...(note ? { diagnostics: [draft.diagnostics, note].filter(Boolean).join("\n") } : {}) });
      else if (source.mode === "build" && source.setup?.baseFiles) {
        // Legacy failures predate durable drafts, but their committed tool responses can recover edits.
        const workspace = new Workspace(source.setup.baseFiles as Record<string, string>);
        const calls = await tx.select().from(turnJobCalls).where(eq(turnJobCalls.jobId, source.id)).orderBy(asc(turnJobCalls.idx));
        for (const row of calls) for (const call of (row.data as unknown as LoggedCall).toolCalls) workspace.execute(call.name, call.arguments, "build");
        await tx.insert(buildDrafts).values({ jobId: job.id, projectId: project.id, baseVersion: project.currentVersion, files: workspace.files, diagnostics: [source.error ?? "", note ?? ""].filter(Boolean).join("\n") });
      }
    }
    return { job };
  });
}

/** Queue a free or exempt turn with no start check. For tests and scripts: people go through startTurn. */
export async function enqueueTurn(db: Db, args: QueueArgs, env: Record<string, string | undefined> = process.env): Promise<TurnJob> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    return queueTurn(tx, args, await decideFunding(tx, args.userId, env), 0);
  });
}

/**
 * Claim the next runnable job: the oldest queued job of a project with nothing running, or a
 * running job whose lease expired (its worker died: resume it). FOR UPDATE SKIP LOCKED lets
 * several workers claim at once; the partial unique index turns a same-project race into a
 * unique violation, which counts as "nothing claimed". Sets projects.turnStartedAt from the
 * lease, so the revert route and the UI see the project as busy.
 */
export async function claimJob(db: Db, owner: string): Promise<TurnJob | null> {
  try {
    return await db.transaction(async (tx) => {
      const picked = rowsOf<{ id: string }>(
        await tx.execute(sql`
          SELECT j.id FROM turn_jobs j
          WHERE (j.status = 'queued' OR (j.status = 'running' AND j.lease_expires_at < now()))
            AND NOT EXISTS (
              SELECT 1 FROM turn_jobs r WHERE r.project_id = j.project_id AND r.id <> j.id
                AND (r.status = 'running' OR (r.status = 'queued' AND r.created_at < j.created_at AND j.status = 'queued'))
            )
          ORDER BY (j.status = 'running') DESC, j.created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED`),
      );
      if (!picked.length) return null;
      const [job] = await tx
        .update(turnJobs)
        .set({
          status: "running",
          leaseOwner: owner,
          leaseExpiresAt: sql`now() + ${`${LEASE_MS} milliseconds`}::interval`,
          attempt: sql`${turnJobs.attempt} + 1`,
          startedAt: sql`coalesce(${turnJobs.startedAt}, now())`,
        })
        .where(eq(turnJobs.id, picked[0].id))
        .returning();
      const [project] = await tx.update(projects).set({ turnStartedAt: new Date(), status: "building" }).where(eq(projects.id, job.projectId)).returning({ version: projects.currentVersion });
      if (job.attempt === 1) {
        job.baseVersion = project.version;
        await tx.update(turnJobs).set({ baseVersion: project.version }).where(eq(turnJobs.id, job.id));
      }
      return job;
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505" || /duplicate key|unique/i.test(String((error as Error)?.message))) return null;
    throw error;
  }
}

/** Extend the lease. Returns whether a stop was requested, or null when the lease is gone. */
export async function renewLease(db: Db, job: Pick<TurnJob, "id" | "attempt">, owner: string): Promise<{ stopRequested: boolean } | null> {
  const rows = await db
    .update(turnJobs)
    .set({ leaseExpiresAt: sql`now() + ${`${LEASE_MS} milliseconds`}::interval` })
    .where(and(eq(turnJobs.id, job.id), eq(turnJobs.leaseOwner, owner), eq(turnJobs.attempt, job.attempt), eq(turnJobs.status, "running")))
    .returning({ stopRequested: turnJobs.stopRequested });
  return rows[0] ?? null;
}

/** The runner's view of a claimed job: every write is fenced on this worker's lease. */
export async function jobContext(db: Db, job: TurnJob, owner: string, signal: AbortSignal): Promise<TurnJobContext> {
  const calls = job.attempt > 1 ? await db.select().from(turnJobCalls).where(eq(turnJobCalls.jobId, job.id)).orderBy(asc(turnJobCalls.idx)) : [];
  // Only a gapless log can be replayed (a crash can't leave holes, but be strict).
  const log: LoggedCall[] = [];
  for (const [i, c] of calls.entries()) {
    if (c.idx !== i) break;
    log.push(c.data as unknown as LoggedCall);
  }
  const fence = async (tx: Db) => {
    const ok = rowsOf<{ id: string }>(
      await tx.execute(sql`SELECT id FROM turn_jobs WHERE id = ${job.id} AND lease_owner = ${owner} AND attempt = ${job.attempt} AND status = 'running' FOR UPDATE`),
    );
    if (!ok.length) throw new LeaseLostError();
  };
  return {
    lockHeld: true,
    jobId: job.id,
    funding: job.funding,
    baseVersion: job.baseVersion,
    deliveryIndex: job.deliveryIndex ?? undefined,
    draft: (await db.select().from(buildDrafts).where(eq(buildDrafts.jobId, job.id)))[0],
    signal,
    resume: job.attempt > 1 ? { assistantMessageId: job.assistantMessageId, setup: (job.setup as unknown as TurnSetup | null) ?? null, calls: log, attempt: job.attempt } : undefined,
    commit: (fn) =>
      db.transaction(async (tx) => {
        await fence(tx as unknown as Db);
        return fn(tx as unknown as Db);
      }),
    setAssistant: async (tx, id) => {
      await tx.update(turnJobs).set({ assistantMessageId: id }).where(eq(turnJobs.id, job.id));
    },
    saveSetup: async (tx, setup) => {
      await tx.update(turnJobs).set({ setup: setup as unknown as Record<string, unknown> }).where(eq(turnJobs.id, job.id));
      // A fresh setup supersedes any responses an earlier attempt logged before it.
      await tx.delete(turnJobCalls).where(eq(turnJobCalls.jobId, job.id));
    },
    saveCall: async (tx, idx, call) => {
      await tx
        .insert(turnJobCalls)
        .values({ jobId: job.id, idx, data: call as unknown as Record<string, unknown> })
        .onConflictDoUpdate({ target: [turnJobCalls.jobId, turnJobCalls.idx], set: { data: call as unknown as Record<string, unknown> } });
    },
    complete: async (tx, status, error) => {
      await tx.update(turnJobs).set({ status, error: error ?? null, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }).where(eq(turnJobs.id, job.id));
    },
  };
}

/** End a job outside the runner (too many crashes, or it never started): message shows Retry. */
export async function failJob(db: Db, job: TurnJob, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(turnJobs).set({ status: "error", error: message, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }).where(eq(turnJobs.id, job.id));
    if (job.assistantMessageId) {
      const [m] = await tx.select().from(messages).where(eq(messages.id, job.assistantMessageId)).limit(1);
      const meta = { ...((m?.meta as Record<string, unknown> | null) ?? { kind: "turn", mode: job.mode, steps: [], log: [], changes: [], chargedMicro: 0 }), status: "error", error: message, jobId: job.id };
      await tx.update(messages).set({ status: "error", meta }).where(eq(messages.id, job.assistantMessageId));
    } else {
      await tx.update(messages).set({ status: "done" }).where(eq(messages.id, job.userMessageId));
      await tx.insert(messages).values({ projectId: job.projectId, role: "assistant", content: "", status: "error", meta: { kind: "turn", mode: job.mode, steps: [], log: [], changes: [], chargedMicro: 0, status: "error", error: message, jobId: job.id } });
    }
    const [p] = await tx.select().from(projects).where(eq(projects.id, job.projectId)).limit(1);
    await tx.update(projects).set({ turnStartedAt: null, status: p?.status === "building" ? "draft" : (p?.status ?? "draft") }).where(eq(projects.id, job.projectId));
  });
}

/**
 * Stop (user decision 2): the running job stops at its next safe point, and every queued
 * follow-up of the project is cancelled. Cancelled prompts stay in the chat to resend.
 */
export async function stopProject(db: Db, projectId: string): Promise<{ stopping: boolean; cancelled: number }> {
  return db.transaction(async (tx) => {
    const running = await tx
      .update(turnJobs)
      .set({ stopRequested: true })
      .where(and(eq(turnJobs.projectId, projectId), eq(turnJobs.status, "running")))
      .returning({ id: turnJobs.id });
    const cancelled = await tx
      .update(turnJobs)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(and(eq(turnJobs.projectId, projectId), eq(turnJobs.status, "queued")))
      .returning({ userMessageId: turnJobs.userMessageId });
    if (cancelled.length) {
      await tx.update(messages).set({ status: "cancelled" }).where(inArray(messages.id, cancelled.map((c) => c.userMessageId)));
    }
    return { stopping: running.length > 0, cancelled: cancelled.length };
  });
}

/** Append events in order (only the job's worker writes them). */
export async function appendEvents(db: Db, jobId: string, events: Array<TurnEvent | { type: "end" }>): Promise<void> {
  if (!events.length) return;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(turnJobs)
      .set({ nextSeq: sql`${turnJobs.nextSeq} + ${events.length}` })
      .where(eq(turnJobs.id, jobId))
      .returning({ next: turnJobs.nextSeq });
    if (!row) return;
    const start = row.next - events.length;
    await tx.insert(turnEvents).values(events.map((event, i) => ({ jobId, seq: start + i, event: event as unknown as Record<string, unknown> })));
  });
}

export async function readEvents(db: Db, jobId: string, after: number, limit = 500): Promise<Array<{ seq: number; event: TurnEvent | { type: "end" } }>> {
  const rows = await db
    .select()
    .from(turnEvents)
    .where(and(eq(turnEvents.jobId, jobId), gt(turnEvents.seq, after)))
    .orderBy(asc(turnEvents.seq))
    .limit(limit);
  return rows.map((r) => ({ seq: r.seq, event: r.event as unknown as TurnEvent }));
}

/** Housekeeping: events of jobs that ended a while ago (the message keeps the final record). */
export async function sweep(db: Db): Promise<void> {
  await db.execute(sql`
    DELETE FROM turn_events e USING turn_jobs j
    WHERE e.job_id = j.id AND j.status NOT IN ('queued', 'running')
      AND j.finished_at < now() - ${`${EVENTS_GRACE_MS} milliseconds`}::interval`);
}

/**
 * The regular check on holds (D49), run by the worker. Ends paid jobs whose hold is stuck, which
 * returns it, and corrects a reserved total that has drifted from the open holds, logging both. A
 * job that's still live isn't touched, and free and exempt jobs hold nothing, so they aren't either.
 * Each job is re-checked under its own lock, and one that's busy is left for the next pass.
 */
export async function checkHolds(db: Db): Promise<{ failed: string[]; repaired: ReservationMismatch[] }> {
  const stuck = sql`j.hold_micro > 0 AND (
    (j.status = 'queued' AND j.created_at < now() - ${`${HOLD_STUCK_QUEUED_MS} milliseconds`}::interval)
    OR (j.status = 'running' AND (
      j.lease_expires_at < now() - ${`${HOLD_STUCK_LEASE_MS} milliseconds`}::interval
      OR j.started_at < now() - ${`${HOLD_MAX_RUN_MS} milliseconds`}::interval
    ))
  )`;
  const candidates = rowsOf<{ id: string }>(await db.execute(sql`SELECT j.id FROM turn_jobs j WHERE ${stuck}`));
  const failed: string[] = [];
  for (const { id } of candidates) {
    await db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const locked = rowsOf<{ id: string }>(await tx.execute(sql`SELECT j.id FROM turn_jobs j WHERE j.id = ${id} AND ${stuck} FOR UPDATE SKIP LOCKED`));
      if (!locked.length) return;
      const [job] = await tx.select().from(turnJobs).where(eq(turnJobs.id, id));
      await failJob(tx, job, STUCK_MESSAGE);
      failed.push(id);
      console.warn(`[holds] ended stuck job ${id}, returning its hold of ${job.holdMicro}`);
    });
  }
  const repaired = await repairReservations(db);
  for (const r of repaired) console.warn(`[holds] reserved total for user ${r.userId} was ${r.reservedMicro}, open holds ${r.openHoldsMicro}: corrected`);
  // A finished job still holding credit can't be corrected here, only reported: the trigger forbids it.
  for (const m of await findReservationMismatches(db)) console.warn(`[holds] mismatch left for user ${m.userId}: reserved ${m.reservedMicro}, holds ${m.openHoldsMicro}`);
  return { failed, repaired };
}

/** The project's running job and queued follow-ups, oldest first (for the workspace state). */
export async function activeJobs(db: Db, projectId: string): Promise<TurnJob[]> {
  return db
    .select()
    .from(turnJobs)
    .where(and(eq(turnJobs.projectId, projectId), inArray(turnJobs.status, ACTIVE)))
    .orderBy(asc(turnJobs.createdAt));
}

export async function getJob(db: Db, jobId: string): Promise<TurnJob | null> {
  const [job] = await db.select().from(turnJobs).where(eq(turnJobs.id, jobId)).limit(1);
  return job ?? null;
}
