// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { createTestDb, type Db } from "@/server/db/client";
import { messages, projects, turnEvents, turnJobCalls, turnJobs, usageEvents } from "@/server/db/schema";
import { signInUser } from "@/server/auth/service";
import { createProjectFromPrompt } from "@/server/projects";
import { scriptedModel, type ScriptedReply } from "@/server/agent/fake-model";
import type { ModelClient, ModelRequest } from "@/server/agent/model";
import { runTurn } from "@/server/agent/runner";
import { loadFiles } from "@/server/agent/store";
import { LeaseLostError, type TurnJobContext } from "@/server/agent/turn-progress";
import type { TurnEvent, TurnRecord } from "@/lib/turn-types";
import { activeJobs, appendEvents, claimJob, enqueueTurn, jobContext, readEvents, stopProject } from "./jobs";
import { EventSink, TurnWorker } from "./worker";

let db: Db;
let userId: string;
let projectId: string;

beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: "0xabc", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  const p = await createProjectFromPrompt(db, userId, { prompt: "A page for our club", network: "celo-sepolia" });
  projectId = p.id;
});

const APP = 'export default function App() { return <main>Club</main>; }\n';
const BROKEN_APP = 'import { Missing } from "./Missing";\nexport default function App() { return <main><Missing /></main>; }\n';

/** A build that fails a check once, so the run covers setup, build rounds, checks and a fix pass. */
const SCRIPT: ScriptedReply[] = [
  { tools: [{ name: "set_plan", args: { summary: "A club page", steps: ["Write the page"] } }] },
  { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: BROKEN_APP } }] },
  { text: "Built the club page." },
  { tools: [{ name: "edit_file", args: { path: "src/App.tsx", edits: [{ search: BROKEN_APP, replace: APP }] } }] },
  { text: "Fixed." },
];

function worker(model: () => ModelClient) {
  return new TurnWorker({ getDb: async () => db, model, concurrency: 3 });
}

