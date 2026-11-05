import "server-only";

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { Db } from "@/server/db/client";
import type { TurnJob } from "@/server/db/schema";
import type { ModelClient } from "@/server/agent/model";
import { runTurn } from "@/server/agent/runner";
import { LeaseLostError } from "@/server/agent/turn-progress";
import type { TurnEvent, TurnMode } from "@/lib/turn-types";
import { MAX_ATTEMPTS, RENEW_MS, appendEvents, claimJob, failJob, jobContext, renewLease, sweep } from "./jobs";

/** Jobs one worker runs at once (different projects; one per project is enforced by the DB). */
const CONCURRENCY = 3;
const IDLE_POLL_MS = 1_000;
const FLUSH_MS = 200;

type Listener = () => void;

/**
 * Buffers a job's events and writes them in batches about every 200 ms: consecutive text
 * deltas are merged into one, and the full file map (sent once, at the end) is one row.
 * Done and error events flush at once.
 */
export class EventSink {
  private buffer: Array<TurnEvent | { type: "end" }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly write: (events: Array<TurnEvent | { type: "end" }>) => Promise<void>,
    private readonly onWritten: Listener = () => undefined,
  ) {}

  push(e: TurnEvent | { type: "end" }) {
    const last = this.buffer.at(-1);
    if (e.type === "text" && last?.type === "text") last.delta += e.delta;
    else this.buffer.push(e.type === "text" ? { ...e } : e);
    if (e.type === "done" || e.type === "error" || e.type === "end") void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.buffer;
    this.buffer = [];
    this.writing = this.writing.then(async () => {
      if (!batch.length) return;
      await this.write(batch).catch((e) => console.warn(`[worker] couldn't save ${batch.length} events: ${(e as Error).message}`));
      this.onWritten();
    });
    return this.writing;
  }
}

export interface WorkerOptions {
  getDb: () => Promise<Db>;
  model: () => ModelClient;
  concurrency?: number;
  /** Turn checks (tests). */
  deps?: Partial<Parameters<typeof runTurn>[0]>;
}

/**
 * The background turn worker (P18). Claims jobs with a lease, renews it every 5 s, turns a stop
 * request into an abort, streams events into turn_events and hands the runner a fenced job
 * context. A job whose worker died is claimed again after its lease expires and resumes from
 * its saved progress; after MAX_ATTEMPTS it ends with Retry.
 */
export class TurnWorker {
  readonly id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private running = new Set<string>();
  private stopped = false;
  private wake: (() => void) | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private lastSweep = 0;
  private loop: Promise<void> | null = null;

  constructor(private readonly opts: WorkerOptions) {}

  start() {
    this.loop ??= this.run();
    return this;
  }

  /** Something was queued: look now instead of at the next poll. */
  kick() {
    this.wake?.();
  }

  /** In-process listeners (the events route) hear about new events without waiting to poll. */
  onEvents(jobId: string, fn: Listener): () => void {
    let set = this.listeners.get(jobId);
    if (!set) this.listeners.set(jobId, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  async stop() {
    this.stopped = true;
    this.kick();
    await this.loop;
  }

  /** Claim and run jobs until stopped. Exposed for tests: one pass claims what it can. */
  async tick(): Promise<TurnJob[]> {
    const db = await this.opts.getDb();
    if (Date.now() - this.lastSweep > 60_000) {
      this.lastSweep = Date.now();
      await sweep(db).catch(() => undefined);
    }
    const started: TurnJob[] = [];
    while (this.running.size < (this.opts.concurrency ?? (Number(process.env.TURN_CONCURRENCY) || CONCURRENCY))) {
      const job = await claimJob(db, this.id);
      if (!job) break;
      this.running.add(job.id);
      started.push(job);
      console.log(`[worker] ${this.id} claimed job ${job.id} (project ${job.projectId.slice(0, 8)}, attempt ${job.attempt})`);
      void this.runJob(db, job).finally(() => {
        this.running.delete(job.id);
        this.kick();
      });
    }
    return started;
  }

  /** Wait until every job this worker started has finished (tests). */
  async idle(): Promise<void> {
    while (this.running.size) await new Promise((r) => setTimeout(r, 20));
  }

  private async run() {
    while (!this.stopped) {
      try {
        await this.tick();
      } catch (e) {
        console.warn(`[worker] ${(e as Error).message}`);
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, IDLE_POLL_MS);
        t.unref?.();
        this.wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
      this.wake = null;
    }
  }

  private async runJob(db: Db, job: TurnJob) {
    const notify = () => this.listeners.get(job.id)?.forEach((fn) => fn());
    const sink = new EventSink((events) => appendEvents(db, job.id, events), notify);
    if (job.attempt > MAX_ATTEMPTS) {
      await failJob(db, job, "This build was interrupted too many times. Retry to run it again.");
      sink.push({ type: "error", message: "This build was interrupted too many times. Retry to run it again." });
      sink.push({ type: "end" });
      await sink.flush();
      return;
    }
    const controller = new AbortController();
    let lost = false;
    const lease = setInterval(() => {
      void renewLease(db, job, this.id)
        .then((r) => {
          if (!r) {
            lost = true;
            controller.abort();
          } else if (r.stopRequested && !controller.signal.aborted) controller.abort();
        })
        .catch(() => undefined);
    }, RENEW_MS);
    lease.unref?.();
    try {
      const ctx = await jobContext(db, job, this.id, controller.signal);
      // A stop requested before the first renewal.
      if (job.stopRequested) controller.abort();
      await runTurn(
        { db, model: this.opts.model(), ...this.opts.deps, job: ctx },
        { projectId: job.projectId, userId: job.userId, mode: job.mode as TurnMode, userMessageId: job.userMessageId },
        (e) => sink.push(e),
      );
    } catch (e) {
      if (!(e instanceof LeaseLostError) && !lost) {
        console.warn(`[worker] job ${job.id} failed: ${(e as Error).message}`);
        await failJob(db, job, "The build failed to start. Retry to run it again.").catch(() => undefined);
        sink.push({ type: "error", message: "The build failed to start. Retry to run it again." });
      }
    } finally {
      clearInterval(lease);
      // A worker that lost its lease must not write: the new owner streams from here on.
      if (!lost) sink.push({ type: "end" });
      await sink.flush();
    }
  }
}

const g = globalThis as unknown as { __gbTurnWorker?: TurnWorker };

/** The process's worker, started once (hot reload re-imports modules; the singleton survives). */
export function ensureWorker(opts: WorkerOptions): TurnWorker {
  g.__gbTurnWorker ??= new TurnWorker(opts).start();
  return g.__gbTurnWorker;
}

export function currentWorker(): TurnWorker | undefined {
  return g.__gbTurnWorker;
}
