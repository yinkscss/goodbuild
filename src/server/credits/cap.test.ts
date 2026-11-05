// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { usageEvents, users } from "@/server/db/schema";
import { enqueueTurn } from "@/server/jobs/jobs";
import { createProjectFromPrompt } from "@/server/projects";
import { eq } from "drizzle-orm";
import { checkAiAllowance, spentMicro } from "./cap";

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