async function waitForStatus(jobId: string, statuses: string[], ms = 10_000) {
  const t0 = Date.now();
  for (;;) {
    const [j] = await db.select().from(turnJobs).where(eq(turnJobs.id, jobId));
    if (statuses.includes(j.status)) return j;
    if (Date.now() - t0 > ms) throw new Error(`job stuck in ${j.status}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("background turn jobs", { timeout: 60_000 }, () => {
  it("runs a queued turn, streams numbered events with an end marker, and clears the lock", async () => {
    const { client } = scriptedModel(SCRIPT);
    const job = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "Build the club page" });
    const w = worker(() => client);
    await w.tick();
    await w.idle();
    const done = await waitForStatus(job.id, ["done"]);
    expect(done.attempt).toBe(1);
    const events = await readEvents(db, job.id, -1);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    expect(events[0].event.type).toBe("start");
    expect(events.at(-1)?.event.type).toBe("end");
    expect(events.some((e) => e.event.type === "done")).toBe(true);
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(p.turnStartedAt).toBeNull();
    expect(p.status).toBe("ready");
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toBe(APP);
    expect(await db.select().from(turnJobCalls).where(eq(turnJobCalls.jobId, job.id))).toHaveLength(SCRIPT.length);
  });

  it("runs two prompts on one project one after the other, never together", async () => {
    const a = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "First" });
    const b = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "Second" });
    expect(await claimJob(db, "w1")).toMatchObject({ id: a.id });
    // The second can't start while the first holds the project.
    expect(await claimJob(db, "w2")).toBeNull();
    await db.update(turnJobs).set({ status: "done", finishedAt: new Date() }).where(eq(turnJobs.id, a.id));
    expect(await claimJob(db, "w2")).toMatchObject({ id: b.id });
    // The same message can't be queued twice (landing page auto-run, two tabs).
    const again = await enqueueTurn(db, { projectId, userId, mode: "build", userMessageId: b.userMessageId });
    expect(again.id).toBe(b.id);
  });

  it("stop ends the running turn without saving, and cancels queued follow-ups", async () => {
    // The first call completes (billed, and it writes a file); the second hangs until aborted.
    let n = 0;
    const slow: ModelClient = {
      async *stream(req: ModelRequest) {
        if (n++ === 0) {
          yield { type: "tool_call" as const, call: { id: "c1", name: "create_file", arguments: JSON.stringify({ path: "src/App.tsx", content: APP }) } };
          yield { type: "usage" as const, model: "deepseek-flash", inputTokens: 10, outputTokens: 1, cachedInputTokens: 0, callId: `slow-${Math.random()}` };
          yield { type: "done" as const, finishReason: "tool_calls" };
          return;
        }
        await new Promise((resolve, reject) => {
          if (req.signal?.aborted) return reject(new Error("aborted"));
          req.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          setTimeout(resolve, 20_000);
        });
      },
    };
    const first = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "Build it" });
    const queued = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "Then this" });
    const w = worker(() => slow);
    await w.tick();
    await new Promise((r) => setTimeout(r, 300));
    const result = await stopProject(db, projectId);
    expect(result).toEqual({ stopping: true, cancelled: 1 });
    // The lease renewal (every 5 s) turns the stop request into an abort.
    const stopped = await waitForStatus(first.id, ["stopped"], 15_000);
    expect(stopped.status).toBe("stopped");
    await w.idle();
    const msgs = await db.select().from(messages).where(eq(messages.projectId, projectId));
    expect(msgs.find((m) => m.id === queued.userMessageId)?.status).toBe("cancelled");
    const reply = msgs.find((m) => m.role === "assistant");
    expect(reply?.status).toBe("stopped");
    expect((reply?.meta as unknown as TurnRecord).status).toBe("stopped");
    expect(await loadFiles(db, projectId)).toEqual({}); // edits discarded
    // Usage already recorded stays; the aborted stream never produced a usage event (M6 note).
    expect((await db.select().from(usageEvents)).length).toBe(1);
    expect(await activeJobs(db, projectId)).toHaveLength(0);
  });

  it("resumes after a crash at every save point with the same result, no repeated model calls and no double billing", async () => {
    // Reference: one uninterrupted run.
    const straight = scriptedModel(SCRIPT);
    const ref = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "Build the club page" });
    const refRecord = await runJob(ref.id, straight.client);
    const refFiles = await loadFiles(db, projectId);
    const refUsage = (await db.select().from(usageEvents)).length;
    const refSaves = refRecord.saves;
    expect(straight.requests).toHaveLength(SCRIPT.length);

    for (let crashAfter = 1; crashAfter < refSaves; crashAfter++) {
      const fresh = await createTestDb();
      db = fresh;
      const user = await signInUser(db, { wallet: "0xabc", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
      userId = user.id;
      projectId = (await createProjectFromPrompt(db, userId, { prompt: "A page for our club", network: "celo-sepolia" })).id;
      const job = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "Build the club page" });

      const firstModel = scriptedModel(SCRIPT);
      await expect(runJob(job.id, firstModel.client, crashAfter)).rejects.toBeInstanceOf(LeaseLostError);
      // The worker died: its lease runs out and another worker resumes the job.
      await db.update(turnJobs).set({ leaseExpiresAt: sql`now() - interval '1 second'` }).where(eq(turnJobs.id, job.id));
      const logged = (await db.select().from(turnJobCalls).where(eq(turnJobCalls.jobId, job.id))).length;
      const secondModel = scriptedModel(SCRIPT.slice(logged));
      const resumed = await runJob(job.id, secondModel.client);

      const label = `crash after save ${crashAfter}`;
      expect(resumed.record.status, label).toBe("ready");
      expect(await loadFiles(db, projectId), label).toEqual(refFiles);
      if (JSON.stringify(withoutResume(resumed.record)) !== JSON.stringify(withoutResume(refRecord.record))) {
        const a = withoutResume(resumed.record) as unknown as Record<string, unknown>;
        const b = withoutResume(refRecord.record) as unknown as Record<string, unknown>;
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log("DIFF", label, k, JSON.stringify(a[k]).slice(0, 600), "|||", JSON.stringify(b[k]).slice(0, 600));
      }
      expect(withoutResume(resumed.record), label).toEqual(withoutResume(refRecord.record));
      expect((await db.select().from(usageEvents)).length, label).toBe(refUsage);
      // Responses committed before the crash were replayed, not asked again.
      expect(firstModel.requests.length - logged + secondModel.requests.length, label).toBeLessThanOrEqual(SCRIPT.length + 1 - logged + logged);
      expect(secondModel.requests.length, label).toBe(SCRIPT.length - logged);
      const [j] = await db.select().from(turnJobs).where(eq(turnJobs.id, job.id));
      expect(j.status, label).toBe("done");
      expect(j.attempt, label).toBe(2);
      // A resumed client gets a snapshot that replaces the half-finished view.
      expect(resumed.events.some((e) => e.type === "snapshot") || logged === 0, label).toBe(true);
    }
  });

  it("ends with a visible Retry when the saved progress can't be used", async () => {
    const job = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "Build the club page" });
    await expect(runJob(job.id, scriptedModel(SCRIPT).client, 3)).rejects.toBeInstanceOf(LeaseLostError);
    const [saved] = await db.select().from(turnJobs).where(eq(turnJobs.id, job.id));
    await db.update(turnJobs).set({ setup: { ...(saved.setup as Record<string, unknown>), v: 99 }, leaseExpiresAt: sql`now() - interval '1 second'` }).where(eq(turnJobs.id, job.id));
    const second = scriptedModel(SCRIPT);
    const { record } = await runJob(job.id, second.client);
    expect(record.status).toBe("error");
    expect(record.error).toMatch(/interrupted and couldn't continue.*Retry/);
    expect(second.requests).toHaveLength(0);
    const [j] = await db.select().from(turnJobs).where(eq(turnJobs.id, job.id));
    expect(j.status).toBe("error");
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(p.turnStartedAt).toBeNull();
  });

  it("refuses commits from a worker that lost its lease (fencing)", async () => {
    const job = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "x" });
    const claimed = (await claimJob(db, "old"))!;
    const ctx = await jobContext(db, claimed, "old", new AbortController().signal);
    // Another worker took the job over after the lease expired.
    await db.update(turnJobs).set({ leaseOwner: "new", attempt: 2 }).where(eq(turnJobs.id, job.id));
    await expect(ctx.commit(async () => "written")).rejects.toBeInstanceOf(LeaseLostError);
  });
});

describe("EventSink", () => {
  it("merges text deltas and flushes in order", async () => {
    const written: Array<Array<TurnEvent | { type: "end" }>> = [];
    const sink = new EventSink(async (batch) => void written.push(batch));
    sink.push({ type: "text", delta: "Hel" });
    sink.push({ type: "text", delta: "lo" });
    sink.push({ type: "log", line: "x" });
    sink.push({ type: "text", delta: "!" });
    await sink.flush();
    expect(written.flat()).toEqual([{ type: "text", delta: "Hello" }, { type: "log", line: "x" }, { type: "text", delta: "!" }]);
  });
  it("writes through appendEvents with gapless seqs", async () => {
    const job = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "x" });
    await appendEvents(db, job.id, [{ type: "log", line: "a" }, { type: "log", line: "b" }]);
    await appendEvents(db, job.id, [{ type: "end" }]);
    expect((await readEvents(db, job.id, 0)).map((e) => e.seq)).toEqual([1, 2]);
    expect(await db.select().from(turnEvents).where(eq(turnEvents.jobId, job.id))).toHaveLength(3);
  });
});

/** Claim the job and run it, optionally "crashing" (losing the process) right after the n-th save. */
async function runJob(jobId: string, model: ModelClient, crashAfter?: number) {
  const owner = `w-${Math.random()}`;
  const claimed = await claimJob(db, owner);
  if (!claimed || claimed.id !== jobId) throw new Error("not claimed");
  const ctx = await jobContext(db, claimed, owner, new AbortController().signal);
  let saves = 0;
  const wrapped: TurnJobContext = {
    ...ctx,
    commit: async (fn) => {
      const result = await ctx.commit(fn);
      saves++;
      // A crash after this commit: the process is gone before doing anything else.
      if (crashAfter !== undefined && saves === crashAfter) throw new LeaseLostError();
      return result;
    },
  };
  const events: TurnEvent[] = [];
  const record = await runTurn({ db, model, job: wrapped }, { projectId: claimed.projectId, userId: claimed.userId, mode: "build", userMessageId: claimed.userMessageId }, (e) => void events.push(e));
  return { record, saves, events };
}

/** The record minus the resume log line; tool step ids depend on the provider's call ids. */
function withoutResume(r: TurnRecord): TurnRecord {
  return { ...r, log: r.log.filter((l) => !l.startsWith("↻")), steps: r.steps.map((s) => ({ ...s, id: s.id.replace(/^(tool:\d+):.*$/, "$1") })) };
}
