// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { messages, projects, turnJobs, usageEvents, users, type FundingSource } from "@/server/db/schema";
import { enqueueTurn } from "@/server/jobs/jobs";
import { BUDGET_MESSAGE, CAP_MESSAGE, VERIFIED_CAP_MESSAGE, checkAiAllowance, decideFunding, hasPlanHeadroom, shouldOfferVerification, spentMicro } from "./cap";
import * as before from "./cap-before-m2";
import { getBalanceMicro, postLedgerEntry } from "./ledger";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

/**
 * M2 (D48): free AI is counted only from free usage, each job keeps one funding source for life,
 * and for everyone using GoodBuild today nothing changes.
 */

const EXEMPT_WALLET = "0x00000000000000000000000000000000000e4e47";
const ROOT = "0x0000000000000000000000000000000000000r00";

/** A rejected query's own message and its driver cause, which is where Postgres's text ends up. */
async function failure(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const e = error as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ""}`;
  }
  throw new Error("expected this to be refused, and it succeeded");
}

/** A small deterministic random source, so a failing scenario can be rerun by its seed. */
function rng(seed: number) {
  let s = seed * 2654435761 + 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 2 ** 32;
  };
}

describe.each(testBackends())("free and paid kept apart on $name", (backend) => {
  let database: TestDatabase;
  let db: Db;

  beforeEach(async () => {
    database = await backend.open();
    db = database.db;
    await database.migrate(MIGRATIONS);
  }, 120_000);

  afterEach(async () => {
    await database?.close();
  });

  async function newUser(wallet = `0x${randomUUID().replaceAll("-", "")}`) {
    const [u] = await db.insert(users).values({ wallet }).returning({ id: users.id });
    const [p] = await db.insert(projects).values({ ownerId: u.id, name: "P", chainId: 11142220 }).returning({ id: projects.id });
    const [q] = await db.insert(projects).values({ ownerId: u.id, name: "Q", chainId: 11142220 }).returning({ id: projects.id });
    return { userId: u.id, projectId: p.id, otherProjectId: q.id };
  }

  async function project(ownerId: string) {
    const [p] = await db.insert(projects).values({ ownerId, name: "R", chainId: 11142220 }).returning({ id: projects.id });
    return p.id;
  }

  async function usage(userId: string, projectId: string, micro: { provider: number; charged: number }, funding: FundingSource) {
    await db.insert(usageEvents).values({ userId, projectId, callId: randomUUID(), model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: micro.provider, chargedMicro: micro.charged, markupBps: 2500, funding });
  }

  async function job(userId: string, projectId: string, status: string, funding: FundingSource) {
    const [m] = await db.insert(messages).values({ projectId, role: "user", content: "x" }).returning({ id: messages.id });
    const [j] = await db.insert(turnJobs).values({ userId, projectId, mode: "build", prompt: "x", userMessageId: m.id, status, funding }).returning();
    return j;
  }

  describe("users see the same decisions as before M2, on the same rows", () => {
    /**
     * Seeded scenarios around every boundary: each person's cap (to the micro), the $4 total, and
     * the $0.35 held per build. Rows are written as M2 writes them: exempt wallets' usage and jobs as
     * `exempt`, everyone else's as `free`, since nothing can be paid yet. Both versions of the cap
     * code then answer every question for every user, and must agree exactly.
     */
    it("across 40 seeded scenarios, every check, plan headroom and verification offer agree", async () => {
      const unverified = await newUser();
      const verifiedA = await newUser();
      const verifiedB = await newUser();
      const verifiedNoRoot = await newUser();
      const exempt = await newUser(EXEMPT_WALLET);
      const fresh = await newUser();
      await db.update(users).set({ verifiedAt: new Date(), goodidRoot: ROOT }).where(sql`${users.id} IN (${verifiedA.userId}, ${verifiedB.userId})`);
      await db.update(users).set({ verifiedAt: new Date() }).where(eq(users.id, verifiedNoRoot.userId));
      const people = [unverified, verifiedA, verifiedB, verifiedNoRoot, exempt, fresh];
      // Near the caps: one under, at, one over, and well clear.
      const near = (cap: number) => [0, cap - 1, cap, cap + 1, Math.floor(cap / 2)];
      let compared = 0;
      let refusals = 0;

      for (let seed = 0; seed < 40; seed++) {
        const r = rng(seed);
        const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
        await db.delete(usageEvents);
        await db.delete(turnJobs);

        await usage(unverified.userId, unverified.projectId, { provider: 0, charged: pick(near(200_000)) }, "free");
        const identity = pick(near(700_000));
        const share = Math.floor(identity * r());
        await usage(verifiedA.userId, verifiedA.projectId, { provider: 0, charged: share }, "free");
        await usage(verifiedB.userId, verifiedB.projectId, { provider: 0, charged: identity - share }, "free");
        await usage(verifiedNoRoot.userId, verifiedNoRoot.projectId, { provider: 0, charged: pick(near(700_000)) }, "free");
        await usage(exempt.userId, exempt.projectId, { provider: pick([0, 500_000, 1_000_000]), charged: pick([0, 900_000]) }, "exempt");
        await usage(fresh.userId, fresh.projectId, { provider: pick([0, 1_000_000, 2_000_000]), charged: 0 }, "free");

        const running: Array<{ id: string; userId: string; funding: FundingSource }> = [];
        for (const person of people) {
          const status = pick(["none", "none", "queued", "running"]);
          if (status === "none") continue;
          const j = await job(person.userId, person.projectId, status, person === exempt ? "exempt" : "free");
          if (status === "running") running.push(j);
        }

        const [row] = await db.select({ total: sql<string>`coalesce(sum(${usageEvents.providerCostMicro}), 0)` }).from(usageEvents);
        const total = Number(row.total);
        const active = (await db.select().from(turnJobs)).length;
        // Budgets either side of: spend alone, spend plus each number of held builds.
        const budgets = [0, total, total + 1, ...Array.from({ length: active + 1 }, (_, n) => [total + n * 350_000, total + n * 350_000 + 1]).flat()];

        for (const budget of budgets) {
          const env = { FREE_AI_BUDGET_MICRO: String(budget), UNCAPPED_WALLETS: `0xsomeone, ${EXEMPT_WALLET}` };
          for (const person of people) {
            const ask = async (inputs: { projectId?: string }) => {
              const old = await before.checkAiAllowance(db, { userId: person.userId, ...inputs }, env);
              const now = await checkAiAllowance(db, { userId: person.userId, ...inputs }, env);
              expect(now, `seed ${seed}, budget ${budget}`).toEqual(old);
              if (!old.allowed) refusals++;
              compared++;
            };
            await ask({});
            await ask({ projectId: person.projectId });
            await ask({ projectId: person.otherProjectId });
            expect(await hasPlanHeadroom(db, person.userId, env)).toBe(await before.hasPlanHeadroom(db, person.userId, env));
            expect(await shouldOfferVerification(db, person.userId, env)).toBe(await before.shouldOfferVerification(db, person.userId, env));
            expect(await spentMicro(db, person.userId)).toBe(person === exempt ? 0 : await before.spentMicro(db, person.userId));
          }
          // The worker's check when it starts a claimed build, which now passes the job's funding.
          for (const j of running) {
            const old = await before.checkAiAllowance(db, { userId: j.userId, startingJobId: j.id }, env);
            expect(await checkAiAllowance(db, { userId: j.userId, startingJobId: j.id, funding: j.funding }, env)).toEqual(old);
            compared++;
          }
        }
      }
      // The scenarios really reach both sides of the limits.
      expect(compared).toBeGreaterThan(2000);
      expect(refusals).toBeGreaterThan(200);
    }, 300_000);

    it("the messages are word for word the ones users see today", () => {
      expect(CAP_MESSAGE).toBe(before.CAP_MESSAGE);
      expect(VERIFIED_CAP_MESSAGE).toBe(before.VERIFIED_CAP_MESSAGE);
      expect(BUDGET_MESSAGE).toBe(before.BUDGET_MESSAGE);
      expect([before.UNVERIFIED_CAP_MICRO, before.VERIFIED_CAP_MICRO, before.FREE_BUDGET_MICRO, before.RESERVED_PER_BUILD_MICRO]).toEqual([200_000, 700_000, 4_000_000, 350_000]);
    });
  });

  describe("paid, exempt and platform usage never use up free AI", () => {
    it("paid and platform usage leave a person's allowance, the $4 total and the held builds alone", async () => {
      const a = await newUser();
      const other = await newUser();
      await usage(a.userId, a.projectId, { provider: 150_000, charged: 199_999 }, "free");
      // Far more than every limit, all paid for or paid by the platform.
      await usage(a.userId, a.projectId, { provider: 5_000_000, charged: 6_000_000 }, "paid");
      await usage(a.userId, a.projectId, { provider: 5_000_000, charged: 6_000_000 }, "platform");
      await job(other.userId, other.projectId, "running", "paid");
      await job(other.userId, other.otherProjectId, "queued", "platform");

      expect(await spentMicro(db, a.userId)).toBe(199_999);
      const env = { FREE_AI_BUDGET_MICRO: "150001" };
      expect(await checkAiAllowance(db, { userId: a.userId, projectId: a.projectId }, env)).toEqual({ allowed: true });
      expect(await hasPlanHeadroom(db, a.userId, { UNVERIFIED_CAP_MICRO: "210000" })).toBe(true);
      // The code before M2 would have shut free AI for everyone here.
      expect(await before.checkAiAllowance(db, { userId: a.userId, projectId: a.projectId }, env)).toMatchObject({ reason: "free_limit" });
    });

    it("a verified person's paid usage on a linked wallet doesn't use their shared allowance", async () => {
      const a = await newUser();
      const b = await newUser();
      await db.update(users).set({ verifiedAt: new Date(), goodidRoot: ROOT }).where(sql`${users.id} IN (${a.userId}, ${b.userId})`);
      await usage(a.userId, a.projectId, { provider: 0, charged: 699_999 }, "free");
      await usage(b.userId, b.projectId, { provider: 0, charged: 1_000_000 }, "paid");
      expect(await checkAiAllowance(db, { userId: b.userId }, {})).toEqual({ allowed: true });
      await usage(b.userId, b.projectId, { provider: 0, charged: 1 }, "free");
      expect(await checkAiAllowance(db, { userId: b.userId }, {})).toEqual({ allowed: false, reason: "verified_limit", message: VERIFIED_CAP_MESSAGE });
    });

    it("exempt usage uses no one's allowance, but still counts towards the $4, as D29 says", async () => {
      const owner = await newUser(EXEMPT_WALLET);
      const a = await newUser();
      await usage(owner.userId, owner.projectId, { provider: 999_999, charged: 1_250_000 }, "exempt");
      expect(await spentMicro(db, owner.userId)).toBe(0);
      expect(await checkAiAllowance(db, { userId: a.userId }, { FREE_AI_BUDGET_MICRO: "1000000" })).toEqual({ allowed: true });
      await usage(owner.userId, owner.projectId, { provider: 1, charged: 1 }, "exempt");
      expect(await checkAiAllowance(db, { userId: a.userId }, { FREE_AI_BUDGET_MICRO: "1000000" })).toEqual({ allowed: false, reason: "budget_full", message: BUDGET_MESSAGE });
      // An exempt build in progress holds back room too.
      await job(owner.userId, owner.projectId, "running", "exempt");
      expect(await checkAiAllowance(db, { userId: a.userId }, { FREE_AI_BUDGET_MICRO: "1350000" })).toMatchObject({ reason: "budget_full" });
      expect(await checkAiAllowance(db, { userId: a.userId }, { FREE_AI_BUDGET_MICRO: "1350001" })).toEqual({ allowed: true });
    });
  });

  describe("a paid balance unlocks builds from M3 (D49), never by its funding changing", () => {
    it("someone at the free limit with credit may go on, but a job queued without the start check stays free", async () => {
      const a = await newUser();
      await usage(a.userId, a.projectId, { provider: 0, charged: 200_000 }, "free");
      await postLedgerEntry(db, { userId: a.userId, kind: "deposit", amountMicro: 20_000_000, idempotencyKey: `topup:${randomUUID()}` });
      expect(await getBalanceMicro(db, a.userId)).toBe(20_000_000);

      expect(await checkAiAllowance(db, { userId: a.userId, projectId: a.projectId }, {})).toEqual({ allowed: true });
      expect(await hasPlanHeadroom(db, a.userId, {})).toBe(false);
      expect(await decideFunding(db, a.userId, {})).toBe("free");
      const queued = await enqueueTurn(db, { projectId: a.projectId, userId: a.userId, mode: "build", prompt: "x" }, {});
      expect(queued.funding).toBe("free");
    });

    it("a verified person with credit at their limit, or anyone when the trial is full, may go on", async () => {
      const a = await newUser();
      await db.update(users).set({ verifiedAt: new Date(), goodidRoot: ROOT }).where(eq(users.id, a.userId));
      await usage(a.userId, a.projectId, { provider: 0, charged: 700_000 }, "free");
      await postLedgerEntry(db, { userId: a.userId, kind: "deposit", amountMicro: 5_000_000, idempotencyKey: `topup:${randomUUID()}` });
      expect(await checkAiAllowance(db, { userId: a.userId }, {})).toEqual({ allowed: true });

      const b = await newUser();
      await postLedgerEntry(db, { userId: b.userId, kind: "deposit", amountMicro: 5_000_000, idempotencyKey: `topup:${randomUUID()}` });
      expect(await checkAiAllowance(db, { userId: b.userId }, { FREE_AI_BUDGET_MICRO: "0" })).toEqual({ allowed: true });
    });

    it("a platform job never starts, since nothing creates them yet, and a paid one does", async () => {
      const a = await newUser();
      const paid = await job(a.userId, a.projectId, "running", "paid");
      const platform = await job(a.userId, a.otherProjectId, "running", "platform");
      expect(await checkAiAllowance(db, { userId: a.userId, startingJobId: paid.id, funding: paid.funding }, { UNCAPPED_WALLETS: "" })).toEqual({ allowed: true });
      expect(await checkAiAllowance(db, { userId: a.userId, startingJobId: platform.id, funding: platform.funding }, { UNCAPPED_WALLETS: "" })).toMatchObject({ allowed: false, reason: "funding_unavailable" });
    });
  });

  describe("each job's funding is decided once, when it's created", () => {
    it("exempt wallets get exempt jobs, everyone else free", async () => {
      const owner = await newUser(EXEMPT_WALLET);
      const a = await newUser();
      const env = { UNCAPPED_WALLETS: EXEMPT_WALLET.toUpperCase().replace("0X", "0x") };
      expect((await enqueueTurn(db, { projectId: owner.projectId, userId: owner.userId, mode: "build", prompt: "x" }, env)).funding).toBe("exempt");
      expect((await enqueueTurn(db, { projectId: a.projectId, userId: a.userId, mode: "build", prompt: "x" }, env)).funding).toBe("free");
      expect((await enqueueTurn(db, { projectId: owner.otherProjectId, userId: owner.userId, mode: "build", prompt: "x" }, {})).funding).toBe("free");
    });

    it("the stored funding decides at start, whatever the worker's own settings say", async () => {
      const owner = await newUser(EXEMPT_WALLET);
      await usage(owner.userId, owner.projectId, { provider: 0, charged: 5_000_000 }, "free");
      const j = await enqueueTurn(db, { projectId: owner.projectId, userId: owner.userId, mode: "build", prompt: "x" }, { UNCAPPED_WALLETS: EXEMPT_WALLET });
      await db.update(turnJobs).set({ status: "running" }).where(eq(turnJobs.id, j.id));
      // A worker started without UNCAPPED_WALLETS still runs the exempt job it was given.
      expect(await checkAiAllowance(db, { userId: owner.userId, startingJobId: j.id, funding: j.funding }, {})).toEqual({ allowed: true });
    });
  });

  describe("funding can't be changed once set", () => {
    it("the database refuses a change on turn_jobs and usage_events, and allows writing the same value", async () => {
      const a = await newUser();
      const j = await job(a.userId, a.projectId, "done", "paid");
      await usage(a.userId, a.projectId, { provider: 1, charged: 1 }, "paid");

      expect(await failure(db.update(turnJobs).set({ funding: "free" }).where(eq(turnJobs.id, j.id)))).toMatch(/funding on turn_jobs refused/);
      expect(await failure(db.update(usageEvents).set({ funding: "free" }).where(eq(usageEvents.userId, a.userId)))).toMatch(/funding on usage_events refused/);
      expect(await failure(db.execute(sql`UPDATE turn_jobs SET funding = 'exempt', status = 'error' WHERE id = ${j.id}`))).toMatch(/refused/);

      await db.update(turnJobs).set({ funding: "paid", status: "error" }).where(eq(turnJobs.id, j.id));
      await db.update(usageEvents).set({ funding: "paid" }).where(eq(usageEvents.userId, a.userId));
      // Other columns still change as the worker needs.
      await db.update(turnJobs).set({ status: "done", error: null }).where(eq(turnJobs.id, j.id));
      const [after] = await db.select().from(turnJobs).where(eq(turnJobs.id, j.id));
      expect([after.funding, after.status]).toEqual(["paid", "done"]);
      expect((await db.select().from(usageEvents)).map((u) => u.funding)).toEqual(["paid"]);
    });

    it("so a paid job can't be switched to free and deleted past the paid-job delete trigger (D46)", async () => {
      const a = await newUser();
      const j = await job(a.userId, a.projectId, "done", "paid");
      await expect(db.transaction(async (tx) => {
        await tx.update(turnJobs).set({ funding: "free" }).where(eq(turnJobs.id, j.id));
        await tx.delete(turnJobs).where(eq(turnJobs.id, j.id));
      })).rejects.toThrow();
      expect(await failure(db.delete(turnJobs).where(eq(turnJobs.id, j.id)))).toMatch(/paid turn job/);
      expect(await failure(db.delete(projects).where(eq(projects.id, a.projectId)))).toMatch(/paid turn job/);
      expect((await db.select().from(turnJobs).where(eq(turnJobs.id, j.id)))[0].funding).toBe("paid");
    });

    it("free jobs can still be deleted with their project, as today", async () => {
      const a = await newUser();
      await job(a.userId, a.projectId, "done", "free");
      await db.delete(projects).where(eq(projects.id, a.projectId));
      expect(await db.select().from(turnJobs)).toHaveLength(0);
    });
  });

  describe.skipIf(!backend.realConcurrency)("racing at the boundary (real Postgres only)", () => {
    it("many updates racing to switch a paid job's funding are all refused", async () => {
      const a = await newUser();
      const j = await job(a.userId, a.projectId, "running", "paid");
      const results = await Promise.allSettled(
        (["free", "exempt", "platform", "free", "exempt", "platform", "free", "exempt"] as const).map((funding) => db.update(turnJobs).set({ funding }).where(eq(turnJobs.id, j.id))),
      );
      expect(results.every((r) => r.status === "rejected")).toBe(true);
      expect((await db.select().from(turnJobs).where(eq(turnJobs.id, j.id)))[0].funding).toBe("paid");
    });

    it("turns sent at once just under the limit are all free jobs, and the worker's start check sees them as the old code did", async () => {
      const a = await newUser();
      const owner = await newUser(EXEMPT_WALLET);
      await usage(a.userId, a.projectId, { provider: 0, charged: 199_999 }, "free");
      const env = { UNCAPPED_WALLETS: EXEMPT_WALLET };
      // One project each, so they can all be running at once.
      const theirs = await Promise.all(Array.from({ length: 6 }, () => project(a.userId)));
      const ours = await Promise.all(Array.from({ length: 6 }, () => project(owner.userId)));
      const jobs = await Promise.all([
        ...theirs.map((projectId) => enqueueTurn(db, { projectId, userId: a.userId, mode: "build", prompt: "x" }, env)),
        ...ours.map((projectId) => enqueueTurn(db, { projectId, userId: owner.userId, mode: "build", prompt: "x" }, env)),
      ]);
      expect(jobs.filter((j) => j.userId === a.userId).map((j) => j.funding)).toEqual(Array(6).fill("free"));
      expect(jobs.filter((j) => j.userId === owner.userId).map((j) => j.funding)).toEqual(Array(6).fill("exempt"));

      // Start them all at once near the $4 total, as several workers would.
      await db.update(turnJobs).set({ status: "running" });
      const budget = { ...env, FREE_AI_BUDGET_MICRO: String(5 * 350_000 + 1) };
      const decisions = await Promise.all(jobs.map((j) => checkAiAllowance(db, { userId: j.userId, startingJobId: j.id, funding: j.funding }, budget)));
      const old = await Promise.all(jobs.map((j) => before.checkAiAllowance(db, { userId: j.userId, startingJobId: j.id }, budget)));
      expect(decisions).toEqual(old);
      expect(decisions.filter((d) => !d.allowed)).toHaveLength(6);
    });
  });
});
