import "server-only";

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { messages, projects, turnEvents, turnJobCalls, turnJobs, type TurnJob } from "@/server/db/schema";
import { LeaseLostError, type LoggedCall, type TurnJobContext, type TurnSetup } from "@/server/agent/turn-progress";
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

function rowsOf<T>(result: unknown): T[] {
  // postgres-js returns an array; PGlite returns { rows }.
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

/**
 * Queue a turn. The user message is saved now (queued), so a reload before the job starts
 * still shows the prompt. Answering an existing queued message (the landing page's first
 * prompt) reuses it; the unique index on user_message_id makes a double submit harmless.
 */
export async function enqueueTurn(
  db: Db,
  args: { projectId: string; userId: string; mode: TurnMode; prompt?: string; userMessageId?: string; intake?: boolean },
): Promise<TurnJob> {
  return db.transaction(async (tx) => {
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
        .values({ projectId: args.projectId, role: "user", content: prompt, status: "queued", meta: { mode: args.mode } })
        .returning({ id: messages.id });
      messageId = m.id;
    }
    const [job] = await tx.insert(turnJobs).values({ projectId: args.projectId, userId: args.userId, mode: args.mode, prompt, userMessageId: messageId }).returning();
    await tx.update(messages).set({ meta: sql`coalesce(${messages.meta}, '{}'::jsonb) || ${JSON.stringify({ mode: args.mode, jobId: job.id, ...(args.intake ? { intake: true } : {}) })}::jsonb` }).where(eq(messages.id, messageId));
    return job;
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
      await tx.update(projects).set({ turnStartedAt: new Date(), status: "building" }).where(eq(projects.id, job.projectId));
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
      const meta = { ...((m?.meta as Record<string, unknown> | null) ?? { kind: "turn", mode: job.mode, steps: [], log: [], changes: [], chargedMicro: 0 }), status: "error", error: message };
      await tx.update(messages).set({ status: "error", meta }).where(eq(messages.id, job.assistantMessageId));
    } else {
      await tx.update(messages).set({ status: "done" }).where(eq(messages.id, job.userMessageId));
      await tx.insert(messages).values({ projectId: job.projectId, role: "assistant", content: "", status: "error", meta: { kind: "turn", mode: job.mode, steps: [], log: [], changes: [], chargedMicro: 0, status: "error", error: message } });
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
