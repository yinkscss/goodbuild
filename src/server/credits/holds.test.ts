// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { balances, ledgerEntries, messages, projects, turnJobCalls, turnJobs, usageEvents, users, type TurnJob } from "@/server/db/schema";
import { scriptedModel, type ScriptedReply } from "@/server/agent/fake-model";
import { MODEL_IDS, type ModelClient } from "@/server/agent/model";
import { nameProject } from "@/server/agent/project-name";
import { runTurn } from "@/server/agent/runner";
import { loadFiles, recordUsage } from "@/server/agent/store";
import { LeaseLostError } from "@/server/agent/turn-progress";
import { HOLD_MAX_RUN_MS, HOLD_STUCK_LEASE_MS, HOLD_STUCK_QUEUED_MS, MAX_ATTEMPTS, checkHolds, claimJob, failJob, jobContext, startTurn, stopProject, type StartResult } from "@/server/jobs/jobs";
import { TurnWorker } from "@/server/jobs/worker";
import { chargedMicro, costMicro } from "@/lib/pricing";
import { BUDGET_MESSAGE, CAP_MESSAGE, FREE_RAN_OUT_MESSAGE, VERIFIED_CAP_MESSAGE, checkAiAllowance, decideDirectFunding } from "./cap";
import {
  CREDIT_HELD_MESSAGE,
  OUT_OF_CREDITS_BUILD_MESSAGE,
  OUT_OF_CREDITS_MESSAGE,
  PAID_HOLD_MICRO,
  PAID_MIN_DIRECT_MICRO,
  PAID_MIN_START_MICRO,
  ensureHold,
  findReservationMismatches,
  repairReservations,
  usageKey,
  worstCaseCallMicro,
} from "./holds";
import { balanceFromEntriesMicro, findBalanceMismatches, postLedgerEntry } from "./ledger";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

/**
 * M3 (D49): holds and charging for paid credit. These try to break it: every test ends by checking
 * the money still adds up, and the race tests only mean anything on real Postgres.
 */

const APP = "export default function App() { return <main>Club</main>; }\n";
const OK_BUILD: ScriptedReply[] = [
  { tools: [{ name: "set_plan", args: { summary: "A club page", steps: ["Write the page"] } }] },
  { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP } }] },
  { text: "Built the club page." },
];

