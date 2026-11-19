// @vitest-environment node
import { TIC_TAC_TOE } from "../../../test/fixtures/tic-tac-toe";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type Db } from "@/server/db/client";
import { buildDeliveries, buildDrafts, buildSponsorships, messages, projects, usageEvents, users } from "@/server/db/schema";
import { signInUser } from "@/server/auth/service";
import { createProjectFromPrompt } from "@/server/projects";
import { scriptedModel } from "@/server/agent/fake-model";
import { LeaseLostError } from "@/server/agent/turn-progress";
import { runCheck, closeRunCheckBrowser } from "@/server/agent/run-check";
import { turnJobs, turnJobCalls } from "@/server/db/schema";
import { ModelUnavailableError, type ModelClient } from "@/server/agent/model";
import { runTurn } from "@/server/agent/runner";
import { loadFiles } from "@/server/agent/store";
import { getBalanceMicro } from "@/server/credits/ledger";
import { recordUsage } from "@/server/agent/store";
import { sponsorshipCanCall } from "@/server/credits/build-sponsorship";
import { claimJob, jobContext, startTurn } from "./jobs";

const GOAL = "Make a Tic-tac-toe game, people connect their wallet, stake G$ and play amongst themselves. Make it fun and interactive";
const APP = TIC_TAC_TOE;
const ROOT = "0x1111111111111111111111111111111111111111" as const;
const identity = { readIdentity: async () => ({ root: ROOT, expiresAt: new Date("2099-01-01") }) };
const ENV = { FREE_POLICY: "legacy", FIRST_DELIVERY_MICRO: "1000000", BUILD_REPAIR_MICRO: "1000000" };
let db: Db, userId: string, projectId: string;
beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: ROOT, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  await db.update(users).set({ verifiedAt: new Date(), goodidRoot: ROOT }).where(eq(users.id, userId));
  projectId = (await createProjectFromPrompt(db, userId, { prompt: GOAL, network: "celo-sepolia" })).id;
});
async function start(prompt = GOAL) {
  const result = await startTurn(db, { userId, projectId, mode: "build", prompt }, ENV, identity);
  if ("refused" in result) throw new Error(result.refused.message);
  return result.job;
}
async function run(model: ModelClient, runtime = true) {
  const job = await claimJob(db, "test");
  if (!job) throw new Error("No job");
  const ctx = await jobContext(db, job, "test", new AbortController().signal);
  return runTurn({ db, model, job: ctx, typeCheckMode: "off", review: false, runCheck: async () => ({ ran: runtime, issues: [], deliveryVerified: runtime, note: "Browser fixture", ms: 1 }) }, { projectId, userId, mode: "build", userMessageId: job.userMessageId }, () => {});
}
const writeApp = { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP } }] };

