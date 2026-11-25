// @vitest-environment node
// D173: canned buttons route on their id without Jev; repairs keep their milestone; vague first messages get ideas;
// shadow-only signals never change the live question set.
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type Db } from "../db/client";
import { buildDeliveries, messages, turnJobs, usageEvents } from "../db/schema";
import { createProjectFromPrompt } from "../projects";
import { signInUser } from "../auth/service";
import { classifyTurn, questions, questionVersion, shadowQuestionVersion, shadowSignals } from "../agent/jev";
import { claimJob, jobContext, startTurn } from "./jobs";
import { prepareJevRouting, shadowJev } from "./jev-routing";
import { answerWithIdeas, APP_IDEAS } from "../agent/first-ideas";
import { deliveryFor } from "../agent/delivery";

const ENV = { JEV_ROUTING: "1", FREE_POLICY: "legacy" };

/** A TypeSafe reply with the named questions answered yes. */
function jevReply(yes: string[], body?: { questions?: Record<string, unknown> }) {
  const keys = Object.keys(body?.questions ?? questions);
  const answers = Object.fromEntries(
    keys.map((k) => [k, k === "kind" ? { type: "choice", choice: "game", confidence: 0.98, probabilities: { game: 0.98 } } : { type: "noul", noul: yes.includes(k) ? 0.99 : 0.01 }]),
  );
  return Response.json({ model: "jev-test", answers, usage: { input_tokens: 300, output_tokens: 30 } });
}
const classify: typeof classifyTurn = (state, signal, _env, opts) => classifyTurn(state, signal, { TYPESAFE_API_KEY: "fixture" }, opts);

