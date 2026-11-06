// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { balances, ledgerEntries, messages, projects, turnJobs, usageEvents, users, type FundingSource } from "@/server/db/schema";
import { scriptedModel } from "@/server/agent/fake-model";
import { runTurn } from "@/server/agent/runner";
import { recordUsage } from "@/server/agent/store";
import { claimJob, jobContext, startTurn } from "@/server/jobs/jobs";
import { BUDGET_MESSAGE, CAP_MESSAGE, VERIFIED_CAP_MESSAGE, checkAiAllowance, decideDirectFunding, hasPlanHeadroom, shouldOfferVerification } from "./cap";
import * as before from "./cap-before-m3";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

/**
 * Nobody can buy credits yet, so M3 must change nothing for anyone using GoodBuild today (D49). The
 * code as it was on main (`cap-before-m3.ts`) runs beside the new code on the same rows: every start,
 * at every boundary, must give the same answer, the same message and the same job, with nothing set
 * aside and nothing in the ledger.
 */

const EXEMPT_WALLET = "0x00000000000000000000000000000000000e4e47";
const ROOT = "0x0000000000000000000000000000000000000r00";

function rng(seed: number) {
  let s = seed * 2654435761 + 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 2 ** 32;
  };
}

class Rollback extends Error {}

describe.each(testBackends())("free-only users notice no change on $name", (backend) => {
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

  async function usage(userId: string, projectId: string, micro: { provider: number; charged: number }, funding: FundingSource) {
    await db.insert(usageEvents).values({ userId, projectId, callId: randomUUID(), model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: micro.provider, chargedMicro: micro.charged, markupBps: 2500, funding });
  }

  async function job(userId: string, projectId: string, status: string, funding: FundingSource) {
    const [m] = await db.insert(messages).values({ projectId, role: "user", content: "x" }).returning({ id: messages.id });
    await db.insert(turnJobs).values({ userId, projectId, mode: "build", prompt: "x", userMessageId: m.id, status, funding });
  }

  /** What the old route would do to these rows, with everything it wrote rolled back. */
  async function oldRoute(args: Parameters<typeof before.routeBeforeM3>[1], env: Record<string, string>) {
    let result: Awaited<ReturnType<typeof before.routeBeforeM3>> | undefined;
    await db
      .transaction(async (tx) => {
        result = await before.routeBeforeM3(tx as unknown as Db, args, env);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    return result!;
  }

  it("across 40 seeded scenarios, every start gives the same answer, message and job as the old route", async () => {
    const unverified = await newUser();
    const verifiedA = await newUser();
    const verifiedB = await newUser();
    const verifiedNoRoot = await newUser();
    const exempt = await newUser(EXEMPT_WALLET);
    const fresh = await newUser();
    await db.update(users).set({ verifiedAt: new Date(), goodidRoot: ROOT }).where(sql`${users.id} IN (${verifiedA.userId}, ${verifiedB.userId})`);
    await db.update(users).set({ verifiedAt: new Date() }).where(eq(users.id, verifiedNoRoot.userId));
    const people = [unverified, verifiedA, verifiedB, verifiedNoRoot, exempt, fresh];
    const near = (cap: number) => [0, cap - 1, cap, cap + 1, Math.floor(cap / 2)];
    let compared = 0;
    let refusals = 0;
    let started = 0;

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
      for (const person of people) {
        const status = pick(["none", "none", "queued", "running"]);
        if (status !== "none") await job(person.userId, person.projectId, status, person === exempt ? "exempt" : "free");
      }
      const [row] = await db.select({ total: sql<string>`coalesce(sum(${usageEvents.providerCostMicro}), 0)` }).from(usageEvents);
      const total = Number(row.total);
      const active = (await db.select().from(turnJobs)).length;
      const budgets = [0, total, total + 1, total + active * 350_000, total + active * 350_000 + 1, total + (active + 1) * 350_000 + 1];

      for (const budget of budgets) {
        const env = { FREE_AI_BUDGET_MICRO: String(budget), UNCAPPED_WALLETS: `0xsomeone, ${EXEMPT_WALLET}` };
        for (const person of people) {
          for (const projectId of [person.projectId, person.otherProjectId]) {
            const args = { projectId, userId: person.userId, mode: "build" as const, prompt: "Build it" };
            const old = await oldRoute(args, env);
            // Real, then undone, so the next case sees the same rows.
            let now: Awaited<ReturnType<typeof startTurn>> | undefined;
            await db
              .transaction(async (tx) => {
                now = await startTurn(tx as unknown as Db, args, env);
                throw new Rollback();
              })
              .catch((e) => {
                if (!(e instanceof Rollback)) throw e;
              });
            const label = `seed ${seed}, budget ${budget}`;
            if ("refused" in old) {
              refusals++;
              expect(now, label).toEqual({ refused: old.refused });
            } else {
              started++;
              expect(now && "job" in now, label).toBe(true);
              const job = (now as { job: typeof old.job }).job;
              const shape = (j: typeof old.job) => ({ funding: j.funding, status: j.status, mode: j.mode, prompt: j.prompt, projectId: j.projectId, userId: j.userId });
              expect(shape(job), label).toEqual(shape(old.job));
              expect([job.holdMicro, job.releasedMicro], label).toEqual([0, 0]);
            }
            compared++;
          }
          // Calls outside a build, plan headroom and the verification offer.
          expect(await checkAiAllowance(db, { userId: person.userId }, env)).toEqual(await before.checkAiAllowance(db, { userId: person.userId }, env));
          expect(await decideDirectFunding(db, person.userId, env)).toBe(await before.decideFunding(db, person.userId, env));
          expect(await hasPlanHeadroom(db, person.userId, env)).toBe(await before.hasPlanHeadroom(db, person.userId, env));
          expect(await shouldOfferVerification(db, person.userId, env)).toBe(await before.shouldOfferVerification(db, person.userId, env));
          // The worker's start check on a free or exempt job.
          const funding = person === exempt ? "exempt" : "free";
          expect(await checkAiAllowance(db, { userId: person.userId, startingJobId: randomUUID(), funding }, env)).toEqual(
            funding === "exempt" ? { allowed: true } : await before.checkAiAllowance(db, { userId: person.userId, startingJobId: randomUUID() }, env),
          );
        }
      }
    }
    // The scenarios really reach both sides of the limits.
    expect(compared).toBeGreaterThan(2000);
    expect(refusals).toBeGreaterThan(200);
    expect(started).toBeGreaterThan(200);
    expect(await db.select().from(ledgerEntries)).toEqual([]);
    expect((await db.select().from(balances)).filter((b) => b.balanceMicro !== 0 || b.reservedMicro !== 0)).toEqual([]);
  }, 600_000);

  it("the messages and limits are word for word the ones users see today", () => {
    expect(CAP_MESSAGE).toBe(before.CAP_MESSAGE);
    expect(VERIFIED_CAP_MESSAGE).toBe(before.VERIFIED_CAP_MESSAGE);
    expect(BUDGET_MESSAGE).toBe(before.BUDGET_MESSAGE);
    expect([before.UNVERIFIED_CAP_MICRO, before.VERIFIED_CAP_MICRO, before.FREE_BUDGET_MICRO, before.RESERVED_PER_BUILD_MICRO]).toEqual([200_000, 700_000, 4_000_000, 350_000]);
  });

  it("a whole free build costs what it did: no holds, no ledger, and the model sees the same requests", async () => {
    const a = await newUser();
    const started = await startTurn(db, { projectId: a.projectId, userId: a.userId, mode: "build", prompt: "Build it" }, {});
    if ("refused" in started) throw new Error("refused");
    expect([started.job.funding, started.job.holdMicro]).toEqual(["free", 0]);
    const claimed = (await claimJob(db, "w"))!;
    const ctx = await jobContext(db, claimed, "w", new AbortController().signal);
    // Nothing touches the ledger or the holds, so an untouched database and a checked one agree.
    const commits: number[] = [];
    const real = ctx.commit;
    ctx.commit = (fn) => {
      commits.push(commits.length);
      return real(fn);
    };
    const reply = [{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: "export default function App() { return <main>Club</main>; }\n" } }] }, { text: "Built." }];
    const model = scriptedModel(reply);
    const record = await runTurn({ db, model: model.client, job: ctx }, { projectId: a.projectId, userId: a.userId, mode: "build", userMessageId: claimed.userMessageId }, () => undefined);
    expect(record.status).toBe("ready");
    expect(model.requests).toHaveLength(2);
    // The reply, the setup, one per response, the final commit: no extra commit for a hold check.
    expect(commits).toHaveLength(5);
    const [row] = await db.select().from(turnJobs).where(eq(turnJobs.id, started.job.id));
    expect([row.status, row.holdMicro, row.releasedMicro]).toEqual(["done", 0, 0]);
    expect((await db.select().from(usageEvents)).map((u) => u.funding)).toEqual(["free", "free"]);
    expect(await db.select().from(ledgerEntries)).toEqual([]);
    expect(await db.select().from(balances)).toEqual([expect.objectContaining({ balanceMicro: 0, reservedMicro: 0 })]);
  });

  it("free usage is still recorded, once, with no transaction or ledger work", async () => {
    const a = await newUser();
    const args = { userId: a.userId, projectId: a.projectId, messageId: null, callId: "c", model: "deepseek-flash", inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, funding: "free" as const };
    expect((await recordUsage(db, args)).inserted).toBe(true);
    expect((await recordUsage(db, args)).inserted).toBe(false);
    expect(await db.select().from(usageEvents)).toHaveLength(1);
    expect(await db.select().from(balances)).toEqual([]);
  });

  it.runIf(backend.realConcurrency)("the one difference: simultaneous free starts no longer slip past one-project-at-a-time", async () => {
    const a = await newUser();
    const env = { FREE_AI_BUDGET_MICRO: "100000000" };
    // The row exists already: a first insert would queue them by itself, even with no lock.
    await db.insert(balances).values({ userId: a.userId });
    const results = await Promise.all([a.projectId, a.otherProjectId].map((projectId) => startTurn(db, { projectId, userId: a.userId, mode: "build", prompt: "x" }, env)));
    expect(results.filter((r) => "job" in r)).toHaveLength(1);
  });
});