describe("first delivery and recovery", () => {
  it("sponsors first delivery before a credit hold and preserves deferred scope", async () => {
    const job = await start();
    expect(job.funding).toBe("platform");
    const model = scriptedModel([writeApp, { text: "Ready" }]);
    const record = await run(model.client);
    expect(record.status).toBe("ready");
    expect(record.chargedMicro).toBe(0);
    expect(record.sponsoredMicro).toBeGreaterThan(0);
    expect(await getBalanceMicro(db, userId)).toBe(0);
    expect((await db.select().from(usageEvents)).every((u) => u.funding === "platform")).toBe(true);
    expect(record.delivery?.remaining).toEqual(["Wallet connection", "Multiplayer", "On-chain features and payments"]);
    expect((await db.select().from(buildDeliveries))[0].plan.completed).toBe(1);
    expect(model.requests[0].messages.some((m) => String(m.content).includes("Build ONLY milestone 1"))).toBe(true);
  });

  it("recovers drafts after provider failure and retries exactly once without a forged prompt", async () => {
    const source = await start("Skip the questions, just build it");
    const first = scriptedModel([writeApp]);
    let n = 0;
    const broken: ModelClient = { async *stream(req) { if (n++ === 0) yield* first.client.stream(req); else throw new ModelUnavailableError("provider down"); } };
    const record = await run(broken);
    expect(record.status).toBe("error");
    expect(record.draftSaved).toBe(true);
    expect(await loadFiles(db, projectId)).toEqual({});
    const [draft] = await db.select().from(buildDrafts).where(eq(buildDrafts.jobId, source.id));
    expect(draft.files["src/App.tsx"]).toBe(APP);
    const args = { projectId, userId, mode: "build" as const, retryOfJobId: source.id };
    const a = await startTurn(db, args, ENV, identity);
    const b = await startTurn(db, args, { ...ENV, BUILD_SPONSOR_BUDGET_MICRO: "0" }, identity);
    expect(a).toHaveProperty("job");
    if (!("job" in a) || !("job" in b)) throw new Error("Retry refused");
    expect(a.job.id).toBe(b.job.id);
    expect(a.job.funding).toBe("platform");
    const [retryMessage] = await db.select().from(messages).where(eq(messages.id, a.job.userMessageId));
    expect(retryMessage.meta?.action).toBe("retry");
    expect((await db.select().from(buildDrafts).where(eq(buildDrafts.jobId, a.job.id)))[0].files["src/App.tsx"]).toBe(APP);
    const resumed = await run(scriptedModel([{ text: "Recovered" }]).client);
    expect(resumed.status).toBe("ready");
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toBe(APP);
  });

  it("requires fresh verification and limits subsidy to one delivery per person", async () => {
    await start();
    const other = (await createProjectFromPrompt(db, userId, { prompt: GOAL, network: "celo-sepolia" })).id;
    const result = await startTurn(db, { projectId: other, userId, mode: "build", prompt: GOAL }, ENV, identity);
    expect("job" in result && result.job.funding).not.toBe("platform");
    const expired = await startTurn(db, { projectId: other, userId, mode: "build", prompt: GOAL }, ENV, { readIdentity: async () => ({ root: ROOT, expiresAt: new Date(0) }) });
    expect("job" in expired && expired.job.funding).not.toBe("platform");
    expect(await db.select().from(buildSponsorships)).toHaveLength(1);
  });

  it("reconciles sponsored usage exactly once and refuses uncovered calls", async () => {
    const job = await start();
    expect(await sponsorshipCanCall(db, job.id, 1_000_001)).toBe(false);
    const args = { userId, projectId, jobId: job.id, funding: "platform" as const, messageId: null, callId: "same", model: "deepseek-flash", inputTokens: 100, outputTokens: 100, cachedInputTokens: 0 };
    const one = await db.transaction((tx) => recordUsage(tx as unknown as Db, args));
    await db.transaction((tx) => recordUsage(tx as unknown as Db, args));
    expect((await db.select().from(buildSponsorships))[0].spentMicro).toBe(one.chargedMicro);
    expect(await db.select().from(usageEvents)).toHaveLength(1);
    expect(await getBalanceMicro(db, userId)).toBe(0);
  });

  it("keeps an unverified milestone in the draft without replacing the working version", async () => {
    const job = await start();
    const result = await run(scriptedModel([writeApp, { text: "Done" }]).client, false);
    expect(result.status).toBe("needs_fix");
    expect(result.version).toBeUndefined();
    expect(await loadFiles(db, projectId)).toEqual({});
    expect((await db.select().from(buildDrafts).where(eq(buildDrafts.jobId, job.id)))[0].files["src/App.tsx"]).toBe(APP);
    expect((await db.select().from(buildDeliveries))[0].plan.completed).toBe(0);
  });

  it("refreshes the file after two failed edits and stops a repeated loop early", async () => {
    await start();
    const bad = { tools: [{ name: "edit_file", args: { path: "src/App.tsx", edits: [{ search: "not in file", replace: "oops" }] } }] };
    const model = scriptedModel([writeApp, bad, bad, bad, bad, { text: "Saved" }]);
    const result = await run(model.client);
    expect(result.status).toBe("ready");
    expect(model.requests).toHaveLength(6);
    expect(model.requests[3].messages.some((m) => m.role === "tool" && String(m.content).includes(`Current file:\n${APP}`))).toBe(true);
    expect(result.log.some((l) => l.includes("no progress"))).toBe(true);
  });
  it("refuses stale recovery after a newer checkpoint", async () => {
    const source = await start();
    const broken: ModelClient = { async *stream() { throw new Error("broken"); } };
    await run(broken);
    await db.update(projects).set({ currentVersion: 2 }).where(eq(projects.id, projectId));
    await expect(startTurn(db, { projectId, userId, mode: "build", retryOfJobId: source.id }, ENV, identity)).rejects.toThrow("retry_stale");
  });

  it("does not spend a second repair allowance for the same verified person", async () => {
    const source = await start();
    const broken: ModelClient = { async *stream() { throw new Error("broken"); } };
    await run(broken);
    const retry = await startTurn(db, { projectId, userId, mode: "build", retryOfJobId: source.id }, ENV, identity);
    expect("job" in retry && retry.job.funding).toBe("platform");
    await run(broken);
    if (!("job" in retry)) throw new Error("No retry");
    const next = await startTurn(db, { projectId, userId, mode: "build", retryOfJobId: retry.job.id }, ENV, identity);
    expect(next).toHaveProperty("refused");
    expect(await db.select().from(buildSponsorships)).toHaveLength(2);
  });

  it("keeps failed planning retries on their normal funding path", async () => {
    const source = await startTurn(db, { projectId, userId, mode: "plan", prompt: GOAL, intake: true }, ENV);
    if (!("job" in source)) throw new Error("Plan refused");
    await db.update(projects).set({ currentVersion: 0 }).where(eq(projects.id, projectId));
    const job = await claimJob(db, "test");
    if (!job) throw new Error("Missing job");
    const ctx = await jobContext(db, job, "test", new AbortController().signal);
    const model: ModelClient = { async *stream() { throw new Error("broken"); } };
    await runTurn({ db, model, job: ctx }, { projectId, userId, mode: "plan", userMessageId: job.userMessageId }, () => {});
    const retry = await startTurn(db, { projectId, userId, mode: "build", retryOfJobId: job.id }, ENV, identity);
    expect("job" in retry && retry.job.mode).toBe("plan");
    expect("job" in retry && retry.job.funding).toBe("free");
  });

  it("captures a queued build's actual base version when it starts", async () => {
    await start();
    const queued = await startTurn(db, { projectId, userId, mode: "build", prompt: "Change the colours" }, ENV, identity);
    if (!("job" in queued)) throw new Error("Follow-up refused");
    await run(scriptedModel([writeApp, { text: "Done" }]).client);
    const broken: ModelClient = { async *stream() { throw new Error("broken"); } };
    await run(broken);
    const retry = await startTurn(db, { projectId, userId, mode: "build", retryOfJobId: queued.job.id }, ENV, identity);
    expect("job" in retry).toBe(true);
    const changed = APP.replace("<main>", '<main style={{color:"#592E81"}}>');
    const recovered = await run(scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: changed } }] }, { text: "Recovered the queued edit" }]).client);
    expect(recovered.status).toBe("ready");
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toBe(changed);
  });

  it("replays the first response after a worker crash and passes real browser acceptance", async () => {
    await start();
    const first = await claimJob(db, "crashed");
    if (!first) throw new Error("Missing job");
    const ctx = await jobContext(db, first, "crashed", new AbortController().signal);
    const commit = ctx.commit;
    ctx.commit = async (fn) => {
      const result = await commit(fn);
      if ((await db.select().from(turnJobCalls).where(eq(turnJobCalls.jobId, first.id))).length === 1) throw new LeaseLostError();
      return result;
    };
    await expect(runTurn({ db, model: scriptedModel([writeApp]).client, job: ctx }, { projectId, userId, mode: "build", userMessageId: first.userMessageId }, () => {})).rejects.toBeInstanceOf(LeaseLostError);
    await db.update(turnJobs).set({ leaseExpiresAt: sql`now() - interval '1 second'` }).where(eq(turnJobs.id, first.id));
    const resumed = await claimJob(db, "resumed");
    if (!resumed) throw new Error("Missing resumed job");
    const second = scriptedModel([{ text: "Done" }]);
    try {
      const record = await runTurn({ db, model: second.client, job: await jobContext(db, resumed, "resumed", new AbortController().signal), runCheck, review: false, typeCheckMode: "off" }, { projectId, userId, mode: "build", userMessageId: resumed.userMessageId }, () => {});
      expect(record.status, record.error).toBe("ready");
      expect(second.requests).toHaveLength(1);
      expect(await db.select().from(usageEvents)).toHaveLength(2);
      expect(record.chargedMicro).toBe(0);
    } finally { await closeRunCheckBrowser(); }
  });

  it("reserves finalization before the global call limit and keeps the recoverable draft", async () => {
    const source = await start();
    const job = await claimJob(db, "limit");
    if (!job) throw new Error("No job");
    const writes = (offset: number, count: number) => Array.from({ length: count }, (_, n) => ({ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP.replace("Local/demo", `Local/demo ${offset + n}`) } }] }));
    const model = scriptedModel([...writes(0, 20), { text: "Saving the first pass" }, ...writes(20, 40)]);
    let checks = 0;
    const record = await runTurn({ db, model: model.client, job: await jobContext(db, job, "limit", new AbortController().signal), review: false, typeCheckMode: "off", checkApp: () => ({ ok: false, errors: Array.from({ length: Math.max(1, 3 - checks++) }, (_, n) => ({ file: "src/App.tsx", source: "imports" as const, message: `Injected dependency issue ${n}` })), contracts: [], warnings: [] }) }, { projectId, userId, mode: "build", userMessageId: job.userMessageId }, () => {});
    expect(model.requests).toHaveLength(48);
    expect(record.status).toBe("needs_fix");
    expect(record.error).toBeUndefined();
    expect(record.draftSaved).toBe(true);
    expect((await db.select().from(buildDrafts).where(eq(buildDrafts.jobId, source.id)))[0].files["src/App.tsx"]).toContain("Local/demo 46");
    expect(await loadFiles(db, projectId)).toEqual({});
  });

});
