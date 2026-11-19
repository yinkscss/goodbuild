// @vitest-environment node
import { TIC_TAC_TOE } from "../../../test/fixtures/tic-tac-toe";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/server/db/client";
import { buildDeliveries, ledgerEntries, messages, users } from "@/server/db/schema";
import { signInUser } from "@/server/auth/service";
import { createProjectFromPrompt } from "@/server/projects";
import { scriptedModel } from "@/server/agent/fake-model";
import { ModelUnavailableError, type ModelClient } from "@/server/agent/model";
import type { TurnEvent } from "@/lib/turn-types";
import { runTurn } from "@/server/agent/runner";
import { getBalanceMicro, postLedgerEntry } from "@/server/credits/ledger";
import { claimJob, jobContext, startTurn } from "./jobs";

// D153: a project whose first message asked for no on-chain work must still be able to get it later.
const GOAL = "Make me a portfolio site with my work, case studies and an about page";
const ROOT = "0x2222222222222222222222222222222222222222" as const;
const identity = { readIdentity: async () => ({ root: ROOT, expiresAt: new Date("2099-01-01") }) };
const ENV = { FREE_POLICY: "legacy", FIRST_DELIVERY_MICRO: "1000000", BUILD_REPAIR_MICRO: "1000000" };
const PAID = { ...ENV, FREE_POLICY: "verified" };
const TIP_JAR = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract TipJar { event Tip(address from, uint256 amount); }\n";
let db: Db, userId: string, projectId: string;

beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: ROOT, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  await db.update(users).set({ verifiedAt: new Date(), goodidRoot: ROOT }).where(eq(users.id, userId));
  projectId = (await createProjectFromPrompt(db, userId, { prompt: GOAL, network: "celo-sepolia" })).id;
  // The first interface, sponsored as usual.
  const first = await startTurn(db, { userId, projectId, mode: "build", prompt: GOAL }, ENV, identity);
  if ("refused" in first) throw new Error(first.refused.message);
  expect((await run(scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: TIC_TAC_TOE } }] }, { text: "Ready" }]).client)).status).toBe("ready");
  await postLedgerEntry(db, { userId, kind: "adjust", amountMicro: 1_000_000, idempotencyKey: "delivery-extension-fixture" });
});

async function run(model: ModelClient, events: TurnEvent[] = []) {
  const job = await claimJob(db, "test");
  if (!job) throw new Error("No job");
  const ctx = await jobContext(db, job, "test", new AbortController().signal);
  return runTurn({ db, model, job: ctx, typeCheckMode: "off", review: false, runCheck: async () => ({ ran: true, issues: [], deliveryVerified: true, note: "Browser fixture", ms: 1 }) }, { projectId, userId, mode: "build", userMessageId: job.userMessageId }, (e) => events.push(e));
}
async function paidStart(prompt: string) {
  const started = await startTurn(db, { userId, projectId, mode: "build", prompt }, PAID);
  if (!("job" in started)) throw new Error("Paid build refused");
  expect(started.job.funding).toBe("paid");
  return started.job;
}
const plan = async () => (await db.select().from(buildDeliveries).where(eq(buildDeliveries.projectId, projectId)))[0].plan;
const toolResults = (model: ReturnType<typeof scriptedModel>) => model.requests.flatMap((r) => r.messages.filter((m) => m.role === "tool").map((m) => String(m.content)));

describe("adding milestones after the first delivery (D153)", () => {
  it("starts the on-chain milestone when a later request asks for a G$ tip jar contract", async () => {
    expect((await plan()).milestones.map((m) => m.id)).toEqual(["interface"]);
    const job = await paidStart("Make the tip box take real G$ with a tip jar contract");
    const extended = await plan();
    expect(extended.milestones.map((m) => m.id)).toEqual(["interface", "payments"]);
    expect(job.deliveryIndex).toBe(1);
    const model = scriptedModel([{ tools: [{ name: "create_file", args: { path: "contracts/TipJar.sol", content: TIP_JAR } }] }, { text: "Added the tip jar." }]);
    await run(model.client);
    expect(toolResults(model).some((r) => r.includes("Refused by the server"))).toBe(false);
  });

  it("picks the milestone from a queued message's text when the start names only its id", async () => {
    const [queued] = await db.insert(messages).values({ projectId, role: "user", content: "Add a G$ tip jar contract", status: "queued" }).returning();
    const started = await startTurn(db, { userId, projectId, mode: "build", userMessageId: queued.id }, PAID);
    if (!("job" in started)) throw new Error("Paid build refused");
    expect((await plan()).milestones.map((m) => m.id)).toEqual(["interface", "payments"]);
    expect(started.job.deliveryIndex).toBe(1);
  });

  it("keeps ordinary edits in the delivered scope", async () => {
    const job = await paidStart("Make the about page heading bigger");
    expect(job.deliveryIndex).toBe(0);
    expect((await plan()).milestones.map((m) => m.id)).toEqual(["interface"]);
  });

  it("refunds a paid turn that the milestone scope refused and that changed nothing, and says how to proceed", async () => {
    await paidStart("Make the tip box real");
    const before = await getBalanceMicro(db, userId);
    const model = scriptedModel([{ tools: [{ name: "create_file", args: { path: "contracts/TipJar.sol", content: TIP_JAR } }] }, { text: "The tip box stays a preview for now." }]);
    const record = await run(model.client);
    expect(record.status).toBe("answered");
    expect(record.chargedMicro).toBeGreaterThan(0);
    expect(record.refundedMicro).toBe(record.chargedMicro);
    const refusal = toolResults(model).find((r) => r.includes("Refused by the server"));
    expect(refusal).toContain("names the on-chain feature");
    expect(refusal).not.toMatch(/later saved milestone/);
    // The hold and its charges settle against the balance; the refund puts the charge back.
    expect(await getBalanceMicro(db, userId)).toBe(before);
    expect((await db.select().from(ledgerEntries).where(eq(ledgerEntries.refType, "scope_refund")))).toHaveLength(1);
  });

  it("shows the refund live, before the turn's done event", async () => {
    await paidStart("Make the tip box real");
    const events: TurnEvent[] = [];
    await run(scriptedModel([{ tools: [{ name: "create_file", args: { path: "contracts/TipJar.sol", content: TIP_JAR } }] }, { text: "Still a preview." }]).client, events);
    const done = events.findIndex((e) => e.type === "done");
    const refunded = events.findIndex((e) => e.type === "snapshot" && (e.record.refundedMicro ?? 0) > 0);
    expect(refunded).toBeGreaterThanOrEqual(0);
    expect(refunded).toBeLessThan(done);
  });

  it("refunds a refused turn that then ends with a provider error, once", async () => {
    await paidStart("Make the tip box real");
    const before = await getBalanceMicro(db, userId);
    const refused = scriptedModel([{ tools: [{ name: "create_file", args: { path: "contracts/TipJar.sol", content: TIP_JAR } }] }]);
    let calls = 0;
    const failing: ModelClient = { async *stream(req) { if (calls++ === 0) yield* refused.client.stream(req); else throw new ModelUnavailableError("The AI provider is unavailable."); } };
    const record = await run(failing);
    expect(record.status).toBe("error");
    expect(record.chargedMicro).toBeGreaterThan(0);
    expect(record.refundedMicro).toBe(record.chargedMicro);
    expect(await getBalanceMicro(db, userId)).toBe(before);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.refType, "scope_refund"))).toHaveLength(1);
  });
});