async function failure(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const e = error as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ""}`;
  }
  throw new Error("expected this to be refused, and it succeeded");
}

function queued(result: StartResult): TurnJob {
  if ("refused" in result) throw new Error(`refused: ${result.refused.reason}`);
  return result.job;
}

function refusal(result: StartResult) {
  if (!("refused" in result)) throw new Error(`expected a refusal, got a ${result.job.funding} job`);
  return result.refused;
}

describe.each(testBackends())("holds and charging on $name", (backend) => {
  let database: TestDatabase;
  let db: Db;

  beforeEach(async () => {
    database = await backend.open();
    db = database.db;
    await database.migrate(MIGRATIONS);
  }, 120_000);

  afterEach(async () => {
    await database?.close();
    vi.restoreAllMocks();
  });

  async function newUser(wallet = `0x${randomUUID().replaceAll("-", "")}`) {
    const [u] = await db.insert(users).values({ wallet }).returning({ id: users.id });
    const projectId = await project(u.id);
    return { userId: u.id, projectId };
  }

  async function project(ownerId: string) {
    const [p] = await db.insert(projects).values({ ownerId, name: "P", chainId: 11142220 }).returning({ id: projects.id });
    return p.id;
  }

  const deposit = (userId: string, amountMicro: number) => postLedgerEntry(db, { userId, kind: "deposit", amountMicro, idempotencyKey: `topup:${randomUUID()}` });

  const spendFree = (userId: string, charged = 200_000) =>
    db.insert(usageEvents).values({ userId, callId: randomUUID(), model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: 0, chargedMicro: charged, markupBps: 2500, funding: "free" });

  /** Someone whose free AI is gone, with this much credit. */
  async function payer(credit: number) {
    const user = await newUser();
    await spendFree(user.userId);
    if (credit) await deposit(user.userId, credit);
    return user;
  }

  const start = (userId: string, projectId: string, env: Record<string, string | undefined> = {}) => startTurn(db, { projectId, userId, mode: "build", prompt: "Build it" }, env);

  async function money(userId: string) {
    const [b] = await db.select().from(balances).where(eq(balances.userId, userId));
    const jobs = await db.select().from(turnJobs).where(eq(turnJobs.userId, userId));
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId));
    const usage = await db.select().from(usageEvents).where(and(eq(usageEvents.userId, userId), eq(usageEvents.funding, "paid")));
    return {
      balance: b?.balanceMicro ?? 0,
      reserved: b?.reservedMicro ?? 0,
      available: (b?.balanceMicro ?? 0) - (b?.reservedMicro ?? 0),
      open: jobs.filter((j) => ["queued", "running"].includes(j.status)).reduce((n, j) => n + j.holdMicro, 0),
      released: jobs.reduce((n, j) => n + j.releasedMicro, 0),
      charged: usage.reduce((n, u) => n + u.chargedMicro, 0),
      debits: entries.filter((e) => e.kind === "usage").reduce((n, e) => n + e.amountMicro, 0),
      entries: entries.length,
    };
  }

  /** The rules that must hold after anything at all. */
  async function expectBooksBalance(userId?: string) {
    expect(await findBalanceMismatches(db)).toEqual([]);
    expect(await findReservationMismatches(db)).toEqual([]);
    if (userId) {
      const m = await money(userId);
      expect(m.reserved).toBe(m.open);
      expect(m.debits + m.charged).toBe(0);
      expect(m.balance).toBe(await balanceFromEntriesMicro(db, userId));
    }
  }

  /** Claim a job and run it as the worker does. `crashAfter` kills the worker before that commit. */
  async function runJob(jobId: string, client: ModelClient, crashAfter = Infinity) {
    const owner = `worker-${randomUUID().slice(0, 8)}`;
    const claimed = await claimJob(db, owner);
    expect(claimed?.id).toBe(jobId);
    const ctx = await jobContext(db, claimed!, owner, new AbortController().signal);
    let commits = 0;
    const real = ctx.commit;
    ctx.commit = (fn) => {
      if (++commits > crashAfter) throw new LeaseLostError();
      return real(fn);
    };
    const record = await runTurn({ db, model: client, job: ctx }, { projectId: claimed!.projectId, userId: claimed!.userId, mode: "build", userMessageId: claimed!.userMessageId }, () => undefined);
    return record;
  }

  const jobRow = async (id: string) => (await db.select().from(turnJobs).where(eq(turnJobs.id, id)))[0];

  describe("free first, then paid", () => {
    it("someone with free AI left and credit gets a free build, with nothing set aside", async () => {
      const a = await newUser();
      await deposit(a.userId, 5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      expect([job.funding, job.holdMicro]).toEqual(["free", 0]);
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000, reserved: 0 });
    });

    it("when free AI is used up, a build sets aside $1 and the balance itself doesn't move", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      expect([job.funding, job.holdMicro, job.status]).toEqual(["paid", PAID_HOLD_MICRO, "queued"]);
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000, reserved: 1_000_000, available: 4_000_000, entries: 1 });
      await expectBooksBalance(a.userId);
    });

    it("with less than $1 it sets aside what there is, down to the $0.35 minimum, and refuses below that", async () => {
      const a = await payer(PAID_MIN_START_MICRO);
      expect(queued(await start(a.userId, a.projectId)).holdMicro).toBe(PAID_MIN_START_MICRO);

      const b = await payer(PAID_MIN_START_MICRO - 1);
      expect(refusal(await start(b.userId, b.projectId))).toEqual({ allowed: false, reason: "out_of_credits", message: OUT_OF_CREDITS_MESSAGE });
      expect(await db.select().from(turnJobs).where(eq(turnJobs.userId, b.userId))).toEqual([]);
    });

    it("a verified person at their limit, and anyone when the free trial is full, build on credit", async () => {
      const a = await newUser();
      await db.update(users).set({ verifiedAt: new Date(), goodidRoot: "0xr" }).where(eq(users.id, a.userId));
      await spendFree(a.userId, 700_000);
      await deposit(a.userId, 2_000_000);
      expect(queued(await start(a.userId, a.projectId)).funding).toBe("paid");

      const b = await newUser();
      await deposit(b.userId, 2_000_000);
      expect(queued(await start(b.userId, b.projectId, { FREE_AI_BUDGET_MICRO: "0" })).funding).toBe("paid");
    });

    it("someone who has paid never sees a free-limit message at build start, in any of the three limits", async () => {
      const a = await payer(100_000);
      expect(refusal(await start(a.userId, a.projectId)).message).toBe(OUT_OF_CREDITS_MESSAGE);

      const b = await newUser();
      await db.update(users).set({ verifiedAt: new Date() }).where(eq(users.id, b.userId));
      await spendFree(b.userId, 700_000);
      await deposit(b.userId, 100_000);
      expect(refusal(await start(b.userId, b.projectId)).message).toBe(OUT_OF_CREDITS_MESSAGE);

      const c = await newUser();
      await deposit(c.userId, 100_000);
      expect(refusal(await start(c.userId, c.projectId, { FREE_AI_BUDGET_MICRO: "0" })).message).toBe(OUT_OF_CREDITS_MESSAGE);
    });

    it("a user who never paid keeps the existing messages", async () => {
      const a = await payer(0);
      expect(refusal(await start(a.userId, a.projectId))).toEqual({ allowed: false, reason: "free_limit", message: CAP_MESSAGE });
      const b = await newUser();
      await db.update(users).set({ verifiedAt: new Date() }).where(eq(users.id, b.userId));
      await spendFree(b.userId, 700_000);
      expect(refusal(await start(b.userId, b.projectId))).toEqual({ allowed: false, reason: "verified_limit", message: VERIFIED_CAP_MESSAGE });
      const c = await newUser();
      expect(refusal(await start(c.userId, c.projectId, { FREE_AI_BUDGET_MICRO: "0" }))).toEqual({ allowed: false, reason: "budget_full", message: BUDGET_MESSAGE });
    });

    it("credit that's all set aside says so, rather than saying the credit is gone", async () => {
      const a = await payer(1_200_000);
      queued(await start(a.userId, a.projectId));
      expect(refusal(await start(a.userId, await project(a.userId)))).toEqual({ allowed: false, reason: "credit_held", message: CREDIT_HELD_MESSAGE });
    });

    it("a negative balance can't start a build", async () => {
      const a = await payer(1_000_000);
      await postLedgerEntry(db, { userId: a.userId, kind: "adjust", amountMicro: -1_500_000, allowNegative: true, idempotencyKey: `chargeback:${randomUUID()}` });
      expect(refusal(await start(a.userId, a.projectId)).reason).toBe("out_of_credits");
    });

    it("exempt wallets set nothing aside, whatever their balance", async () => {
      const wallet = "0x00000000000000000000000000000000000e4e47";
      const a = await newUser(wallet);
      await spendFree(a.userId);
      await deposit(a.userId, 5_000_000);
      const job = queued(await start(a.userId, a.projectId, { UNCAPPED_WALLETS: wallet }));
      expect([job.funding, job.holdMicro]).toEqual(["exempt", 0]);
      expect((await money(a.userId)).reserved).toBe(0);
    });

    it("a double submit of one message takes one hold, even when the second can't afford another", async () => {
      const a = await payer(1_000_000);
      const first = queued(await start(a.userId, a.projectId));
      const again = queued(await startTurn(db, { projectId: a.projectId, userId: a.userId, mode: "build", userMessageId: first.userMessageId }, {}));
      expect(again.id).toBe(first.id);
      expect(await money(a.userId)).toMatchObject({ reserved: 1_000_000 });
    });

    it("free builds keep the one-project-at-a-time rule, and it isn't turned into a paid build", async () => {
      const a = await newUser();
      await deposit(a.userId, 5_000_000);
      queued(await start(a.userId, a.projectId));
      expect(refusal(await start(a.userId, await project(a.userId))).reason).toBe("one_build_at_a_time");
    });

    it("paid builds on different projects can run together, each with its own hold", async () => {
      const a = await payer(2_500_000);
      queued(await start(a.userId, a.projectId));
      queued(await start(a.userId, await project(a.userId)));
      expect(await money(a.userId)).toMatchObject({ reserved: 2_000_000, available: 500_000 });
      await expectBooksBalance(a.userId);
    });

    it("the settings can't make a hold smaller than the minimum, or be nonsense", async () => {
      const a = await payer(5_000_000);
      expect(queued(await start(a.userId, a.projectId, { PAID_HOLD_MICRO: "1", PAID_MIN_START_MICRO: "500000" })).holdMicro).toBe(500_000);
      const b = await payer(5_000_000);
      expect(queued(await start(b.userId, b.projectId, { PAID_HOLD_MICRO: "-5", PAID_MIN_START_MICRO: "1.5" })).holdMicro).toBe(PAID_HOLD_MICRO);
    });
  });

  describe("charging", () => {
    const call = (over: Partial<Parameters<typeof recordUsage>[1]> & { userId: string; projectId: string }) => ({
      messageId: null,
      callId: randomUUID(),
      model: "claude-sonnet-5-5",
      inputTokens: 10_000,
      outputTokens: 2_000,
      cachedInputTokens: 0,
      funding: "paid" as const,
      ...over,
    });

    it("takes cost plus 25% from the balance and out of the hold", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      const cost = await recordUsage(db, call({ ...a, jobId: job.id }));
      const provider = costMicro("claude-sonnet-5-5", { inputTokens: 10_000, outputTokens: 2_000 });
      expect(cost).toEqual({ providerCostMicro: provider, chargedMicro: Math.ceil(provider * 1.25), inserted: true });
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000 - cost.chargedMicro, reserved: 1_000_000 - cost.chargedMicro, available: 4_000_000, charged: cost.chargedMicro });
      await expectBooksBalance(a.userId);
    });

    it("a replayed call charges once, and reports a cost but not an insert", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      const args = call({ ...a, jobId: job.id });
      const first = await recordUsage(db, args);
      const second = await recordUsage(db, args);
      const third = await recordUsage(db, { ...args, funding: "paid", jobId: null });
      expect(first.inserted).toBe(true);
      expect(second).toEqual({ ...first, inserted: false });
      expect(third.inserted).toBe(false);
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000 - first.chargedMicro, reserved: 1_000_000 - first.chargedMicro, entries: 2 });
      await expectBooksBalance(a.userId);
    });

    it("the usage row and the charge commit or roll back together", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      const args = call({ ...a, jobId: job.id });
      await expect(
        db.transaction(async (tx) => {
          await recordUsage(tx as unknown as Db, args);
          throw new Error("crash before commit");
        }),
      ).rejects.toThrow("crash before commit");
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000, reserved: 1_000_000, charged: 0, entries: 1 });
      // A later try still charges, once.
      expect((await recordUsage(db, args)).inserted).toBe(true);
      expect(await money(a.userId)).toMatchObject({ entries: 2 });
      await expectBooksBalance(a.userId);
    });

    it("free, exempt and platform usage post no ledger entry", async () => {
      const a = await newUser();
      await deposit(a.userId, 5_000_000);
      for (const funding of ["free", "exempt", "platform"] as const) await recordUsage(db, call({ ...a, funding }));
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000, entries: 1 });
    });

    it("a call that costs more than is held is still posted, and the hold stops at zero", async () => {
      const a = await payer(350_000);
      const job = queued(await start(a.userId, a.projectId));
      const big = await recordUsage(db, call({ ...a, jobId: job.id, inputTokens: 100_000, outputTokens: 50_000 }));
      expect(big.chargedMicro).toBeGreaterThan(350_000);
      expect((await jobRow(job.id)).holdMicro).toBe(0);
      expect(await money(a.userId)).toMatchObject({ balance: 350_000 - big.chargedMicro, reserved: 0 });
      await expectBooksBalance(a.userId);
    });

    it("a very long provider call id still gets one ledger key", async () => {
      expect(usageKey("short")).toBe("usage:short");
      const long = "x".repeat(5_000);
      expect(usageKey(long).length).toBeLessThanOrEqual(200);
      const a = await payer(5_000_000);
      const args = call({ ...a, callId: long });
      await recordUsage(db, args);
      await recordUsage(db, args);
      expect((await money(a.userId)).entries).toBe(2);
    });

    it("a call with no tokens charges nothing and posts nothing", async () => {
      const a = await payer(5_000_000);
      await recordUsage(db, call({ ...a, inputTokens: 0, outputTokens: 0 }));
      expect((await money(a.userId)).entries).toBe(1);
    });
  });

  describe("calls outside a build", () => {
    it("free AI pays first, then credit if there's enough for one call, and otherwise they're refused as before", async () => {
      const a = await newUser();
      await deposit(a.userId, 5_000_000);
      expect(await decideDirectFunding(db, a.userId, {})).toBe("free");
      expect(await checkAiAllowance(db, { userId: a.userId }, {})).toEqual({ allowed: true });

      const b = await payer(PAID_MIN_DIRECT_MICRO);
      expect(await decideDirectFunding(db, b.userId, {})).toBe("paid");
      expect(await checkAiAllowance(db, { userId: b.userId }, {})).toEqual({ allowed: true });

      const c = await payer(PAID_MIN_DIRECT_MICRO - 1);
      expect(await decideDirectFunding(db, c.userId, {})).toBe("free");
      expect(await checkAiAllowance(db, { userId: c.userId }, {})).toEqual({ allowed: false, reason: "out_of_credits", message: OUT_OF_CREDITS_MESSAGE });

      const d = await payer(0);
      expect(await decideDirectFunding(db, d.userId, {})).toBe("free");
      expect(await checkAiAllowance(db, { userId: d.userId }, {})).toEqual({ allowed: false, reason: "free_limit", message: CAP_MESSAGE });
    });

    it("the minimum covers the largest upload or visual check, at the strong model's price", () => {
      const image = { role: "user", content: [{ type: "text", text: "x".repeat(2_000) }, { type: "image" }] };
      expect(worstCaseCallMicro(MODEL_IDS.strong, { messages: [image], maxTokens: 700 })).toBeLessThanOrEqual(PAID_MIN_DIRECT_MICRO);
    });

    it("credit set aside for a build isn't spent on them", async () => {
      const a = await payer(1_000_000);
      queued(await start(a.userId, a.projectId));
      expect(await decideDirectFunding(db, a.userId, {})).toBe("free");
      expect((await checkAiAllowance(db, { userId: a.userId }, {})).allowed).toBe(false);
    });

    it("a paid call outside a build debits directly, once", async () => {
      const a = await payer(1_000_000);
      const args = { ...a, messageId: null, callId: "asset-1", model: "deepseek-flash", inputTokens: 1_000, outputTokens: 100, cachedInputTokens: 0, funding: "paid" as const };
      const first = await recordUsage(db, args);
      await recordUsage(db, args);
      expect(await money(a.userId)).toMatchObject({ balance: 1_000_000 - first.chargedMicro, reserved: 0, entries: 2 });
      await expectBooksBalance(a.userId);
    });
  });

  describe("a whole paid build", () => {
    it("charges every call, and what's left of the hold goes back once", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      const record = await runJob(job.id, scriptedModel(OK_BUILD).client);
      expect(record.status).toBe("ready");
      const row = await jobRow(job.id);
      const m = await money(a.userId);
      expect(m.charged).toBeGreaterThan(0);
      expect(m.charged).toBe(record.chargedMicro);
      expect(m.balance).toBe(5_000_000 - m.charged);
      expect([row.status, row.holdMicro, row.releasedMicro]).toEqual(["done", 0, 1_000_000 - m.charged]);
      expect(m).toMatchObject({ reserved: 0, available: m.balance });
      expect((await db.select().from(usageEvents).where(eq(usageEvents.funding, "paid"))).length).toBe(3);
      await expectBooksBalance(a.userId);
    });

    it("a crash at every save point charges exactly what a straight run charges, and releases once", async () => {
      const straight = await payer(5_000_000);
      const refJob = queued(await start(straight.userId, straight.projectId));
      await runJob(refJob.id, scriptedModel(OK_BUILD).client);
      const expected = (await money(straight.userId)).charged;

      for (let crashAfter = 0; crashAfter < 9; crashAfter++) {
        const a = await payer(5_000_000);
        const job = queued(await start(a.userId, a.projectId));
        const label = `crash after commit ${crashAfter}`;
        // A scripted model's call ids change per run, as a real provider's would.
        const first = await runJob(job.id, scriptedModel(OK_BUILD).client, crashAfter).catch((e) => e);
        const row = await jobRow(job.id);
        if (row.status === "running") {
          expect(first, label).toBeInstanceOf(LeaseLostError);
          await db.update(turnJobs).set({ leaseExpiresAt: sql`now() - interval '1 second'` }).where(eq(turnJobs.id, job.id));
          const logged = (await db.select().from(turnJobCalls).where(eq(turnJobCalls.jobId, job.id))).length;
          await runJob(job.id, scriptedModel(OK_BUILD.slice(logged)).client);
        }
        const done = await jobRow(job.id);
        const m = await money(a.userId);
        expect(done.status, label).toBe("done");
        expect(m.charged, label).toBe(expected);
        expect(done.holdMicro, label).toBe(0);
        expect(done.releasedMicro, label).toBe(1_000_000 - expected);
        expect(m, label).toMatchObject({ balance: 5_000_000 - expected, reserved: 0 });
        await expectBooksBalance(a.userId);
      }
    }, 240_000);

    it("a build that crashes too many times ends, and its hold goes back once", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      await runJob(job.id, scriptedModel(OK_BUILD).client, 5).catch(() => undefined);
      const charged = (await money(a.userId)).charged;
      await db.update(turnJobs).set({ attempt: MAX_ATTEMPTS, leaseExpiresAt: sql`now() - interval '1 second'` }).where(eq(turnJobs.id, job.id));
      const worker = new TurnWorker({ getDb: async () => db, model: () => scriptedModel([]).client });
      await worker.tick();
      await worker.idle();
      const row = await jobRow(job.id);
      expect(row.status).toBe("error");
      expect(row.releasedMicro).toBe(1_000_000 - charged);
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000 - charged, reserved: 0 });
      await expectBooksBalance(a.userId);
    });

    it("a failed model call ends the build and returns the hold", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      const client: ModelClient = {
        async *stream() {
          throw new Error("provider exploded");
        },
      };
      const record = await runJob(job.id, client);
      expect(record.status).toBe("error");
      expect((await jobRow(job.id)).releasedMicro).toBe(1_000_000);
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000, reserved: 0 });
    });

    it("stopping a running build and cancelling a queued one both return their holds", async () => {
      const a = await payer(5_000_000);
      const running = queued(await start(a.userId, a.projectId));
      const waiting = queued(await start(a.userId, a.projectId));
      expect((await money(a.userId)).reserved).toBe(2_000_000);
      const owner = "w";
      const claimed = (await claimJob(db, owner))!;
      expect(claimed.id).toBe(running.id);
      await stopProject(db, a.projectId);
      expect((await jobRow(waiting.id)).status).toBe("cancelled");
      expect((await jobRow(waiting.id)).releasedMicro).toBe(1_000_000);
      expect((await money(a.userId)).reserved).toBe(1_000_000);
      const controller = new AbortController();
      controller.abort();
      const ctx = await jobContext(db, claimed, owner, controller.signal);
      const record = await runTurn({ db, model: scriptedModel(OK_BUILD).client, job: ctx }, { projectId: a.projectId, userId: a.userId, mode: "build", userMessageId: claimed.userMessageId }, () => undefined);
      expect(record.status).toBe("stopped");
      expect((await jobRow(running.id)).releasedMicro).toBe(1_000_000);
      expect(await money(a.userId)).toMatchObject({ reserved: 0, balance: 5_000_000 });
      await expectBooksBalance(a.userId);
    });
  });

  describe("a build stopped at its hold doesn't overspend", () => {
    /** Calls that each really use their whole output limit, reported as the tier's own model. */
    const costly = (n: number): ScriptedReply[] =>
      Array.from({ length: n }, (_, i) => ({
        tools: [{ name: "create_file", args: { path: i === 0 ? "src/App.tsx" : `src/F${i}.tsx`, content: i === 0 ? APP : "x" } }],
        usage: { input: 2_000, output: 16_000 },
      }));

    it("stops before the call it can't cover, however much the calls cost, with the balance never below zero", async () => {
      const a = await payer(PAID_MIN_START_MICRO);
      const job = queued(await start(a.userId, a.projectId));
      const model = scriptedModel(costly(25));
      const record = await runJob(job.id, model.client);
      const m = await money(a.userId);
      expect(record.status).toBe("error");
      expect(record.error).toBe(OUT_OF_CREDITS_BUILD_MESSAGE);
      expect(model.requests.length).toBeLessThan(25);
      expect(m.charged).toBeGreaterThan(0);
      expect(m.balance).toBeGreaterThanOrEqual(0);
      expect(m.charged).toBeLessThanOrEqual(PAID_MIN_START_MICRO);
      expect(m.reserved).toBe(0);
      const row = await jobRow(job.id);
      expect([row.status, row.error, row.holdMicro]).toEqual(["error", OUT_OF_CREDITS_BUILD_MESSAGE, 0]);
      expect(row.releasedMicro).toBe(PAID_MIN_START_MICRO - m.charged);
      // It stops cleanly: nothing half-written reaches the project, and its turn lock is free.
      expect(await loadFiles(db, a.projectId)).toEqual({});
      expect((await db.select().from(projects).where(eq(projects.id, a.projectId)))[0].turnStartedAt).toBeNull();
      await expectBooksBalance(a.userId);
    });

    it("a hold that runs out is extended from the rest of the balance", async () => {
      const a = await payer(2_500_000);
      const job = queued(await start(a.userId, a.projectId, { PAID_HOLD_MICRO: "350000" }));
      expect(job.holdMicro).toBe(350_000);
      // Twelve calls cost more than $0.35, and the rest of the balance covers them.
      const record = await runJob(job.id, scriptedModel([...costly(15), { text: "Done." }]).client);
      const m = await money(a.userId);
      expect(record.status).toBe("ready");
      expect(m.charged).toBeGreaterThan(350_000);
      expect(m).toMatchObject({ balance: 2_500_000 - m.charged, reserved: 0 });
      await expectBooksBalance(a.userId);
    });

    it("an extension can't take what another build has set aside", async () => {
      const a = await payer(1_400_000);
      const other = queued(await start(a.userId, await project(a.userId)));
      const job = queued(await start(a.userId, a.projectId));
      expect([other.holdMicro, job.holdMicro]).toEqual([1_000_000, 400_000]);
      // Claim the one under test, leaving the other queued with its hold.
      await db.update(turnJobs).set({ createdAt: sql`now() + interval '1 hour'` }).where(eq(turnJobs.id, other.id));
      const record = await runJob(job.id, scriptedModel(costly(25)).client);
      expect(record.error).toBe(OUT_OF_CREDITS_BUILD_MESSAGE);
      const m = await money(a.userId);
      expect(m.charged).toBeLessThanOrEqual(400_000);
      expect((await jobRow(other.id)).holdMicro).toBe(1_000_000);
      expect(m.reserved).toBe(1_000_000);
      expect(m.available).toBeGreaterThanOrEqual(0);
      await expectBooksBalance(a.userId);
    });

    it("the check runs before every live call, including the memory call, and replays never run it", async () => {
      const a = await payer(1_000_000);
      for (let i = 0; i < 40; i++) await db.insert(messages).values({ projectId: a.projectId, role: i % 2 ? "assistant" : "user", content: `old message ${i}`, status: "done" });
      const job = queued(await start(a.userId, a.projectId));
      // Nothing left to reserve or extend from, so even the first call can't be covered.
      await db.update(turnJobs).set({ holdMicro: 0 }).where(eq(turnJobs.id, job.id));
      await postLedgerEntry(db, { userId: a.userId, kind: "adjust", amountMicro: -1_000_000, idempotencyKey: `x:${randomUUID()}` });
      const model = scriptedModel(OK_BUILD);
      const record = await runJob(job.id, model.client);
      expect(model.requests).toHaveLength(0);
      expect(record.error).toBe(OUT_OF_CREDITS_BUILD_MESSAGE);
      expect(await money(a.userId)).toMatchObject({ balance: 0, reserved: 0, charged: 0 });
    });

    it("a resumed build doesn't re-check or re-charge calls it already paid for", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      // Commits: the reply, the setup, then a check and a saved response per call.
      await runJob(job.id, scriptedModel(OK_BUILD).client, 5).catch(() => undefined);
      const before = await money(a.userId);
      expect(before.charged).toBeGreaterThan(0);
      await db.update(turnJobs).set({ leaseExpiresAt: sql`now() - interval '1 second'` }).where(eq(turnJobs.id, job.id));
      const logged = (await db.select().from(turnJobCalls).where(eq(turnJobCalls.jobId, job.id))).length;
      const second = scriptedModel(OK_BUILD.slice(logged));
      await runJob(job.id, second.client);
      expect(second.requests).toHaveLength(OK_BUILD.length - logged);
      expect((await money(a.userId)).entries).toBe(1 + OK_BUILD.length);
      await expectBooksBalance(a.userId);
    });

    it("a model reporting a dearer id than its tier is the one way past the estimate: it's posted, and the next call stops", async () => {
      const a = await payer(PAID_MIN_START_MICRO);
      const job = queued(await start(a.userId, a.projectId));
      // The cheap tier reporting a name not in the price table is billed at the strong fallback price.
      const record = await runJob(job.id, scriptedModel(costly(25), { cheap: "deepseek-unknown" }).client);
      const m = await money(a.userId);
      expect(record.error).toBe(OUT_OF_CREDITS_BUILD_MESSAGE);
      expect(m.reserved).toBe(0);
      expect(m.charged).toBeLessThanOrEqual(PAID_MIN_START_MICRO + chargedMicro(costMicro("deepseek-unknown", { inputTokens: 2_000, outputTokens: 16_000 })));
      await expectBooksBalance(a.userId);
    });

    it("every model GoodBuild asks for has its own price, so its estimate is the real price", () => {
      expect(worstCaseCallMicro(MODEL_IDS.cheap, { messages: [], maxTokens: 16_000 })).toBeLessThan(worstCaseCallMicro(MODEL_IDS.strong, { messages: [], maxTokens: 16_000 }));
      expect(costMicro(MODEL_IDS.cheap, { inputTokens: 0, outputTokens: 1_000_000 })).toBe(1_200_000);
      expect(costMicro(MODEL_IDS.strong, { inputTokens: 0, outputTokens: 1_000_000 })).toBe(10_000_000);
    });

    it("the estimate is at least the charge for a call that fills its limit, with images and tools", () => {
      const request = { messages: [{ role: "system", content: "s".repeat(3_000) }, { role: "user", content: [{ type: "text", text: "t".repeat(9_000) }, { type: "image" }] }, { role: "assistant", content: null, tool_calls: [{ function: { name: "edit_file", arguments: "a".repeat(5_000) } }] }, { role: "tool", tool_call_id: "c1", content: "r".repeat(1_000) }], tools: [{ name: "x", parameters: {} }], maxTokens: 16_000 };
      const worst = worstCaseCallMicro(MODEL_IDS.strong, request);
      // 18,000 characters at the usual 2.5 a token, one image, and the full output limit.
      const charge = chargedMicro(costMicro(MODEL_IDS.strong, { inputTokens: Math.ceil(18_000 / 2.5) + 1_600, outputTokens: 16_000 }));
      expect(worst).toBeGreaterThanOrEqual(charge);
    });

    it("ensureHold leaves a job alone when it holds enough, and a free job always passes", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      expect(await db.transaction((tx) => ensureHold(tx as unknown as Db, job.id, 1_000_000))).toBe(true);
      expect((await jobRow(job.id)).holdMicro).toBe(1_000_000);
      expect(await db.transaction((tx) => ensureHold(tx as unknown as Db, job.id, 1_500_000))).toBe(true);
      expect((await jobRow(job.id)).holdMicro).toBe(1_500_000);
      expect(await db.transaction((tx) => ensureHold(tx as unknown as Db, job.id, 5_000_001))).toBe(false);
      expect((await jobRow(job.id)).holdMicro).toBe(1_500_000);
      expect(await db.transaction((tx) => ensureHold(tx as unknown as Db, job.id, 5_000_000))).toBe(true);
      expect(await money(a.userId)).toMatchObject({ reserved: 5_000_000, available: 0 });
      await expectBooksBalance(a.userId);
    });
  });

  describe("the worker's start check", () => {
    it("lets a paid job start, and still refuses a platform job", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      expect(await checkAiAllowance(db, { userId: a.userId, startingJobId: job.id, funding: "paid" }, {})).toEqual({ allowed: true });
      expect(await checkAiAllowance(db, { userId: a.userId, startingJobId: job.id, funding: "platform" }, {})).toMatchObject({ allowed: false, reason: "funding_unavailable" });
    });

    it("a free job overtaken by the free limit tells someone with credit to retry, not to verify", async () => {
      const a = await newUser();
      await deposit(a.userId, 5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      expect(job.funding).toBe("free");
      await spendFree(a.userId);
      const refused = await checkAiAllowance(db, { userId: a.userId, startingJobId: job.id, funding: "free" }, {});
      expect(refused).toEqual({ allowed: false, reason: "free_limit", message: FREE_RAN_OUT_MESSAGE });
      // The retry then runs on credit.
      await failJob(db, job, FREE_RAN_OUT_MESSAGE);
      expect(queued(await start(a.userId, a.projectId)).funding).toBe("paid");
    });

    it("the same overtaken job with no credit keeps today's message", async () => {
      const a = await newUser();
      const job = queued(await start(a.userId, a.projectId));
      await spendFree(a.userId);
      expect(await checkAiAllowance(db, { userId: a.userId, startingJobId: job.id, funding: "free" }, {})).toEqual({ allowed: false, reason: "free_limit", message: CAP_MESSAGE });
    });
  });

  describe("release", () => {
    it.each(["done", "error", "stopped", "cancelled"])("a job ending as %s gives back what's left, once", async (status) => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      const cost = await recordUsage(db, { ...a, jobId: job.id, messageId: null, callId: randomUUID(), model: "deepseek-flash", inputTokens: 1_000, outputTokens: 100, cachedInputTokens: 0, funding: "paid" });
      await db.update(turnJobs).set({ status }).where(eq(turnJobs.id, job.id));
      await db.update(turnJobs).set({ status }).where(eq(turnJobs.id, job.id));
      await db.update(turnJobs).set({ status: "error" }).where(eq(turnJobs.id, job.id));
      const row = await jobRow(job.id);
      expect([row.holdMicro, row.releasedMicro]).toEqual([0, 1_000_000 - cost.chargedMicro]);
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000 - cost.chargedMicro, reserved: 0 });
      await expectBooksBalance(a.userId);
    });

    it("a charge after the job ended only lowers the balance, and no release moves again", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      await db.update(turnJobs).set({ status: "done" }).where(eq(turnJobs.id, job.id));
      const cost = await recordUsage(db, { ...a, jobId: job.id, messageId: null, callId: "late", model: "deepseek-flash", inputTokens: 1_000, outputTokens: 40, cachedInputTokens: 0, funding: "paid" });
      expect(cost.inserted).toBe(true);
      const row = await jobRow(job.id);
      expect([row.holdMicro, row.releasedMicro]).toEqual([0, 1_000_000]);
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000 - cost.chargedMicro, reserved: 0 });
      await expectBooksBalance(a.userId);
    });

    it("the project-name call charges the build's hold, and only once", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      const namer = () => scriptedModel([{ text: "Club Page", usage: { input: 200, output: 10 } }]).client;
      await nameProject(db, namer(), { projectId: a.projectId, userId: a.userId, prompt: "x", messageId: job.userMessageId, funding: "paid", jobId: job.id });
      const m = await money(a.userId);
      expect(m.charged).toBeGreaterThan(0);
      expect(m.reserved).toBe(1_000_000 - m.charged);
      await expectBooksBalance(a.userId);
    });

    it("the database refuses what would break the hold's rules", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      expect(await failure(db.update(turnJobs).set({ releasedMicro: 5 }).where(eq(turnJobs.id, job.id)))).toMatch(/released_micro|Failed query/);
      await db.update(turnJobs).set({ status: "done" }).where(eq(turnJobs.id, job.id));
      expect(await failure(db.update(turnJobs).set({ holdMicro: 5 }).where(eq(turnJobs.id, job.id)))).toMatch(/hold of finished|Failed query/);
      const [m] = await db.insert(messages).values({ projectId: a.projectId, role: "user", content: "x" }).returning({ id: messages.id });
      // Not on a free job, not bigger than the balance, not already released, not when finished.
      const row = (over: object) => ({ projectId: a.projectId, userId: a.userId, mode: "build", prompt: "x", userMessageId: m.id, ...over });
      expect(await failure(db.insert(turnJobs).values(row({ funding: "free", holdMicro: 5 })))).toMatch(/hold_check|Failed query/);
      expect(await failure(db.insert(turnJobs).values(row({ funding: "paid", holdMicro: 5_000_001 })))).toMatch(/more than|Failed query/);
      expect(await failure(db.insert(turnJobs).values(row({ funding: "paid", releasedMicro: 5 })))).toMatch(/released_micro|Failed query/);
      expect(await failure(db.insert(turnJobs).values(row({ funding: "paid", status: "done", holdMicro: 5 })))).toMatch(/finished|Failed query/);
      expect(await failure(db.execute(sql`UPDATE balances SET reserved_micro = -1 WHERE user_id = ${a.userId}`))).toMatch(/reserved_check|Failed query/);
      await expectBooksBalance(a.userId);
    });

    it("a paid job can't move to another user while it holds credit", async () => {
      const a = await payer(5_000_000);
      const b = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      expect(await failure(db.update(turnJobs).set({ userId: b.userId }).where(eq(turnJobs.id, job.id)))).toMatch(/can't change user|Failed query/);
    });
  });

  describe("the regular check", () => {
    const age = (ms: number) => sql.raw(`now() - interval '${Math.ceil(ms / 1000)} seconds'`);

    it("clears a hold stuck on a job whose worker is long gone, once, and leaves no project locked", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      await claimJob(db, "dead-worker");
      await db.update(turnJobs).set({ leaseExpiresAt: age(HOLD_STUCK_LEASE_MS + 1_000) }).where(eq(turnJobs.id, job.id));
      expect((await checkHolds(db)).failed).toEqual([job.id]);
      const row = await jobRow(job.id);
      expect([row.status, row.releasedMicro]).toEqual(["error", 1_000_000]);
      expect(row.error).toMatch(/Retry/);
      expect((await db.select().from(projects).where(eq(projects.id, a.projectId)))[0].turnStartedAt).toBeNull();
      expect(await checkHolds(db)).toMatchObject({ failed: [], repaired: [] });
      expect(await money(a.userId)).toMatchObject({ reserved: 0, balance: 5_000_000 });
      await expectBooksBalance(a.userId);
    });

    it("clears a hold on a queued job left far too long, and one running far too long even with a fresh lease", async () => {
      const a = await payer(5_000_000);
      const old = queued(await start(a.userId, a.projectId));
      await db.update(turnJobs).set({ createdAt: age(HOLD_STUCK_QUEUED_MS + 1_000) }).where(eq(turnJobs.id, old.id));
      const b = await payer(5_000_000);
      const hung = queued(await start(b.userId, b.projectId));
      await db.update(turnJobs).set({ status: "running", leaseOwner: "w", attempt: 1, leaseExpiresAt: sql`now() + interval '30 seconds'`, startedAt: age(HOLD_MAX_RUN_MS + 1_000) }).where(eq(turnJobs.id, hung.id));
      expect((await checkHolds(db)).failed.sort()).toEqual([old.id, hung.id].sort());
      expect((await jobRow(old.id)).releasedMicro).toBe(1_000_000);
      expect((await jobRow(hung.id)).releasedMicro).toBe(1_000_000);
      await expectBooksBalance();
    });

    it("leaves live holds alone: fresh lease, briefly expired lease, or waiting in the queue", async () => {
      const a = await payer(5_000_000);
      const live = queued(await start(a.userId, a.projectId));
      await claimJob(db, "w");
      const b = await payer(5_000_000);
      const crashing = queued(await start(b.userId, b.projectId));
      await db.update(turnJobs).set({ status: "running", leaseOwner: "w", attempt: 1, startedAt: sql`now()`, leaseExpiresAt: sql`now() - interval '40 seconds'` }).where(eq(turnJobs.id, crashing.id));
      const c = await payer(5_000_000);
      const waiting = queued(await start(c.userId, c.projectId));
      expect(await checkHolds(db)).toMatchObject({ failed: [], repaired: [] });
      for (const id of [live.id, crashing.id, waiting.id]) expect((await jobRow(id)).holdMicro).toBe(1_000_000);
      expect((await jobRow(live.id)).status).toBe("running");
    });

    it("never touches a free or exempt job, however old", async () => {
      const a = await newUser();
      const job = queued(await start(a.userId, a.projectId));
      await db.update(turnJobs).set({ status: "running", leaseOwner: "w", attempt: 1, createdAt: age(HOLD_MAX_RUN_MS * 2), startedAt: age(HOLD_MAX_RUN_MS * 2), leaseExpiresAt: age(HOLD_MAX_RUN_MS) }).where(eq(turnJobs.id, job.id));
      expect((await checkHolds(db)).failed).toEqual([]);
      expect((await jobRow(job.id)).status).toBe("running");
    });

    it("corrects a reserved total that has drifted from the open holds, in either direction, and logs it", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      const b = await payer(5_000_000);
      await db.execute(sql`UPDATE balances SET reserved_micro = 2000000 WHERE user_id = ${a.userId}`);
      await db.execute(sql`UPDATE balances SET reserved_micro = 77 WHERE user_id = ${b.userId}`);
      expect((await findReservationMismatches(db)).length).toBe(2);
      const result = await checkHolds(db);
      expect(result.repaired.map((r) => r.userId).sort()).toEqual([a.userId, b.userId].sort());
      expect(warn).toHaveBeenCalled();
      expect(await money(a.userId)).toMatchObject({ reserved: 1_000_000 });
      expect(await money(b.userId)).toMatchObject({ reserved: 0 });
      expect((await jobRow(job.id)).holdMicro).toBe(1_000_000);
      await expectBooksBalance(a.userId);
    });

    it("a worker whose job the check ended loses its lease and writes nothing more", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      const claimed = (await claimJob(db, "w"))!;
      const ctx = await jobContext(db, claimed, "w", new AbortController().signal);
      await db.update(turnJobs).set({ startedAt: age(HOLD_MAX_RUN_MS + 1_000) }).where(eq(turnJobs.id, job.id));
      expect((await checkHolds(db)).failed).toEqual([job.id]);
      await expect(runTurn({ db, model: scriptedModel(OK_BUILD).client, job: ctx }, { projectId: a.projectId, userId: a.userId, mode: "build", userMessageId: claimed.userMessageId }, () => undefined)).rejects.toBeInstanceOf(LeaseLostError);
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000, reserved: 0 });
    });
  });

  describe("the cheaper balance check is as strict as the old one (D49)", () => {
    const failsToCommit = (fn: (tx: Db) => Promise<unknown>) => failure(db.transaction((tx) => fn(tx as unknown as Db)));
    const entry = (userId: string, amount: number, after: number) => sql`INSERT INTO ledger_entries (user_id, kind, amount_micro, balance_after_micro, idempotency_key) VALUES (${userId}, 'adjust', ${amount}, ${after}, ${randomUUID()})`;

    it("refuses an entry with no balance change, a balance change with no entry, and a wrong running total", async () => {
      const a = await payer(1_000_000);
      expect(await failsToCommit((tx) => tx.execute(entry(a.userId, 5, 1_000_005)))).toMatch(/differs/);
      expect(await failsToCommit((tx) => tx.execute(sql`UPDATE balances SET balance_micro = balance_micro + 5 WHERE user_id = ${a.userId}`))).toMatch(/differs/);
      // Balance and running total agree with each other, but not with the sum of the entries.
      expect(
        await failsToCommit(async (tx) => {
          await tx.execute(entry(a.userId, 5, 2_000_000));
          await tx.execute(sql`UPDATE balances SET balance_micro = 2000000 WHERE user_id = ${a.userId}`);
        }),
      ).toMatch(/running total/);
      await expectBooksBalance(a.userId);
    });

    it("refuses an entry slipped in earlier than the latest one", async () => {
      const a = await payer(1_000_000);
      await deposit(a.userId, 1_000);
      const [first] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, a.userId)).orderBy(ledgerEntries.seq).limit(1);
      expect(
        await failsToCommit(async (tx) => {
          await tx.execute(sql`INSERT INTO ledger_entries (seq, user_id, kind, amount_micro, balance_after_micro, idempotency_key) OVERRIDING SYSTEM VALUE VALUES (${first.seq + 1000000}, ${a.userId}, 'adjust', 5, 1000006, 'later')`);
          await tx.execute(sql`INSERT INTO ledger_entries (seq, user_id, kind, amount_micro, balance_after_micro, idempotency_key) OVERRIDING SYSTEM VALUE VALUES (${first.seq}, ${a.userId}, 'adjust', 5, 5, 'earlier')`);
        }),
      ).toMatch(/running total|duplicate|Failed query/);
      await expectBooksBalance(a.userId);
    });

    it("moving a user's balance row to someone else is refused", async () => {
      const a = await payer(1_000_000);
      const b = await newUser();
      expect(await failsToCommit((tx) => tx.execute(sql`UPDATE balances SET user_id = ${b.userId} WHERE user_id = ${a.userId}`))).toMatch(/differs/);
      await expectBooksBalance(a.userId);
    });

    it("changing only the reserved total runs no ledger check, and can't alter the balance", async () => {
      const a = await payer(1_000_000);
      await db.execute(sql`UPDATE balances SET reserved_micro = 5 WHERE user_id = ${a.userId}`);
      expect((await money(a.userId)).balance).toBe(1_000_000);
      await db.execute(sql`UPDATE balances SET reserved_micro = 0 WHERE user_id = ${a.userId}`);
    });

    it("across hundreds of random posts, the running total and the balance always equal the sum", async () => {
      const a = await newUser();
      let expected = 0;
      for (let i = 0; i < 300; i++) {
        const amount = i % 7 === 0 ? 500_000 : -((i * 37) % 1000) - 1;
        const kind = amount > 0 ? "deposit" : "usage";
        const { entry: e } = await postLedgerEntry(db, { userId: a.userId, kind, amountMicro: amount, idempotencyKey: `k${i}`, allowNegative: kind === "usage" });
        expected += amount;
        expect(e.balanceAfterMicro).toBe(expected);
      }
      expect(await balanceFromEntriesMicro(db, a.userId)).toBe(expected);
      expect(await findBalanceMismatches(db)).toEqual([]);
    });
  });

  describe("holds never make the balance disagree with the entries", () => {
    it("over a long random mix of everything, every rule holds after every step", async () => {
      for (let seed = 1; seed <= 4; seed++) {
        let s = seed * 2654435761 + 1;
        const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
        const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
        const a = await payer(2_000_000);
        const projectIds = [a.projectId, await project(a.userId), await project(a.userId)];
        const usedCalls: string[] = [];
        for (let step = 0; step < 60; step++) {
          const open = (await db.select().from(turnJobs).where(eq(turnJobs.userId, a.userId))).filter((j) => ["queued", "running"].includes(j.status));
          const job = open.length ? pick(open) : null;
          const action = Math.floor(r() * 7);
          if (action === 0) await start(a.userId, pick(projectIds));
          else if (action === 1) await deposit(a.userId, 100_000 + Math.floor(r() * 500_000));
          else if (action === 2 && job) {
            const callId = randomUUID();
            usedCalls.push(callId);
            await recordUsage(db, { userId: a.userId, projectId: job.projectId, jobId: job.id, messageId: null, callId, model: "claude-sonnet-5-5", inputTokens: Math.floor(r() * 50_000), outputTokens: Math.floor(r() * 16_000), cachedInputTokens: 0, funding: "paid" });
          } else if (action === 3 && usedCalls.length) {
            await recordUsage(db, { userId: a.userId, projectId: a.projectId, jobId: job?.id ?? null, messageId: null, callId: pick(usedCalls), model: "claude-sonnet-5-5", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, funding: "paid" });
          } else if (action === 4 && job) {
            await db.transaction((tx) => ensureHold(tx as unknown as Db, job.id, Math.floor(r() * 3_000_000)));
          } else if (action === 5 && job) {
            await db.update(turnJobs).set({ status: pick(["done", "error", "stopped", "cancelled"]), finishedAt: new Date() }).where(eq(turnJobs.id, job.id));
          } else if (action === 6) {
            await stopProject(db, pick(projectIds));
          }
          await expectBooksBalance(a.userId);
          const m = await money(a.userId);
          expect(m.available, `seed ${seed} step ${step}: holds never exceed the balance unless charges passed them`).toBeGreaterThanOrEqual(Math.min(0, m.balance - m.reserved));
        }
      }
    }, 240_000);
  });

  // PGlite has one connection, so these can only race on real Postgres.
  describe.runIf(backend.realConcurrency)("races", () => {
    it("simultaneous starts on different projects can't set aside more than the balance", async () => {
      for (let round = 0; round < 6; round++) {
        const a = await payer(3_200_000);
        const projectIds = await Promise.all(Array.from({ length: 16 }, () => project(a.userId)));
        const results = await Promise.all(projectIds.map((projectId) => start(a.userId, projectId)));
        const jobs = results.filter((r) => "job" in r).map((r) => r.job);
        expect(jobs.reduce((n, j) => n + j.holdMicro, 0)).toBeLessThanOrEqual(3_200_000);
        // Three at $1, then one with the $0.20 left is under the minimum.
        expect(jobs).toHaveLength(3);
        const m = await money(a.userId);
        expect(m).toMatchObject({ balance: 3_200_000, reserved: 3_000_000, available: 200_000 });
        await expectBooksBalance(a.userId);
      }
    }, 120_000);

    it("simultaneous free starts on different projects: exactly one gets through (the gap D48 flagged)", async () => {
      for (let round = 0; round < 6; round++) {
        const a = await newUser();
        // The row exists already, as for anyone who has built before. A first insert would queue them by itself.
        if (round % 2) await db.insert(balances).values({ userId: a.userId });
        const projectIds = await Promise.all(Array.from({ length: 10 }, () => project(a.userId)));
        const results = await Promise.all(projectIds.map((projectId) => start(a.userId, projectId, { FREE_AI_BUDGET_MICRO: "1000000000" })));
        expect(results.filter((r) => "job" in r)).toHaveLength(1);
        expect(new Set(results.filter((r) => "refused" in r).map((r) => r.refused.reason))).toEqual(new Set(["one_build_at_a_time"]));
      }
    }, 120_000);

    it("the same call replayed at once charges once", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      const args = { ...a, jobId: job.id, messageId: null, callId: "replayed", model: "claude-sonnet-5-5", inputTokens: 10_000, outputTokens: 1_000, cachedInputTokens: 0, funding: "paid" as const };
      const results = await Promise.all(Array.from({ length: 12 }, () => recordUsage(db, args)));
      expect(results.filter((r) => r.inserted)).toHaveLength(1);
      const m = await money(a.userId);
      expect(m.entries).toBe(2);
      expect(m.balance).toBe(5_000_000 - results[0].chargedMicro);
      expect(m.reserved).toBe(1_000_000 - results[0].chargedMicro);
      await expectBooksBalance(a.userId);
    }, 60_000);

    it("many different charges at once all land, and each comes out of the hold", async () => {
      const a = await payer(5_000_000);
      const job = queued(await start(a.userId, a.projectId));
      const results = await Promise.all(Array.from({ length: 15 }, (_, i) => recordUsage(db, { ...a, jobId: job.id, messageId: null, callId: `c${i}`, model: "deepseek-flash", inputTokens: 10_000, outputTokens: 1_000, cachedInputTokens: 0, funding: "paid" })));
      const charged = results.reduce((n, r) => n + r.chargedMicro, 0);
      expect(await money(a.userId)).toMatchObject({ balance: 5_000_000 - charged, reserved: 1_000_000 - charged, charged });
      await expectBooksBalance(a.userId);
    }, 60_000);

    it("a release racing a late charge: the charge lands, the hold goes back once, whichever wins", async () => {
      for (let round = 0; round < 25; round++) {
        const a = await payer(5_000_000);
        const job = queued(await start(a.userId, a.projectId));
        const late = () => recordUsage(db, { ...a, jobId: job.id, messageId: null, callId: `late-${round}`, model: "deepseek-flash", inputTokens: 10_000, outputTokens: 1_000, cachedInputTokens: 0, funding: "paid" });
        const end = () => db.update(turnJobs).set({ status: "done" }).where(eq(turnJobs.id, job.id));
        const [cost] = await Promise.all([late(), end(), end(), end()]);
        const row = await jobRow(job.id);
        expect(row.holdMicro).toBe(0);
        // Either the charge came first and shrank what was returned, or the whole hold went back first.
        expect([1_000_000, 1_000_000 - cost.chargedMicro]).toContain(row.releasedMicro);
        expect(await money(a.userId)).toMatchObject({ balance: 5_000_000 - cost.chargedMicro, reserved: 0 });
        await expectBooksBalance(a.userId);
      }
    }, 120_000);

    it("starts, extensions, charges, stops, top-ups and the regular check all at once: no deadlock, and the books balance", async () => {
      const a = await payer(4_000_000);
      const projectIds = await Promise.all(Array.from({ length: 6 }, () => project(a.userId)));
      const jobs = (await Promise.all(projectIds.slice(0, 3).map((p) => start(a.userId, p)))).map(queued);
      const ops: Array<Promise<unknown>> = [];
      for (let i = 0; i < 6; i++) {
        for (const job of jobs) {
          ops.push(recordUsage(db, { ...a, jobId: job.id, messageId: null, callId: `${job.id}-${i}`, model: "deepseek-flash", inputTokens: 5_000, outputTokens: 500, cachedInputTokens: 0, funding: "paid" }));
          ops.push(db.transaction((tx) => ensureHold(tx as unknown as Db, job.id, 1_200_000)));
        }
        ops.push(deposit(a.userId, 50_000));
        ops.push(checkHolds(db));
        ops.push(start(a.userId, projectIds[3 + (i % 3)]));
      }
      ops.push(stopProject(db, jobs[0].projectId));
      ops.push(db.update(turnJobs).set({ status: "error" }).where(eq(turnJobs.id, jobs[1].id)));
      const settled = await Promise.allSettled(ops);
      expect(settled.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
      await expectBooksBalance(a.userId);
    }, 120_000);

    it("the drift correction doesn't lose a hold change happening at the same moment", async () => {
      for (let round = 0; round < 15; round++) {
        const a = await payer(9_000_000);
        const job = queued(await start(a.userId, a.projectId));
        await db.execute(sql`UPDATE balances SET reserved_micro = 123 WHERE user_id = ${a.userId}`);
        await Promise.all([repairReservations(db), db.transaction((tx) => ensureHold(tx as unknown as Db, job.id, 2_000_000)), repairReservations(db)]);
        await repairReservations(db);
        expect((await jobRow(job.id)).holdMicro).toBe(2_000_000);
        await expectBooksBalance(a.userId);
      }
    }, 60_000);
  });
});
