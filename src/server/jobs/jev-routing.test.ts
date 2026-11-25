// @vitest-environment node
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { createTestDb } from "../db/client";
import { buildDeliveries, messages, usageEvents, turnJobs } from "../db/schema";
import { createProjectFromPrompt } from "../projects";
import { signInUser } from "../auth/service";
import { classifyTurn, questions } from "../agent/jev";
import { claimJob, startTurn, jobContext } from "./jobs";
import { prepareJevRouting } from "./jev-routing";
import { fallbackIntake } from "../agent/plan-intake";

it("uses the funded decision for delivery and intake and reuses it after a worker interruption", async () => {
  const db = await createTestDb();
  const user = await signInUser(db, {
    wallet: "0xabc",
    walletKind: "external",
    attestation: { ageOk: true, notUsPerson: true },
  });
  const project = await createProjectFromPrompt(db, user.id, {
    prompt: "Four friends draw together with no wallet",
    network: "celo-sepolia",
  });
  const [message] = await db.select().from(messages).where(eq(messages.projectId, project.id));
  const queued = await startTurn(
    db,
    { userId: user.id, projectId: project.id, mode: "build", userMessageId: message.id },
    { JEV_ROUTING: "1", FREE_POLICY: "legacy" },
  );
  expect(queued).toHaveProperty("job");
  const job = (await claimJob(db, "jev-worker"))!;
  const ctx = await jobContext(db, job, "jev-worker", new AbortController().signal);
  const answers = Object.fromEntries(
    Object.keys(questions).map((k) => [
      k,
      k === "kind"
        ? { type: "choice", choice: "game", confidence: 0.98, probabilities: { game: 0.98 } }
        : { type: "noul", noul: ["game", "knownKind", "multiplayer", "wallet_excluded"].includes(k) ? 0.99 : 0.01 },
    ]),
  );
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ model: "jev-test", answers, usage: { input_tokens: 300, output_tokens: 30 } }));
  vi.stubGlobal("fetch", fetch);
  try {
    const classify: typeof classifyTurn = (state, signal) => classifyTurn(state, signal, { TYPESAFE_API_KEY: "fixture" });
    await prepareJevRouting(db, job, ctx, classify);
    expect(ctx.deliveryIndex).toBe(0);
    const [saved] = await db.select().from(buildDeliveries);
    expect(saved.plan.milestones.map((m) => m.id)).toEqual(["interface", "multiplayer"]);
    expect(saved.plan.displayKind).toBe("game");
    expect(fallbackIntake(message.content, ctx.decision).questions.some((q) => q.id === "minipay")).toBe(false);
    const [stored] = await db.select().from(turnJobs).where(eq(turnJobs.id, job.id));
    const resumed = await jobContext(db, stored, "jev-worker", new AbortController().signal);
    await prepareJevRouting(db, stored, resumed, classify);
    expect(resumed.decision).toEqual(ctx.decision);
    expect(resumed.deliveryIndex).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await db.select().from(usageEvents)).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

import { resolveAnswers, features, type JevResponse } from "../agent/jev";
import { requestedMilestones } from "../agent/delivery";

const respond = (set: Record<string, number>): JevResponse => ({
  model: "jev-test",
  usage: { input_tokens: 1, output_tokens: 0 },
  answers: Object.fromEntries(
    [...Object.keys(features), ...Object.keys(features).map((k) => k + "_excluded")].map((k) => [
      k,
      { type: "noul" as const, noul: set[k] ?? 0.01 },
    ]),
  ),
});

it("resolves requested, excluded, unspecified and conflicting answers", () => {
  const s = resolveAnswers(respond({ multiplayer: 0.97, wallet_excluded: 0.95, game: 0.9, game_excluded: 0.9, shop: 0.35 }));
  expect(s.multiplayer).toBe("requested");
  expect(s.wallet).toBe("excluded");
  expect(s.dashboard).toBe("unspecified");
  expect(s.game).toBe("unclear");
  expect(s.shop).toBe("unclear");
});

