// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Address } from "viem";

import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import type { Db } from "@/server/db/client";
import { turnJobs, usageEvents, users } from "@/server/db/schema";
import { startTurn } from "@/server/jobs/jobs";
import { createProjectFromPrompt } from "@/server/projects";
import { NEEDS_VERIFICATION_MESSAGE, OUT_OF_FREE_CREDITS_MESSAGE, checkAiAllowance, freeRemainingMicro, shouldOfferVerification } from "./cap";
import { claimRefill, claimWelcome, dayKey, freeStatus, gdDayKey, gdDayStart, refillStatus, refillStatusGd, weekStart, type GoodIdentity } from "./free-grants";
import { getBalanceMicro } from "./ledger";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

const credits = (micro: number) => micro / MICRO_PER_CREDIT;
const LIMITS = { perWeek: 5, perMonth: 5 };
const at = (iso: string) => new Date(iso);

describe("refillStatus (pure)", () => {
  it("weeks start on Monday 00:00 UTC", () => {
    expect(weekStart(at("2026-11-18T15:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z"); // Wednesday
    expect(weekStart(at("2026-11-16T00:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z"); // Monday
    expect(weekStart(at("2026-11-22T23:59:59Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z"); // Sunday
  });

  it("allows one claim a day", () => {
    const now = at("2026-11-18T10:00:00Z");
    expect(refillStatus([], now, LIMITS)).toMatchObject({ state: "available", leftThisWeek: 5, leftThisMonth: 5, nextAt: null });
    const s = refillStatus([at("2026-11-18T00:00:00Z")], now, LIMITS);
    expect(s).toMatchObject({ state: "claimed_today", leftThisMonth: 4 });
    expect(s.nextAt?.toISOString()).toBe("2026-11-19T00:00:00.000Z");
  });

  it("stops after the month's claims and comes back on the 1st", () => {
    const days = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"].map((d) => at(`${d}T00:00:00Z`));
    const s = refillStatus(days, at("2026-11-20T09:00:00Z"), LIMITS);
    expect(s).toMatchObject({ state: "month_full", leftThisMonth: 0, leftThisWeek: 0 });
    expect(s.nextAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(refillStatus(days, at("2026-12-01T00:00:00Z"), LIMITS).state).toBe("available");
  });

  it("applies a weekly limit when it is lower, without carrying unused claims over", () => {
    const limits = { perWeek: 2, perMonth: 5 };
    const s = refillStatus([at("2026-11-16T00:00:00Z"), at("2026-11-17T00:00:00Z")], at("2026-11-18T09:00:00Z"), limits);
    expect(s).toMatchObject({ state: "week_full", leftThisWeek: 0, leftThisMonth: 3 });
    expect(s.nextAt?.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    // A week with nothing claimed doesn't make the next one bigger.
    expect(refillStatus([], at("2026-11-25T09:00:00Z"), limits).leftThisWeek).toBe(2);
  });

  it("follows GoodDollar's day, noon to noon UTC", () => {
    expect(gdDayStart(at("2026-11-18T11:59:59Z")).toISOString()).toBe("2026-11-17T12:00:00.000Z");
    expect(gdDayStart(at("2026-11-18T12:00:00Z")).toISOString()).toBe("2026-11-18T12:00:00.000Z");
    expect(gdDayKey(at("2026-11-18T11:00:00Z"))).toBe("2026-11-17");
    expect(gdDayKey(at("2026-11-18T13:00:00Z"))).toBe("2026-11-18");
    const s = refillStatusGd([at("2026-11-18T00:00:00Z")], at("2026-11-18T13:00:00Z"), LIMITS);
    expect(s.state).toBe("claimed_today");
    expect(s.nextAt?.toISOString()).toBe("2026-11-19T12:00:00.000Z");
  });

  it("counts a week that spans two months against each month separately", () => {
    // Mon 30 Nov 2026 is in the same week as Thu 3 Dec.
    const s = refillStatus([at("2026-11-30T00:00:00Z")], at("2026-12-03T09:00:00Z"), { perWeek: 1, perMonth: 5 });
    expect(s).toMatchObject({ state: "week_full", leftThisMonth: 5, claimedDays: [] });
  });
});

describe.each(testBackends())("free grants on $name", (backend) => {
  let database: TestDatabase;
  let db: Db;
  const ENV = { FREE_POLICY: "verified", FREE_BUDGET_CREDITS_PER_MONTH: "100000" };
  const NOW = new Date();

  beforeAll(async () => {
    database = await backend.open();
    db = database.db;
    await database.migrate(MIGRATIONS);
  }, 120_000);

  afterAll(async () => {
    await database?.close();
  });

  const address = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0").slice(0, 40)}` as Address;
  async function newUser() {
    const [u] = await db.insert(users).values({ wallet: address().toLowerCase() }).returning({ id: users.id, wallet: users.wallet });
    return u;
  }
  /** A wallet the chain says has this root, and (by default) claimed its G$ UBI at `now`. */
  const verifiedAs = (root: Address | null, expiresAt: Date | null = null, env: Record<string, string> = ENV, now = NOW, ubiClaimedAt: Date | null = now) => ({
    readIdentity: async (): Promise<GoodIdentity> => ({ root, expiresAt }),
    readUbiClaimedAt: async () => ubiClaimedAt,
    env,
    now,
  });

  it("refuses an unverified wallet, posts nothing, and asks it to verify", async () => {
    const u = await newUser();
    await expect(claimWelcome(db, u, verifiedAs(null))).rejects.toMatchObject({ code: "not_verified" });
    await expect(claimRefill(db, u, verifiedAs(null))).rejects.toMatchObject({ code: "not_verified" });
    expect(await getBalanceMicro(db, u.id)).toBe(0);
    expect(await shouldOfferVerification(db, u.id, ENV)).toBe(true);
    expect(await freeStatus(db, u.id, NOW, ENV)).toMatchObject({ verified: false, welcomeDone: false, refill: null, welcomeCredits: 40 });
  });

  it("gives 40 welcome credits once, however often it's asked", async () => {
    const u = await newUser();
    const r = address();
    expect(await claimWelcome(db, u, verifiedAs(r))).toEqual({ grantedMicro: 40 * MICRO_PER_CREDIT, done: true });
    expect(await claimWelcome(db, u, verifiedAs(r))).toEqual({ grantedMicro: 0, done: true });
    expect(credits(await getBalanceMicro(db, u.id))).toBe(40);
    const [row] = await db.select({ root: users.goodidRoot, verifiedAt: users.verifiedAt }).from(users).where(eq(users.id, u.id));
    expect(row.root).toBe(r.toLowerCase());
    expect(row.verifiedAt).not.toBeNull();
    expect(await shouldOfferVerification(db, u.id, ENV)).toBe(false);
    expect(await freeStatus(db, u.id, NOW, ENV)).toMatchObject({ verified: true, welcomeDone: true });
  });

  it("gives a second account on the same GoodDollar identity no second welcome", async () => {
    const r = address();
    const first = await newUser();
    const second = await newUser();
    await claimWelcome(db, first, verifiedAs(r));
    expect(await claimWelcome(db, second, verifiedAs(r))).toEqual({ grantedMicro: 0, done: true });
    expect(await getBalanceMicro(db, second.id)).toBe(0);
  });

  it("takes free AI used before D123 off the welcome, so nobody is paid twice", async () => {
    const r = address();
    const u = await newUser();
    const linked = await newUser();
    await db.update(users).set({ goodidRoot: r.toLowerCase(), verifiedAt: new Date() }).where(eq(users.id, linked.id));
    const project = await createProjectFromPrompt(db, u.id, { prompt: "Old", network: "celo-sepolia" });
    const before = new Date("2026-11-10T00:00:00Z");
    const use = (userId: string, micro: number) =>
      db.insert(usageEvents).values({ userId, projectId: project.id, callId: randomUUID(), model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: micro, chargedMicro: micro, markupBps: 0, funding: "free", createdAt: before });
    await use(u.id, 150_000);
    await use(linked.id, 100_000);
    // Paid usage and free usage after the start don't count.
    await db.insert(usageEvents).values({ userId: u.id, projectId: project.id, callId: randomUUID(), model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: 90_000, chargedMicro: 90_000, markupBps: 0, funding: "paid", createdAt: before });
    await db.insert(usageEvents).values({ userId: u.id, projectId: project.id, callId: randomUUID(), model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: 5_000, chargedMicro: 5_000, markupBps: 0, funding: "free" });
    expect(credits((await claimWelcome(db, u, verifiedAs(r))).grantedMicro)).toBe(15);

    // Someone who used more than the welcome gets nothing, and the welcome still counts as done.
    const heavy = await newUser();
    await use(heavy.id, 1_000_000);
    const r2 = address();
    expect(await claimWelcome(db, heavy, verifiedAs(r2))).toEqual({ grantedMicro: 0, done: true });
    expect(await freeStatus(db, heavy.id, NOW, ENV)).toMatchObject({ verified: true, welcomeDone: true });
  });

  it("pays a refill once a day, and shares the limit across linked accounts", async () => {
    const r = address();
    const a = await newUser();
    const b = await newUser();
    const day1 = new Date("2026-12-07T13:00:00Z"); // a Monday, after GoodDollar's day starts at noon UTC
    expect(credits((await claimRefill(db, a, verifiedAs(r, null, ENV, day1))).grantedMicro)).toBe(10);
    await expect(claimRefill(db, a, verifiedAs(r, null, ENV, day1))).rejects.toMatchObject({ code: "claimed_today" });
    await expect(claimRefill(db, b, verifiedAs(r, null, ENV, day1))).rejects.toMatchObject({ code: "claimed_today" });

    for (let i = 1; i < 5; i++) {
      const day = new Date(day1.getTime() + i * 86_400_000);
      await claimRefill(db, i % 2 ? b : a, verifiedAs(r, null, ENV, day));
    }
    const day6 = new Date(day1.getTime() + 5 * 86_400_000);
    await expect(claimRefill(db, a, verifiedAs(r, null, ENV, day6))).rejects.toMatchObject({ code: "month_full" });
    expect(credits(await getBalanceMicro(db, a.id)) + credits(await getBalanceMicro(db, b.id))).toBe(50);
    const status = await freeStatus(db, a.id, day6, ENV);
    expect(status.refill).toMatchObject({ state: "month_full", leftThisMonth: 0 });
    expect(status.refill?.claimedDays).toEqual(["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11"]);
    // January is a new month.
    expect((await claimRefill(db, a, verifiedAs(r, null, ENV, new Date("2027-01-04T13:00:00Z")))).status.leftThisMonth).toBe(4);
  });

  it("applies the weekly limit from the settings", async () => {
    const r = address();
    const u = await newUser();
    const env = { ...ENV, REFILLS_PER_WEEK: "2" };
    await claimRefill(db, u, verifiedAs(r, null, env, new Date("2027-02-01T13:00:00Z")));
    await claimRefill(db, u, verifiedAs(r, null, env, new Date("2027-02-02T13:00:00Z")));
    await expect(claimRefill(db, u, verifiedAs(r, null, env, new Date("2027-02-03T13:00:00Z")))).rejects.toMatchObject({ code: "week_full" });
    expect((await claimRefill(db, u, verifiedAs(r, null, env, new Date("2027-02-08T13:00:00Z")))).status).toMatchObject({ leftThisWeek: 1, leftThisMonth: 2 });
  });

  it("needs today's G$ UBI claimed first, on GoodDollar's noon-to-noon UTC day", async () => {
    const r = address();
    const u = await newUser();
    const now = new Date("2027-03-10T15:00:00Z");
    // Never claimed, or last claimed before today's noon: refused, and nothing posted.
    await expect(claimRefill(db, u, verifiedAs(r, null, ENV, now, null))).rejects.toMatchObject({ code: "ubi_not_claimed" });
    await expect(claimRefill(db, u, verifiedAs(r, null, ENV, now, new Date("2027-03-10T11:59:59Z")))).rejects.toMatchObject({ code: "ubi_not_claimed" });
    expect(await getBalanceMicro(db, u.id)).toBe(0);
    // Claimed after noon: the refill goes through, keyed to the GoodDollar day.
    const ok = await claimRefill(db, u, verifiedAs(r, null, ENV, now, new Date("2027-03-10T12:00:05Z")));
    expect(credits(ok.grantedMicro)).toBe(10);
    // Before noon the next morning it's still the same GoodDollar day.
    await expect(claimRefill(db, u, verifiedAs(r, null, ENV, new Date("2027-03-11T09:00:00Z"), new Date("2027-03-10T12:00:05Z")))).rejects.toMatchObject({ code: "claimed_today" });
    expect(credits(await getBalanceMicro(db, u.id))).toBe(10);
    // The status reads the UBI claim too, when it's given a reader.
    const status = await freeStatus(db, u.id, new Date("2027-03-11T13:00:00Z"), ENV, async () => new Date("2027-03-10T12:00:05Z"));
    expect(status).toMatchObject({ refillNeedsUbi: true, ubiClaimedToday: false, refill: { state: "available" } });
  });

  it("works without the UBI claim when REFILL_REQUIRES_UBI=off", async () => {
    const u = await newUser();
    const env = { ...ENV, REFILL_REQUIRES_UBI: "off" };
    expect(credits((await claimRefill(db, u, { readIdentity: async () => ({ root: address(), expiresAt: null }), env })).grantedMicro)).toBe(10);
  });

  it("pauses refills when GoodDollar's verification has expired", async () => {
    const r = address();
    const u = await newUser();
    await claimWelcome(db, u, verifiedAs(r));
    await expect(claimRefill(db, u, verifiedAs(r, new Date(NOW.getTime() - 1000)))).rejects.toMatchObject({ code: "expired" });
    // Verified before, but the chain no longer gives a root: also expired, not "never verified".
    await expect(claimRefill(db, u, verifiedAs(null))).rejects.toMatchObject({ code: "expired" });
    expect(credits(await getBalanceMicro(db, u.id))).toBe(40);
  });

  it("stops every grant once the month's budget is spent", async () => {
    const r = address();
    const u = await newUser();
    // Whatever else this month has granted, leave less than a welcome.
    const env = { ...ENV, FREE_BUDGET_CREDITS_PER_MONTH: "0" };
    await expect(claimWelcome(db, u, verifiedAs(r, null, env))).rejects.toMatchObject({ code: "budget_full" });
    await expect(claimRefill(db, u, verifiedAs(r, null, env))).rejects.toMatchObject({ code: "budget_full" });
    expect(await getBalanceMicro(db, u.id)).toBe(0);
    expect(await shouldOfferVerification(db, u.id, env)).toBe(false);
  });

  it("is switched off entirely by FREE_POLICY=legacy", async () => {
    const u = await newUser();
    await expect(claimWelcome(db, u, verifiedAs(address(), null, { FREE_POLICY: "legacy" }))).rejects.toMatchObject({ code: "off" });
  });

  describe("funding under D123", () => {
    async function withProject() {
      const u = await newUser();
      const project = await createProjectFromPrompt(db, u.id, { prompt: "A tip jar", network: "celo-sepolia" });
      return { ...u, projectId: project.id };
    }

    it("refuses a free build: unverified people are asked to verify, verified ones to refill or top up", async () => {
      const a = await withProject();
      const started = await startTurn(db, { projectId: a.projectId, userId: a.id, mode: "build", prompt: "Build it" }, ENV);
      expect(started).toEqual({ refused: { allowed: false, reason: "needs_verification", message: NEEDS_VERIFICATION_MESSAGE } });
      await db.update(users).set({ verifiedAt: new Date(), goodidRoot: address().toLowerCase() }).where(eq(users.id, a.id));
      expect(await checkAiAllowance(db, { userId: a.id, projectId: a.projectId, mode: "build" }, ENV)).toEqual({ allowed: false, reason: "needs_credits", message: OUT_OF_FREE_CREDITS_MESSAGE });
      // Uploads and visual checks too.
      expect(await checkAiAllowance(db, { userId: a.id }, ENV)).toMatchObject({ allowed: false });
      expect(await freeRemainingMicro(db, a.id, ENV)).toBe(0);
    });

    it("builds from the welcome credits as paid, with a hold", async () => {
      const a = await withProject();
      await claimWelcome(db, a, verifiedAs(address()));
      const started = await startTurn(db, { projectId: a.projectId, userId: a.id, mode: "build", prompt: "Build it" }, ENV);
      expect("job" in started && started.job.funding).toBe("paid");
      expect("job" in started && started.job.holdMicro).toBe(40 * MICRO_PER_CREDIT);
    });

    it("starts a build on one refill alone: the minimum to start is one refill (10 credits)", async () => {
      const a = await withProject();
      await claimRefill(db, a, verifiedAs(address()));
      const started = await startTurn(db, { projectId: a.projectId, userId: a.id, mode: "build", prompt: "Build it" }, ENV);
      expect("job" in started && [started.job.funding, started.job.holdMicro]).toEqual(["paid", 10 * MICRO_PER_CREDIT]);
    });

    it("plans for free, unverified too, up to the daily limit", async () => {
      const a = await withProject();
      const env = { ...ENV, FREE_PLAN_TURNS_PER_DAY: "2" };
      const plan = () => startTurn(db, { projectId: a.projectId, userId: a.id, mode: "plan", prompt: "Plan it" }, env);
      const first = await plan();
      expect("job" in first && first.job.funding).toBe("free");
      // The worker's start check doesn't count the job it's starting.
      if ("job" in first) expect(await checkAiAllowance(db, { userId: a.id, startingJobId: first.job.id, funding: "free", mode: "plan" }, env)).toEqual({ allowed: true });
      if ("job" in first) await db.update(turnJobs).set({ status: "done" }).where(eq(turnJobs.id, first.job.id));
      expect("job" in (await plan())).toBe(true);
      expect(await plan()).toMatchObject({ refused: { reason: "plan_limit" } });
    });

    it("stops free planning when the month's budget is spent", async () => {
      const a = await withProject();
      expect(await startTurn(db, { projectId: a.projectId, userId: a.id, mode: "plan", prompt: "Plan it" }, { ...ENV, FREE_BUDGET_CREDITS_PER_MONTH: "0" })).toMatchObject({ refused: { reason: "budget_full" } });
    });
  });

  it("keys a refill to the day it was made for", () => {
    expect(dayKey(new Date("2026-11-18T23:59:59Z"))).toBe("2026-11-18");
  });
});
