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
import { ModelUnavailableError, ProviderFundsError, type ModelClient } from "@/server/agent/model";
import { runTurn } from "@/server/agent/runner";
import { loadFiles } from "@/server/agent/store";
import { OutOfCreditsError } from "@/server/credits/holds";
import { getBalanceMicro, postLedgerEntry } from "@/server/credits/ledger";
import { recordUsage } from "@/server/agent/store";
import { sponsorshipCanCall } from "@/server/credits/build-sponsorship";
import { claimJob, jobContext, startTurn } from "./jobs";
import { continueOnCredits, holdAfterProviderFunds } from "./worker";
import { checkHolds, enqueueTurn, stopProject } from "./jobs";
import { anyProviderPaused, pauseProvider, projectWaiting, resumeProvider } from "@/server/agent/provider-status";
import { providerStatus } from "@/server/db/provider-schema";

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
async function run(model: ModelClient, runtime = true, verified = runtime) {
  const job = await claimJob(db, "test");
  if (!job) throw new Error("No job");
  const ctx = await jobContext(db, job, "test", new AbortController().signal);
  return runTurn({ db, model, job: ctx, typeCheckMode: "off", review: false, runCheck: async () => ({ ran: runtime, issues: [], deliveryVerified: verified, note: "Browser fixture", ms: 1 }) }, { projectId, userId, mode: "build", userMessageId: job.userMessageId }, () => {});
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
    // D164: the end in plain words, and next steps a person understands.
    expect(record.outcome?.headline).toMatch(/^Your app's screens are built\./);
    // The builder's own reply stays under the milestone's headline (deploy details, for a payments milestone).
    expect(record.outcome?.detail).toBe("Ready");
    expect(record.outcome?.later).toBe("Connect a wallet, play with others, payments on Celo come next. Payments are off until then.");
    expect(record.suggestions).toEqual(["Connect a wallet", "Play with others"]);
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
    const args = { projectId, userId, mode: "build" as const, retryOfJobId: source.id, retryNote: "The preview shows this error. Fix it:\nTypeError: x is undefined" };
    const a = await startTurn(db, args, ENV, identity);
    const b = await startTurn(db, args, { ...ENV, BUILD_SPONSOR_BUDGET_MICRO: "0" }, identity);
    expect(a).toHaveProperty("job");
    if (!("job" in a) || !("job" in b)) throw new Error("Retry refused");
    expect(a.job.id).toBe(b.job.id);
    expect(a.job.funding).toBe("platform");
    const [retryMessage] = await db.select().from(messages).where(eq(messages.id, a.job.userMessageId));
    expect(retryMessage.meta?.action).toBe("retry");
    expect((await db.select().from(buildDrafts).where(eq(buildDrafts.jobId, a.job.id)))[0].files["src/App.tsx"]).toBe(APP);
    // D164: the one button carries the preview's crash into the retry's notes for the builder.
    expect((await db.select().from(buildDrafts).where(eq(buildDrafts.jobId, a.job.id)))[0].diagnostics).toContain("TypeError: x is undefined");
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

  it("saves a milestone whose browser check couldn't run, marked as needing verification (D162)", async () => {
    await start();
    const result = await run(scriptedModel([writeApp, { text: "Done" }]).client, false);
    expect(result.status).toBe("ready");
    expect(result.version).toBe(1);
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toBe(APP);
    const plan = (await db.select().from(buildDeliveries))[0].plan;
    expect(plan.completed).toBe(1);
    expect(plan.verified ?? []).not.toContain("interface");
    expect(result.delivery?.remaining[0]).toBe("Working first interface (needs verification)");
    expect(result.log).toContain("· the browser check couldn't run, so this milestone is saved and marked as needing verification");
  });

  it("keeps a milestone whose browser check ran and failed in the draft without replacing the working version", async () => {
    const job = await start();
    const result = await run(scriptedModel([writeApp, { text: "Done" }]).client, true, false);
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
    // The second repair isn't sponsored again: it runs on the person's own credits, unasked (owner, 23 Nov 2026).
    const next = await startTurn(db, { projectId, userId, mode: "build", retryOfJobId: retry.job.id }, ENV, identity);
    expect("job" in next && next.job.funding).not.toBe("platform");
    expect(await db.select().from(buildSponsorships)).toHaveLength(2);
  });

  it("carries on with credits, unasked, when the free allowance runs out partway (owner, 23 Nov 2026)", async () => {
    const tiny = { ...ENV, FIRST_DELIVERY_MICRO: "1" };
    const started = await startTurn(db, { userId, projectId, mode: "build", prompt: GOAL }, tiny, identity);
    if (!("job" in started)) throw new Error("Refused");
    expect(started.job.funding).toBe("platform");
    const record = await run(scriptedModel([writeApp, { text: "Ready" }]).client);
    expect(record.status).toBe("error");
    expect(await continueOnCredits(db, started.job, record, tiny)).toBe(true);
    const next = (await db.select().from(turnJobs).where(eq(turnJobs.retryOfJobId, started.job.id)))[0];
    expect(next.status).toBe("queued");
    expect(next.funding).not.toBe("platform");
    // Only an allowance stop continues: other failures keep their card.
    expect(await continueOnCredits(db, started.job, { status: "error", error: "boom" }, tiny)).toBe(false);
  });

  it("gives the free allowance back when our AI account was empty and the build can't be held (23 Nov 2026)", async () => {
    const source = await start();
    expect(source.funding).toBe("platform");
    const empty: ModelClient = { async *stream() { throw new ProviderFundsError("The AI provider account is out of funds (DeepSeek, 402): Insufficient Balance"); } };
    const record = await run(empty);
    expect(record.status).toBe("error");
    // Something else is already waiting on the project, so the failed build isn't held: its allowance goes back.
    await db.insert(turnJobs).values({ projectId, userId, mode: "build", prompt: "x", userMessageId: crypto.randomUUID(), funding: "free" });
    expect(await holdAfterProviderFunds(db, source, record, ENV)).toBe(false);
    expect(await db.select().from(buildSponsorships)).toHaveLength(0);
    await db.delete(turnJobs).where(eq(turnJobs.prompt, "x"));
    await resumeProvider(db, "deepseek", "test");
    // The retry is sponsored again instead of charging credits.
    const retry = await startTurn(db, { projectId, userId, mode: "build", retryOfJobId: source.id }, ENV, identity);
    expect("job" in retry && retry.job.funding).toBe("platform");
  });

  it("D177: pauses builds on an empty AI account, holds the failed build once on its own allowance, and starts it when the account works", async () => {
    const source = await start();
    const empty: ModelClient = { async *stream() { throw new ProviderFundsError("The AI provider account is out of funds (DeepSeek, 402): Insufficient Balance"); } };
    const record = await run(empty);
    expect(record.status).toBe("error");
    expect(await anyProviderPaused(db)).toBe(true);
    const [allowance] = await db.select().from(buildSponsorships);

    expect(await holdAfterProviderFunds(db, source, record, ENV)).toBe(true);
    const [held] = await db.select().from(turnJobs).where(eq(turnJobs.retryOfJobId, source.id));
    expect(held.status).toBe("queued");
    expect(held.funding).toBe("platform");
    // The same free allowance moved across: nothing new used, nothing charged.
    expect(await db.select().from(buildSponsorships)).toEqual([{ ...allowance, jobId: held.id }]);
    expect(await getBalanceMicro(db, userId)).toBe(0);
    // Tapping again can't add more: one retry per failure.
    const again = await startTurn(db, { projectId, userId, mode: "build", retryOfJobId: source.id }, ENV, identity);
    expect("job" in again && again.job.id).toBe(held.id);
    await holdAfterProviderFunds(db, source, record, ENV);
    expect(await db.select().from(turnJobs).where(eq(turnJobs.retryOfJobId, source.id))).toHaveLength(1);

    // While paused nothing starts, and the stuck-hold check leaves it alone even after hours.
    expect(await claimJob(db, "test")).toBeNull();
    await db.update(turnJobs).set({ createdAt: new Date(Date.now() - 7 * 3600_000) }).where(eq(turnJobs.id, held.id));
    expect((await checkHolds(db)).failed).toEqual([]);

    // The account works again: it starts, in order, and runs once.
    expect(await resumeProvider(db, "deepseek", "test")).toBe(true);
    expect((await db.select().from(providerStatus))[0].resumedAt).not.toBeNull();
    const rerun = await run(empty);
    expect(rerun.status).toBe("error");
    const ran = (await db.select().from(turnJobs).where(eq(turnJobs.id, held.id)))[0];
    // It failed again (the account emptied again): it isn't held a second time, and its unspent allowance goes back.
    expect(await holdAfterProviderFunds(db, ran, rerun, ENV)).toBe(false);
    expect(await db.select().from(turnJobs).where(eq(turnJobs.retryOfJobId, held.id))).toHaveLength(0);
    expect(await db.select().from(buildSponsorships)).toHaveLength(0);
  });

  it("D177: stopping a held request gives its free allowance back, and the build can be retried again", async () => {
    const source = await start();
    const empty: ModelClient = { async *stream() { throw new ProviderFundsError("The AI provider account is out of funds (DeepSeek, 402): Insufficient Balance"); } };
    const record = await run(empty);
    expect(await holdAfterProviderFunds(db, source, record, ENV)).toBe(true);
    const [held] = await db.select().from(turnJobs).where(eq(turnJobs.retryOfJobId, source.id));
    await stopProject(db, projectId);
    expect(await db.select().from(buildSponsorships)).toHaveLength(0);
    await resumeProvider(db, "deepseek", "test");
    const again = await startTurn(db, { projectId, userId, mode: "build", retryOfJobId: source.id }, ENV, identity);
    if (!("job" in again)) throw new Error(again.refused.message);
    expect(again.job.id).not.toBe(held.id);
    expect(again.job.funding).toBe("platform");
  });

  it("D177: an empty Anthropic account holds only the re-run of a build that failed on Anthropic", async () => {
    const source = await start();
    await db.update(turnJobs).set({ status: "error", error: "The AI provider account is out of funds (Anthropic, 402): billing_error" }).where(eq(turnJobs.id, source.id));
    await pauseProvider(db, "anthropic", "billing_error", {});
    const rerun = await startTurn(db, { projectId, userId, mode: "build", retryOfJobId: source.id, held: true }, ENV);
    if (!("job" in rerun)) throw new Error("not held");
    expect(await claimJob(db, "test")).toBeNull();
    // Another project's ordinary build starts on DeepSeek as usual.
    const other = (await createProjectFromPrompt(db, userId, { prompt: "A club page", network: "celo-sepolia" })).id;
    const plain = await enqueueTurn(db, { userId, projectId: other, mode: "build", prompt: "A club page" }, ENV);
    expect((await claimJob(db, "test"))?.id).toBe(plain.id);
    expect(await projectWaiting(db, projectId)).toBe(true);
    expect(await projectWaiting(db, other)).toBe(false);
    await resumeProvider(db, "anthropic", "test", {});
    expect((await claimJob(db, "test"))?.id).toBe(rerun.job.id);
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

  it("does not treat deferred features as permission to build another milestone automatically", async () => {
    await start();
    const model = scriptedModel([writeApp, { text: "The local interface is done. Still to come are wallet connection and staking." }]);
    const record = await run(model.client);
    expect(record.status).toBe("ready");
    expect(model.requests).toHaveLength(2);
    expect(record.delivery?.remaining).toContain("Wallet connection");
  });

  it("keeps paid pauses and explicit continuations separate from sponsorship, even without a new edit", async () => {
    await postLedgerEntry(db, { userId, kind: "adjust", amountMicro: 1_000_000, idempotencyKey: "paid-pause-fixture" });
    const env = { ...ENV, FREE_POLICY: "verified" };
    const started = await startTurn(db, { projectId, userId, mode: "build", prompt: GOAL }, env);
    if (!("job" in started)) throw new Error("Paid build refused");
    expect(started.job.funding).toBe("paid");
    const write = scriptedModel([writeApp]);
    let n = 0;
    const paused: ModelClient = { async *stream(req) { if (n++ === 0) yield* write.client.stream(req); else throw new OutOfCreditsError(); } };
    expect((await run(paused)).paused).toBe("credits");
    expect(await loadFiles(db, projectId)).toEqual({});
    const retry = await startTurn(db, { projectId, userId, mode: "build", retryOfJobId: started.job.id, useCredits: true }, env, identity);
    if (!("job" in retry)) throw new Error("Paid continuation refused");
    expect(retry.job.funding).toBe("paid");
    const insufficient: ModelClient = { async *stream() { throw new OutOfCreditsError(); } };
    const again = await run(insufficient);
    expect(again.paused).toBe("credits");
    expect(again.draftSaved).toBe(true);
    expect(await db.select().from(buildSponsorships)).toHaveLength(0);
    const next = await startTurn(db, { projectId, userId, mode: "build", retryOfJobId: retry.job.id, useCredits: true }, env, identity);
    expect("job" in next && next.job.funding).toBe("paid");
    expect((await run(scriptedModel([{ text: "Resumed" }]).client)).status).toBe("ready");
  });

});