async function setup(prompt = "A drawing game for four friends playing together") {
  const db = await createTestDb();
  const user = await signInUser(db, { wallet: "0xabc", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  const project = await createProjectFromPrompt(db, user.id, { prompt, network: "celo-sepolia" });
  const [first] = await db.select().from(messages).where(eq(messages.projectId, project.id));
  return { db, user, project, first };
}

async function runPrepare(db: Db) {
  const job = (await claimJob(db, "w"))!;
  const ctx = await jobContext(db, job, "w", new AbortController().signal);
  await prepareJevRouting(db, job, ctx, classify);
  await db.update(turnJobs).set({ status: "done" }).where(eq(turnJobs.id, job.id));
  return { job, ctx };
}

afterEach(() => vi.unstubAllGlobals());

describe("button turns skip Jev (D173)", () => {
  it("Start building reuses the plan turn's decision: no call, no charge, same milestones", async () => {
    const { db, user, project, first } = await setup();
    const fetch = vi.fn().mockImplementation(async (_url, init) => jevReply(["game", "knownKind", "multiplayer"], JSON.parse(init.body)));
    vi.stubGlobal("fetch", fetch);
    // The plan turn on the first message is classified once.
    await startTurn(db, { userId: user.id, projectId: project.id, mode: "plan", userMessageId: first.id, intake: true }, ENV);
    const plan = await runPrepare(db);
    expect(plan.ctx.decision?.signals.multiplayer).toBe("requested");
    expect(fetch).toHaveBeenCalledTimes(1);

    const started = await startTurn(db, { userId: user.id, projectId: project.id, mode: "build", prompt: "Start building", buildFromIntake: true, action: "start_building" }, ENV);
    expect(started).toHaveProperty("job");
    const build = await runPrepare(db);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(build.ctx.decision?.reusedFrom).toBe(first.id);
    expect(build.ctx.decision?.chargedMicro).toBe(0);
    expect(build.ctx.decision?.relevantFiles).toEqual([]);
    const [saved] = await db.select().from(buildDeliveries);
    expect(saved.plan.milestones.map((m) => m.id)).toEqual(["interface", "multiplayer"]);
    expect(await db.select().from(usageEvents)).toHaveLength(1);
    const [button] = await db.select().from(messages).where(eq(messages.id, build.job.userMessageId));
    expect(button.meta?.turnAction).toBe("start_building");
  });

  it("a repair keeps the current milestone, even when the error mentions a contract and a wallet", async () => {
    const { db, user, project, first } = await setup("A notes app for my class");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await db.update(messages).set({ status: "done" }).where(eq(messages.id, first.id));
    const plan = { ...deliveryFor("A notes app for my class"), completed: 1 };
    await db.insert(buildDeliveries).values({ projectId: project.id, plan });
    const prompt = "The preview shows this error in src/App.tsx:4. Fix it:\nTypeError\nCannot read the wallet contract address";
    await startTurn(db, { userId: user.id, projectId: project.id, mode: "build", prompt, action: "repair" }, ENV);
    const { ctx } = await runPrepare(db);
    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.decision).toBeUndefined();
    expect(ctx.deliveryIndex).toBe(0);
    const [saved] = await db.select().from(buildDeliveries);
    expect(saved.plan.milestones.map((m) => m.id)).toEqual(plan.milestones.map((m) => m.id));
    expect(await db.select().from(usageEvents)).toHaveLength(0);
  });

  it("with the built-in rules too, an old client's pasted error keeps its milestone", async () => {
    const { db, user, project, first } = await setup("A notes app for my class");
    await db.update(messages).set({ status: "done" }).where(eq(messages.id, first.id));
    const plan = { ...deliveryFor("A notes app for my class"), completed: 1 };
    await db.insert(buildDeliveries).values({ projectId: project.id, plan });
    // What the route derives for an old client that sent no id.
    const started = await startTurn(db, { userId: user.id, projectId: project.id, mode: "build", prompt: "The deploy to Celo was stopped because the contract holds other people's money: add G$ staking tests", action: "repair" }, { JEV_ROUTING: "0", FREE_POLICY: "legacy" });
    expect("job" in started && started.job.deliveryIndex).toBe(0);
    const [saved] = await db.select().from(buildDeliveries);
    expect(saved.plan.milestones.map((m) => m.id)).toEqual(["interface"]);
  });

  it("shadow mode doesn't classify a button turn", async () => {
    const { db, user, project, first } = await setup();
    await db.update(messages).set({ status: "done" }).where(eq(messages.id, first.id));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await startTurn(db, { userId: user.id, projectId: project.id, mode: "build", prompt: "Start building", action: "start_building" }, { JEV_ROUTING: "shadow", FREE_POLICY: "legacy" });
    const job = (await claimJob(db, "w"))!;
    await shadowJev(db, job, classify);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("shadow-only signals (D173)", () => {
  it("leave the live question set and its version exactly as #190 set them", async () => {
    expect(questionVersion).toBe("5a17e3a24a8dc6493d755b468eb7789eafd8b8ad8daf37afdae7120a40aa7d15");
    expect(shadowQuestionVersion).not.toBe(questionVersion);
    const fetch = vi.fn().mockImplementation(async (_url, init) => jevReply([], JSON.parse(init.body)));
    vi.stubGlobal("fetch", fetch);
    const live = await classify({ request: "a quiz" });
    const sent = Object.keys(JSON.parse(fetch.mock.calls[0][1].body).questions);
    expect(sent.some((k) => k.startsWith("shadow_"))).toBe(false);
    expect(live.shadow).toBeUndefined();
    expect(live.version).toBe(questionVersion);
  });

  it("are asked and recorded in shadow mode, and change nothing the build uses", async () => {
    const { db, user, project, first } = await setup("I want a receipts app that reads my photo with AI");
    await db.update(messages).set({ status: "done" }).where(eq(messages.id, first.id));
    const fetch = vi.fn().mockImplementation(async (_url, init) => jevReply(["shadow_photoInput", "shadow_inAppAi"], JSON.parse(init.body)));
    vi.stubGlobal("fetch", fetch);
    await startTurn(db, { userId: user.id, projectId: project.id, mode: "build", userMessageId: first.id }, { JEV_ROUTING: "shadow", FREE_POLICY: "legacy" });
    const job = (await claimJob(db, "w"))!;
    await shadowJev(db, job, classify);
    const sent = Object.keys(JSON.parse(fetch.mock.calls[0][1].body).questions);
    expect(sent.filter((k) => k.startsWith("shadow_"))).toHaveLength(Object.keys(shadowSignals).length);
    const [saved] = await db.select().from(messages).where(eq(messages.id, first.id));
    const record = saved.meta?.jevShadow as { version: string; extra: { flagged: string[] } };
    expect(record.version).toBe(shadowQuestionVersion);
    expect(record.extra.flagged).toEqual(["photoInput", "inAppAi"]);
    expect(saved.meta?.jev).toBeUndefined();
    expect(await db.select().from(usageEvents)).toHaveLength(0);
  });
});

describe("first-message ideas (D173)", () => {
  it("answers a vague first message with three ideas, once, with no job", async () => {
    const { db, project, first } = await setup("what should i build with G$?");
    const answered = await answerWithIdeas(db, { projectId: project.id, text: first.content, userMessageId: first.id });
    expect(answered).toBe(first.id);
    const rows = await db.select().from(messages).where(eq(messages.projectId, project.id));
    const reply = rows.find((m) => m.role === "assistant")!;
    expect(reply.meta?.suggestions).toEqual(APP_IDEAS);
    expect(reply.createdAt.getTime()).toBeGreaterThan(rows.find((m) => m.role === "user")!.createdAt.getTime());
    expect(rows.find((m) => m.role === "user")?.status).toBe("done");
    expect(await db.select().from(turnJobs)).toHaveLength(0);
    // The same message sent twice is the same answer, not a build.
    expect(await answerWithIdeas(db, { projectId: project.id, text: first.content, userMessageId: first.id })).toBe(first.id);
    expect((await db.select().from(messages).where(eq(messages.projectId, project.id))).filter((m) => m.role === "assistant")).toHaveLength(1);
    // Asked again: it plans or builds as usual.
    expect(await answerWithIdeas(db, { projectId: project.id, text: "I want to make a G dollar app" })).toBeNull();
  });

  it("never catches a concrete request, a picked idea or a project that has started", async () => {
    const { db, user, project, first } = await setup("A G$ tip jar for my blog");
    expect(await answerWithIdeas(db, { projectId: project.id, text: first.content, userMessageId: first.id })).toBeNull();
    expect(await answerWithIdeas(db, { projectId: project.id, text: APP_IDEAS[0] })).toBeNull();
    await startTurn(db, { userId: user.id, projectId: project.id, mode: "build", userMessageId: first.id }, { FREE_POLICY: "legacy" });
    expect(await answerWithIdeas(db, { projectId: project.id, text: "give me ideas" })).toBeNull();
  });

  it("covers a gallery-template project, which skips the questions", async () => {
    const db = await createTestDb();
    const user = await signInUser(db, { wallet: "0xdef", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    const project = await createProjectFromPrompt(db, user.id, { prompt: "What can I build with G$?", templateId: "classic-halo", network: "celo-sepolia" });
    expect(await answerWithIdeas(db, { projectId: project.id, text: "What can I build with G$?" })).not.toBeNull();
  });
});