it("gives intake and delivery the same answer: four players is multiplayer, no wallet means no wallet milestone", () => {
  const decision = { signals: resolveAnswers(respond({ multiplayer: 0.97, wallet_excluded: 0.95 })) } as never;
  const ids = requestedMilestones("a game for four players, no wallet", decision).map((m) => m.id);
  expect(ids).toContain("multiplayer");
  expect(ids).not.toContain("wallet");
});

it("falls back to the built-in rules and charges nothing when Jev is unavailable", async () => {
  const db = await createTestDb();
  const user = await signInUser(db, { wallet: "0xdef", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  const project = await createProjectFromPrompt(db, user.id, { prompt: "A tic tac toe game", network: "celo-sepolia" });
  const [message] = await db.select().from(messages).where(eq(messages.projectId, project.id));
  await startTurn(db, { userId: user.id, projectId: project.id, mode: "build", userMessageId: message.id }, { JEV_ROUTING: "1", FREE_POLICY: "legacy" });
  const job = (await claimJob(db, "w2"))!;
  const ctx = await jobContext(db, job, "w2", new AbortController().signal);
  await prepareJevRouting(db, job, ctx, async () => {
    throw new Error("Jev classification failed (HTTP 503)");
  });
  expect(ctx.decision).toBeUndefined();
  const [saved] = await db.select().from(buildDeliveries);
  expect(saved.plan.milestones.length).toBeGreaterThan(0);
  expect(await db.select().from(usageEvents)).toHaveLength(0);
});

import { shadowJev } from "./jev-routing";

it("shadow mode records where Jev and the built-in rules disagree and changes nothing else", async () => {
  const db = await createTestDb();
  const user = await signInUser(db, { wallet: "0x123", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  const project = await createProjectFromPrompt(db, user.id, { prompt: "A gallery about wallets. Visitors never connect one.", network: "celo-sepolia" });
  const [message] = await db.select().from(messages).where(eq(messages.projectId, project.id));
  await startTurn(db, { userId: user.id, projectId: project.id, mode: "build", userMessageId: message.id }, { FREE_POLICY: "legacy" });
  const job = (await claimJob(db, "w3"))!;
  const answers = Object.fromEntries(
    Object.keys(questions).map((k) => [k, k === "kind" ? { type: "choice", choice: "custom", confidence: 0.9, probabilities: { custom: 0.9 } } : { type: "noul", noul: k === "wallet_excluded" ? 0.9 : 0.01 }]),
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ model: "jev-test", answers, usage: { input_tokens: 5, output_tokens: 0 } })));
  try {
    await shadowJev(db, job, (state, signal) => classifyTurn(state, signal, { TYPESAFE_API_KEY: "fixture" }));
    const [saved] = await db.select().from(messages).where(eq(messages.id, message.id));
    const shadow = saved.meta?.jevShadow as { disagreements: { feature: string; legacy: boolean; jev: string }[] };
    expect(shadow.disagreements).toContainEqual({ feature: "wallet", legacy: true, jev: "excluded" });
    expect(await db.select().from(usageEvents)).toHaveLength(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

import { parseIntake } from "../agent/plan-intake";
import { isContinuation } from "../agent/jev";

it("treats 'continue.' and 'continue!' as continuing, and a question with no topic by its words", () => {
  expect(isContinuation("continue.")).toBe(true);
  expect(isContinuation("Continue building!")).toBe(true);
  expect(isContinuation("continue the colours")).toBe(false);
  const decision = { signals: resolveAnswers(respond({ game: 0.9 })) } as never;
  const args = JSON.stringify({
    summary: "s",
    questions: [
      { question: "Which colours do you like?", label: "Colours", options: [{ label: "Blue" }, { label: "Green" }] },
      { question: "What gets in the way?", label: "Hazards", topic: "obstacles", options: [{ label: "Rocks" }, { label: "Trees" }] },
    ],
    game_brief: { name: "Run", pitch: "p", loop: "l", lose: "x" },
  });
  const parsed = parseIntake(args, "a running game", decision);
  expect(parsed?.questions.some((q) => /colours do you like/i.test(q.question) && q.id.startsWith("q") && !q.topic?.match(/palette/))).toBe(false);
});
