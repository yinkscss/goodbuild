// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { turnJobs, usageEvents, users } from "@/server/db/schema";
import { enqueueTurn } from "@/server/jobs/jobs";
import { createProjectFromPrompt } from "@/server/projects";
import { eq } from "drizzle-orm";
import { BUDGET_MESSAGE, checkAiAllowance, spentMicro } from "./cap";

const WALLET = "0x7a3000000000000000000000000000000000e41c";
let db: Db;
let userId: string;
let projectId: string;

async function spend(micro: number, callId: string) {
  await db.insert(usageEvents).values({ userId, projectId, callId, model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: micro, chargedMicro: micro, markupBps: 0 });
}

beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: WALLET, walletKind: "embedded", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  projectId = (await createProjectFromPrompt(db, userId, { prompt: "A club fund", network: "celo-sepolia" })).id;
});

describe("the free AI cap", () => {
  it("allows spending up to $0.20, then stops, counting across projects", async () => {
    const other = await createProjectFromPrompt(db, userId, { prompt: "Another", network: "celo-sepolia" });
    await spend(150_000, "a");
    expect(await checkAiAllowance(db, { userId, projectId }, {})).toEqual({ allowed: true });
    await db.insert(usageEvents).values({ userId, projectId: other.id, callId: "b", model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: 50_000, chargedMicro: 50_000, markupBps: 0 });
    expect(await spentMicro(db, userId)).toBe(200_000);
    expect(await checkAiAllowance(db, { userId, projectId }, {})).toMatchObject({ allowed: false, reason: "free_limit" });
  });

  it("doesn't apply to verified users or wallets exempted for running the service", async () => {
    await spend(500_000, "a");
    expect(await checkAiAllowance(db, { userId }, { UNCAPPED_WALLETS: `0xother, ${WALLET.toUpperCase().replace("0X", "0x")}` })).toEqual({ allowed: true });
    await db.update(users).set({ verifiedAt: new Date() }).where(eq(users.id, userId));
    expect(await checkAiAllowance(db, { userId }, {})).toEqual({ allowed: true });
  });

  it("allows one project's build at a time, so parallel builds can't overrun it", async () => {
    await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "first" });
    const other = await createProjectFromPrompt(db, userId, { prompt: "Another", network: "celo-sepolia" });
    expect(await checkAiAllowance(db, { userId, projectId: other.id }, {})).toMatchObject({ allowed: false, reason: "one_build_at_a_time" });
    expect(await checkAiAllowance(db, { userId, projectId }, {})).toEqual({ allowed: true });
  });
});

describe("the total free budget", () => {
  const BUDGET = { FREE_AI_BUDGET_MICRO: "1000000" };

  /** A new account, with its own spending under its own $0.20 cap, and the rest spent by others. */
  async function otherAccount(wallet: string, spentByThem: number) {
    const other = await signInUser(db, { wallet, walletKind: "embedded", attestation: { ageOk: true, notUsPerson: true } });
    const project = await createProjectFromPrompt(db, other.id, { prompt: "Theirs", network: "celo-sepolia" });
    await db.insert(usageEvents).values({ userId: other.id, projectId: project.id, callId: wallet, model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: spentByThem, chargedMicro: spentByThem, markupBps: 0 });
    return { userId: other.id, projectId: project.id };
  }

  it("stops a fresh account once everyone's spending reaches it", async () => {
    await otherAccount("0x7a3000000000000000000000000000000000e41d", 999_999);
    expect(await checkAiAllowance(db, { userId, projectId }, BUDGET)).toEqual({ allowed: true });
    await otherAccount("0x7a3000000000000000000000000000000000e41e", 1);
    expect(await checkAiAllowance(db, { userId, projectId }, BUDGET)).toEqual({ allowed: false, reason: "budget_full", message: BUDGET_MESSAGE });
  });

  it("counts real provider cost, not the marked-up charge", async () => {
    await db.insert(usageEvents).values({ userId, projectId, callId: "a", model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: 100_000, chargedMicro: 125_000, markupBps: 2500 });
    expect(await checkAiAllowance(db, { userId, projectId }, { FREE_AI_BUDGET_MICRO: "100001" })).toEqual({ allowed: true });
    expect(await checkAiAllowance(db, { userId, projectId }, { FREE_AI_BUDGET_MICRO: "100000" })).toMatchObject({ reason: "budget_full" });
  });

  it("holds back room for builds in progress, so many at once can't overrun it", async () => {
    const other = await otherAccount("0x7a3000000000000000000000000000000000e41d", 0);
    await enqueueTurn(db, { projectId: other.projectId, userId: other.userId, mode: "build", prompt: "theirs" });
    expect(await checkAiAllowance(db, { userId, projectId }, { FREE_AI_BUDGET_MICRO: "350001" })).toEqual({ allowed: true });
    expect(await checkAiAllowance(db, { userId, projectId }, { FREE_AI_BUDGET_MICRO: "350000" })).toMatchObject({ reason: "budget_full" });
  });

  it("lets the worker start a claimed build without counting it or queued builds", async () => {
    const job = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "first" });
    const other = await otherAccount("0x7a3000000000000000000000000000000000e41d", 0);
    await enqueueTurn(db, { projectId: other.projectId, userId: other.userId, mode: "build", prompt: "queued" });
    await db.update(turnJobs).set({ status: "running" }).where(eq(turnJobs.id, job.id));
    expect(await checkAiAllowance(db, { userId, startingJobId: job.id }, { FREE_AI_BUDGET_MICRO: "1" })).toEqual({ allowed: true });
  });

  it("also covers verified accounts, but not wallets exempted for running the service", async () => {
    await otherAccount("0x7a3000000000000000000000000000000000e41d", 1_000_000);
    expect(await checkAiAllowance(db, { userId }, { ...BUDGET, UNCAPPED_WALLETS: WALLET })).toEqual({ allowed: true });
    await db.update(users).set({ verifiedAt: new Date() }).where(eq(users.id, userId));
    expect(await checkAiAllowance(db, { userId }, BUDGET)).toMatchObject({ reason: "budget_full" });
  });

  it("defaults to $4, and 0 turns free AI off", async () => {
    expect(await checkAiAllowance(db, { userId }, {})).toEqual({ allowed: true });
    expect(await checkAiAllowance(db, { userId }, { FREE_AI_BUDGET_MICRO: "not a number" })).toEqual({ allowed: true });
    expect(await checkAiAllowance(db, { userId }, { FREE_AI_BUDGET_MICRO: "0" })).toMatchObject({ reason: "budget_full" });
    await otherAccount("0x7a3000000000000000000000000000000000e41d", 4_000_000);
    expect(await checkAiAllowance(db, { userId }, {})).toMatchObject({ reason: "budget_full" });
  });
});
