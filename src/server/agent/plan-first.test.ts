// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { signInUser } from "@/server/auth/service";
import { hasPlanHeadroom, checkAiAllowance, PLAN_HEADROOM_MICRO, UNVERIFIED_CAP_MICRO } from "@/server/credits/cap";
import { messages, projects, turnJobs, usageEvents, users } from "@/server/db/schema";
import { createTestDb, type Db } from "@/server/db/client";
import { enqueueTurn } from "@/server/jobs/jobs";
import { createProjectFromPrompt } from "@/server/projects";
import { workspaceState } from "@/server/workspace-state";
import { chargedMicro, costMicro, estimateTokens } from "@/lib/pricing";
import { nextQuestion } from "@/lib/plan";
import { PALETTES, readTheme } from "@/lib/palettes";
import { AUTO_FIX_LEAD, FIX_PROMPT } from "@/lib/preview-errors";
import { PROMPT_MAX_LENGTH } from "@/lib/prompt";
import type { TurnRecord } from "@/lib/turn-types";

import { demoModel } from "./demo-model";
import { scriptedModel } from "./fake-model";
import { GAME_RULES, INTAKE_MAX_TOKENS, INTAKE_PROMPT, INTAKE_TOOLS, INTAKE_TOOLS_GAME, LEADERBOARD_QUESTION_ID, MINIPAY_QUESTION_ID, fallbackIntake, intakeContext, intakeTools, parseIntake, planBrief } from "./plan-intake";
import { miniApp } from "./kits/mini-app";
import { detectKits } from "./kits";
import { starterFiles } from "./template";
import { savePlanAnswer, shouldPlanFirst } from "./plan-first";
import { runTurn } from "./runner";
import { loadFiles } from "./store";

const TOOL_ARGS = {
  summary: "A tip jar for our football club.",
  recommended_palette: "forest",
  questions: [
    { question: "What should people be able to do?", label: "People can", multiple: true, options: [{ label: "Send money", recommended: true }, { label: "Withdraw" }, { label: "Vote" }] },
    { question: "Who can take the money out?", label: "Who", options: [{ label: "Only me", recommended: true }, { label: "Everyone votes" }] },
  ],
};

let db: Db;
let userId: string;
let projectId: string;
let firstMessageId: string;

beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: "0xabc", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  const p = await createProjectFromPrompt(db, userId, { prompt: "A tip jar for our football club", network: "celo-sepolia" });
  projectId = p.id;
  const [m] = await db.select().from(messages).where(eq(messages.projectId, projectId));
  firstMessageId = m.id;
});

async function spend(micro: number) {
  await db.insert(usageEvents).values({ userId, projectId, callId: `seed-${micro}-${Math.random()}`, model: "deepseek-flash", inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, markupBps: 2500, providerCostMicro: micro, chargedMicro: micro });
}

const askReply = { text: "A few quick questions.", tools: [{ name: "ask_questions", args: TOOL_ARGS }], usage: { input: 900, output: 300 } };

/** Run the planning turn, as the worker would after the route queued it. */
async function plan(reply: Parameters<typeof scriptedModel>[0][number] = askReply) {
  const { client, requests } = scriptedModel([reply]);
  const events: unknown[] = [];
  const record = await runTurn({ db, model: client }, { projectId, userId, mode: "plan", userMessageId: firstMessageId, intake: true }, (e) => events.push(e));
  return { record, requests, events };
}

async function assistantOf(record: TurnRecord) {
  const rows = await db.select().from(messages).where(eq(messages.projectId, projectId));
  const m = rows.filter((r) => r.role === "assistant").at(-1)!;
  expect((m.meta as unknown as TurnRecord).mode).toBe(record.mode);
  return m;
}

const buildReplies = (html?: string) => [
  {
    tools: [
      { name: "create_file", args: { path: "src/App.tsx", content: "export default function App() { return <main>Site</main>; }\n" } },
      ...(html ? [{ name: "create_file", args: { path: "public/index.html", content: html } }] : []),
    ],
  },
  { text: "Built your app." },
];

describe("shouldPlanFirst", () => {
  it("plans a project's first send, whichever screen it came from", async () => {
    expect(await shouldPlanFirst(db, { projectId, userId })).toBe(true);
    expect(await shouldPlanFirst(db, { projectId, userId, prompt: "a prompt typed in the workspace" })).toBe(true);
  });

  it("doesn't plan later sends", async () => {
    await plan();
    expect(await shouldPlanFirst(db, { projectId, userId, prompt: "Start building" })).toBe(false);
  });

  it("doesn't plan after a build, or while something is queued", async () => {
    await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "go" });
    expect(await shouldPlanFirst(db, { projectId, userId, prompt: "again" })).toBe(false);
  });

  it("never pulls auto-fix or Try fix into plan mode, even on a project with nothing built", async () => {
    expect(await shouldPlanFirst(db, { projectId, userId, prompt: `${AUTO_FIX_LEAD} the preview crashed` })).toBe(false);
    expect(await shouldPlanFirst(db, { projectId, userId, prompt: FIX_PROMPT })).toBe(false);
  });

  it("honours skip", async () => {
    expect(await shouldPlanFirst(db, { projectId, userId, skipPlan: true })).toBe(false);
  });

  it("Try again after a planning turn that failed plans again", async () => {
    const failing = { stream: () => (async function* () { throw new Error("boom"); })() };
    const job = await enqueueTurn(db, { projectId, userId, mode: "plan", userMessageId: firstMessageId, intake: true });
    await runTurn({ db, model: failing as never }, { projectId, userId, mode: "plan", userMessageId: firstMessageId }, () => undefined);
    await db.execute(`update turn_jobs set status = 'error' where id = '${job.id}'`);
    expect(await shouldPlanFirst(db, { projectId, userId, prompt: "A tip jar" })).toBe(true);
  });
});

describe("when planning keeps ending without questions", () => {
  async function endedPlanTurn(prompt: string, status: "done" | "error") {
    const job = await enqueueTurn(db, { projectId, userId, mode: "plan", prompt, intake: true });
    await db.update(turnJobs).set({ status }).where(eq(turnJobs.id, job.id));
  }

  it("allows one more try, then the next send builds, so nobody gets stuck", async () => {
    await endedPlanTurn("A tip jar", "error");
    expect(await shouldPlanFirst(db, { projectId, userId, prompt: "A tip jar" })).toBe(true);
    await endedPlanTurn("A tip jar", "error");
    expect(await shouldPlanFirst(db, { projectId, userId, prompt: "A tip jar" })).toBe(false);
  });

  it("counts turns the model only answered in words", async () => {
    await endedPlanTurn("what can you build?", "done");
    await endedPlanTurn("and on Celo?", "done");
    expect(await shouldPlanFirst(db, { projectId, userId, prompt: "A tip jar" })).toBe(false);
  });

  it("doesn't count a plan that was stopped or cancelled", async () => {
    const stopped = await enqueueTurn(db, { projectId, userId, mode: "plan", prompt: "one", intake: true });
    await db.update(turnJobs).set({ status: "stopped" }).where(eq(turnJobs.id, stopped.id));
    const cancelled = await enqueueTurn(db, { projectId, userId, mode: "plan", prompt: "two", intake: true });
    await db.update(turnJobs).set({ status: "cancelled" }).where(eq(turnJobs.id, cancelled.id));
    expect(await shouldPlanFirst(db, { projectId, userId, prompt: "three" })).toBe(true);
  });
});

describe("the planning turn", () => {
  it("is one cheap call with a small prompt, no project files and no thinking", async () => {
    const { record, requests } = await plan();
    expect(requests).toHaveLength(1);
    expect(requests[0].tier).toBe("cheap");
    expect(requests[0].noThinking).toBe(true);
    expect(requests[0].maxTokens).toBe(INTAKE_MAX_TOKENS);
    expect(requests[0].tools?.map((t) => t.function.name)).toEqual(["ask_questions"]);
    const sent = JSON.stringify(requests[0].messages);
    expect(sent).not.toContain("src/App.tsx");
    expect(sent).not.toContain("SPDX");
    expect(record.status).toBe("answered");
  });

  it("saves the questions plus a palette question, and writes no files", async () => {
    const { record, events } = await plan();
    expect(record.intake?.questions.map((q) => q.kind)).toEqual(["choice", "choice", "palette"]);
    const palette = record.intake!.questions[2];
    expect(palette.options[0].id).toBe("forest");
    expect(palette.options[0].recommended).toBe(true);
    expect(palette.options).toHaveLength(PALETTES.length);
    expect(events.some((e) => (e as { type: string }).type === "questions")).toBe(true);
    expect(await loadFiles(db, projectId)).toEqual({});
    const m = await assistantOf(record);
    expect((m.meta as unknown as TurnRecord).intake?.questions).toHaveLength(3);
  });

  it("falls back to fixed questions, with no second call, when the tool call is unusable", async () => {
    const bad = await plan({ tools: [{ name: "ask_questions", args: "{not json" }] });
    expect(bad.requests).toHaveLength(1);
    expect(bad.record.intake?.questions.at(-1)?.kind).toBe("palette");
    expect(bad.record.intake?.questions.length).toBeGreaterThanOrEqual(3);
  });

  it("falls back when the reply was cut off at the output limit", async () => {
    const { record } = await plan({ text: "Sure", finish: "length" });
    expect(record.intake).toBeDefined();
  });

  it("leaves a plain answer or a refusal as words, with no questions", async () => {
    const { record } = await plan({ text: "I can't build gambling apps, but a raffle for a good cause could work." });
    expect(record.intake).toBeUndefined();
    expect(await shouldPlanFirst(db, { projectId, userId, prompt: "ok, a tip jar" })).toBe(true);
  });

  it("resumes from its saved call after a crash, without asking the model again", async () => {
    const first = await plan();
    const { client, requests } = scriptedModel([]);
    const rows = await db.select().from(messages).where(eq(messages.projectId, projectId));
    const assistant = rows.find((m) => m.role === "assistant")!;
    const saved = { v: 1, assistantId: assistant.id, userMessageId: firstMessageId, request: "x", firstBuild: true, intake: true, priorStatus: "draft", assetNames: [], contractOptions: {}, baseFiles: { "src/App.tsx": "x" }, prefix: [{ role: "user" as const, content: "x" }], imageAssetIds: [], recordAtStart: { kind: "turn" as const, mode: "plan" as const, steps: [], log: [], changes: [], chargedMicro: 0, status: "error" as const }, text: "" };
    const call = { tier: "cheap", convoLen: 2, deltas: ["Hi."], toolCalls: [{ id: "c1", name: "ask_questions", arguments: JSON.stringify(TOOL_ARGS) }], finishReason: "tool_calls", usage: [] };
    const replayed = await runTurn(
      {
        db,
        model: client,
        job: { lockHeld: false, resume: { assistantMessageId: assistant.id, setup: saved, calls: [call], attempt: 2 }, commit: (fn) => db.transaction((tx) => fn(tx as unknown as Db)), setAssistant: async () => undefined, saveSetup: async () => undefined, saveCall: async () => undefined, complete: async () => undefined },
      },
      { projectId, userId, mode: "plan", userMessageId: firstMessageId },
      () => undefined,
    );
    expect(requests).toHaveLength(0);
    expect(replayed.intake?.questions).toHaveLength(first.record.intake!.questions.length);
  });

  it("the demo model asks website questions for a website and contract questions otherwise", async () => {
    const site = await createProjectFromPrompt(db, userId, { prompt: "A landing page for my kitchen", network: "celo-sepolia" });
    const siteRecord = await runTurn({ db, model: demoModel() }, { projectId: site.id, userId, mode: "plan", prompt: "A landing page for my kitchen", intake: true }, () => undefined);
    const siteWords = JSON.stringify(siteRecord.intake);
    expect(siteWords).toMatch(/visitors/);
    expect(siteWords).not.toMatch(/withdraw|money/i);
    const tip = await plan2();
    expect(JSON.stringify(tip.intake)).toMatch(/Withdraw/);
  });
});

async function plan2() {
  return runTurn({ db, model: demoModel() }, { projectId, userId, mode: "plan", userMessageId: firstMessageId, intake: true }, () => undefined);
}

describe("answering", () => {
  it("returns preview helpers for the project's selected chain", async () => {
    await db.update(projects).set({ chainId: 42220 }).where(eq(projects.id, projectId));
    const state = await workspaceState(db, projectId, userId);
    expect(state?.files["src/lib/chain.ts"]).toContain("export const chain = celo;");
    expect(state?.files["src/lib/goodbuild/wallet.ts"]).toContain("export const appChain = celo;");
  });

  it("a reload mid-questions resumes at the first unanswered question", async () => {
    const { record } = await plan();
    const m = await assistantOf(record);
    const [q1] = record.intake!.questions;
    expect(await savePlanAnswer(db, { projectId, messageId: m.id, questionId: q1.id, answer: { picks: ["o1", "o3"] } })).toBe("saved");

    const state = await workspaceState(db, projectId, userId);
    const reloaded = state!.messages.find((x) => x.id === m.id)!.meta as unknown as TurnRecord;
    expect(reloaded.intake!.answers[q1.id].picks).toEqual(["o1", "o3"]);
    expect(nextQuestion(reloaded.intake!)).toBe(1);
    expect(state!.jobs).toEqual([]);
  });

  it("refuses options that weren't offered and questions that don't exist", async () => {
    const { record } = await plan();
    const m = await assistantOf(record);
    const [q1, q2] = record.intake!.questions;
    expect(await savePlanAnswer(db, { projectId, messageId: m.id, questionId: q1.id, answer: { picks: ["nope"] } })).toBe("invalid");
    expect(await savePlanAnswer(db, { projectId, messageId: m.id, questionId: "nope", answer: { picks: ["o1"] } })).toBe("not_found");
    // One choice only, where only one applies.
    await savePlanAnswer(db, { projectId, messageId: m.id, questionId: q2.id, answer: { picks: ["o1", "o2"] } });
    const [row] = await db.select().from(messages).where(eq(messages.id, m.id));
    expect((row.meta as unknown as TurnRecord).intake!.answers[q2.id].picks).toEqual(["o1"]);
  });
});

describe("the build after the plan", () => {
  async function planAndAnswer(answers: Record<string, { picks: string[]; other?: string }>) {
    const { record } = await plan();
    const m = await assistantOf(record);
    for (const [questionId, answer] of Object.entries(answers)) await savePlanAnswer(db, { projectId, messageId: m.id, questionId, answer });
    return record;
  }

  it("carries the answers into the build's context, and into later turns", async () => {
    await planAndAnswer({ q1: { picks: ["o1", "o3"] }, q2: { picks: [], other: "My treasurer Ada" } });
    const { client, requests } = scriptedModel(buildReplies());
    await runTurn({ db, model: client }, { projectId, userId, mode: "build", prompt: "Start building" }, () => undefined);
    const context = JSON.stringify(requests[0].messages);
    expect(context).toContain("Send money, Vote");
    expect(context).toContain("My treasurer Ada");
    expect(context).toContain("don't ask again");
    expect(context).toContain("A tip jar for our football club");

    const later = scriptedModel([{ text: "Done." }]);
    await runTurn({ db, model: later.client }, { projectId, userId, mode: "build", prompt: "what's on the page?" }, () => undefined);
    expect(JSON.stringify(later.requests[0].messages)).toContain("My treasurer Ada");
  });

  it("treats an answer of G$ as a request for the token (D15)", async () => {
    const brief = planBrief(
      { summary: "s", answers: { q1: { picks: [], other: "Pay in G$" } }, questions: [{ id: "q1", kind: "choice", label: "Pay", question: "How?", multiple: false, options: [] }] },
      true,
    );
    expect(brief.answerWords).toContain("G$");
  });

  it("the chosen palette reaches public/index.html, even when the model rewrites the page", async () => {
    await planAndAnswer({ palette: { picks: ["midnight"] } });
    const { client, requests } = scriptedModel(buildReplies("<html><head><style type=\"text/tailwindcss\">@theme { --color-accent: #ff0000; --font-sans: Inter; }</style></head><body><div id=\"root\"></div></body></html>"));
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", prompt: "Start building" }, () => undefined);
    expect(record.status).toBe("ready");
    const midnight = PALETTES.find((p) => p.id === "midnight")!;
    // The model reads the palette from the start, and is told it's set.
    expect(JSON.stringify(requests[0].messages)).toContain(midnight.tokens.accent);
    expect(JSON.stringify(requests[0].messages)).toContain("don't change any --color-*");
    const theme = readTheme((await loadFiles(db, projectId))["public/index.html"]);
    expect(theme.accent).toBe(midnight.tokens.accent);
    expect(theme.background).toBe(midnight.tokens.background);
  });

  it("own colours go to the model in their words, and unreadable text gets fixed", async () => {
    await planAndAnswer({ palette: { picks: [], other: "our green and gold" } });
    const { client, requests } = scriptedModel(buildReplies('<html><head><style type="text/tailwindcss">@theme { --color-accent: #eab308; --color-accent-foreground: #ffffff; }</style></head><body><div id="root"></div></body></html>'));
    await runTurn({ db, model: client }, { projectId, userId, mode: "build", prompt: "Start building" }, () => undefined);
    expect(JSON.stringify(requests[0].messages)).toContain("our green and gold");
    expect(readTheme((await loadFiles(db, projectId))["public/index.html"])["accent-foreground"]).toBe("#111111");
  });

  it("a later change of colour isn't overwritten by the plan", async () => {
    await planAndAnswer({ palette: { picks: ["ocean"] } });
    await runTurn({ db, model: scriptedModel(buildReplies()).client }, { projectId, userId, mode: "build", prompt: "Start building" }, () => undefined);
    const html = (await loadFiles(db, projectId))["public/index.html"];
    const changed = html.replace(/--color-accent: [^;]+;/, "--color-accent: #123456;");
    const { client } = scriptedModel(buildReplies(changed));
    await runTurn({ db, model: client }, { projectId, userId, mode: "build", prompt: "make the accent darker" }, () => undefined);
    expect(readTheme((await loadFiles(db, projectId))["public/index.html"]).accent).toBe("#123456");
  });

  it("skipping with nothing answered builds normally, and the model picks its own colours", async () => {
    await plan();
    const { client, requests } = scriptedModel(buildReplies());
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", prompt: "Skip the questions, just build it" }, () => undefined);
    expect(record.status).toBe("ready");
    expect(JSON.stringify(requests[0].messages)).not.toContain("The plan they agreed");
  });

  it("skipping partway keeps what was answered", async () => {
    await planAndAnswer({ q1: { picks: ["o2"] } });
    const { client, requests } = scriptedModel(buildReplies());
    await runTurn({ db, model: client }, { projectId, userId, mode: "build", prompt: "Skip the questions, just build it" }, () => undefined);
    const context = JSON.stringify(requests[0].messages);
    expect(context).toContain("Withdraw");
    expect(context).toContain("pick sensible defaults");
  });

  it("the normal Plan toggle later is untouched", async () => {
    await plan();
    const { client, requests } = scriptedModel([{ text: "Here's how I'd do that." }]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "plan", prompt: "how would a leaderboard work?" }, () => undefined);
    expect(record.intake).toBeUndefined();
    expect(requests[0].tools?.map((t) => t.function.name)).toContain("set_plan");
    expect(requests[0].maxTokens).toBeGreaterThan(INTAKE_MAX_TOKENS);
  });
});

describe("the free AI cap (D28)", () => {
  /** The dearest a plan can be: the longest prompt and the whole output limit, plus the name call. */
  function worstCaseCharge() {
    const inputChars = INTAKE_PROMPT.length + JSON.stringify(INTAKE_TOOLS).length + PROMPT_MAX_LENGTH + 100;
    const plan = chargedMicro(costMicro("deepseek-flash", { inputTokens: estimateTokens(inputChars), outputTokens: INTAKE_MAX_TOKENS }));
    // nameProject: a short system prompt, the prompt, a short reply (project-name.ts).
    const name = chargedMicro(costMicro("deepseek-flash", { inputTokens: estimateTokens(PROMPT_MAX_LENGTH + 600), outputTokens: 40 }));
    return plan + name;
  }

  it("a plan's worst case fits inside the headroom, and is a tiny part of the allowance", () => {
    const worst = worstCaseCharge();
    console.log(`plan worst case: $${(worst / 1e6).toFixed(5)} charged`);
    expect(worst).toBeLessThan(PLAN_HEADROOM_MICRO);
    expect(worst / UNVERIFIED_CAP_MICRO).toBeLessThan(0.05);
  });

  it("with room left it plans, and the build still starts after the dearest possible plan", async () => {
    await spend(UNVERIFIED_CAP_MICRO - PLAN_HEADROOM_MICRO - 1);
    expect(await shouldPlanFirst(db, { projectId, userId })).toBe(true);
    await spend(worstCaseCharge());
    expect(await checkAiAllowance(db, { userId, projectId })).toEqual({ allowed: true });
  });

  it("too close to the cap it skips the plan, so the money goes on a build", async () => {
    await spend(UNVERIFIED_CAP_MICRO - PLAN_HEADROOM_MICRO);
    expect(await hasPlanHeadroom(db, userId)).toBe(false);
    expect(await shouldPlanFirst(db, { projectId, userId })).toBe(false);
    // ...and that build is still allowed to start (D28: it may finish).
    expect(await checkAiAllowance(db, { userId, projectId })).toEqual({ allowed: true });
  });

  it("a verified account is measured against its own larger cap", async () => {
    await db.update(users).set({ verifiedAt: new Date() }).where(eq(users.id, userId));
    await spend(UNVERIFIED_CAP_MICRO);
    expect(await hasPlanHeadroom(db, userId)).toBe(true);
  });

  it("answers wait when the person is over the cap: nothing is lost, and the answers are still there", async () => {
    const { record } = await plan();
    const m = await assistantOf(record);
    await savePlanAnswer(db, { projectId, messageId: m.id, questionId: "q1", answer: { picks: ["o1"] } });
    await spend(UNVERIFIED_CAP_MICRO);
    expect((await checkAiAllowance(db, { userId, projectId })).allowed).toBe(false);
    const state = await workspaceState(db, projectId, userId);
    expect(state!.offerVerification).toBe(true);
    expect((state!.messages.find((x) => x.id === m.id)!.meta as unknown as TurnRecord).intake!.answers.q1).toBeDefined();
  });
});

describe("cost of a plan, measured with the token and pricing code", () => {
  // estimateTokens assumes 2.5 characters a token, on the high side for this English text.
  it("stays near a tenth of a cent for a typical request (real model usage UNVERIFIED)", () => {
    const request = "A weekly G$ savings circle for 12 members, 50 G$ every Friday.";
    const inputChars = INTAKE_PROMPT.length + JSON.stringify(INTAKE_TOOLS).length + request.length + 30;
    const outputChars = JSON.stringify(TOOL_ARGS).length * 2 + 60; // about four questions
    const usage = { inputTokens: estimateTokens(inputChars), outputTokens: estimateTokens(outputChars) };
    const charged = chargedMicro(costMicro("deepseek-flash", usage));
    console.log(`plan typical: ${usage.inputTokens} in, ${usage.outputTokens} out, $${(charged / 1e6).toFixed(5)} charged (prompt ${INTAKE_PROMPT.length} chars)`);
    expect(usage.inputTokens).toBeLessThan(1_700); // raised for the money / regular app / website rule; the charge bound below is unchanged
    expect(charged).toBeLessThan(1_500);
  });
});

describe("parseIntake", () => {
  it("caps questions and options, and always marks exactly one option recommended", () => {
    const many = {
      summary: "x",
      recommended_palette: "ocean",
      questions: Array.from({ length: 7 }, (_, i) => ({ question: `Question ${i}?`, label: `L${i}`, options: ["a", "b", "c", "d", "e", "f"] })),
    };
    const parsed = parseIntake(JSON.stringify(many), "x")!;
    const choices = parsed.questions.filter((q) => q.kind === "choice");
    expect(choices).toHaveLength(4);
    expect(parsed.questions).toHaveLength(5);
    for (const q of parsed.questions) expect(q.options.filter((o) => o.recommended)).toHaveLength(1);
    expect(choices[0].options).toHaveLength(4);
  });

  it("drops its own colour question and Other option, because the card adds them", () => {
    const parsed = parseIntake(
      JSON.stringify({
        summary: "x",
        recommended_palette: "ocean",
        questions: [
          { question: "What colour do you want?", label: "c", options: ["Red", "Blue"] },
          { question: "Who can vote?", label: "v", options: ["Members", "Anyone", "Other"] },
        ],
      }),
      "x",
    )!;
    expect(parsed.questions.map((q) => q.question)).toEqual(["Who can vote?", "Which colours feel right for your app?"]);
    expect(parsed.questions[0].options.map((o) => o.label)).toEqual(["Members", "Anyone"]);
  });

  it("leaves out the palette when they already named their colours, and takes out em dashes", () => {
    const parsed = parseIntake(JSON.stringify({ summary: "A jar — for tips", recommended_palette: "none", questions: [{ question: "Who can vote?", label: "v", options: ["Members", "Anyone"] }] }), "x")!;
    expect(parsed.questions.every((q) => q.kind === "choice")).toBe(true);
    expect(parsed.summary).toBe("A jar, for tips");
  });

  it("returns nothing usable for junk, and the fixed questions avoid jargon", () => {
    expect(parseIntake("{not json", "x")).toBeNull();
    expect(parseIntake(JSON.stringify({ questions: [{ question: "only one option", options: ["a"] }] }), "x")).toBeNull();
    const words = JSON.stringify([fallbackIntake("A tip jar"), fallbackIntake("A landing page for my bakery")]);
    expect(words).not.toMatch(/ERC-?20|modifier|mapping|\bABI\b|gas\b/i);
    expect(fallbackIntake("A landing page for my bakery").questions[0].question).toMatch(/visitors/);
  });
});

describe("the MiniPay question (D88)", () => {
  const model = (questions: unknown[]) => JSON.stringify({ summary: "A jumping game", recommended_palette: "ocean", questions });
  const five = Array.from({ length: 5 }, (_, i) => ({ question: `Question ${i}?`, label: `L${i}`, options: ["a", "b"] }));

  it("is asked for a game, after the game's own cards and the leaderboard, before the colours", () => {
    // The model's MiniPay card is dropped; obstacles, power-ups and characters it didn't ask about are added (D91).
    const parsed = parseIntake(model([...five, { question: "Should it work in MiniPay?", label: "m", options: ["Yes", "No"] }]), "A jumping game where you dodge rocks")!;
    expect(parsed.questions.map((q) => q.id)).toEqual(["q1", "obstacles", "powerups", "npcs", "q2", LEADERBOARD_QUESTION_ID, MINIPAY_QUESTION_ID, "palette"]);
    const fallback = fallbackIntake("A jumping game where you dodge rocks");
    expect(fallback.questions.map((q) => q.id)).toEqual(["q1", "obstacles", "powerups", "npcs", LEADERBOARD_QUESTION_ID, MINIPAY_QUESTION_ID, "palette"]);
  });

  it("isn't asked for other apps, or when the request already says MiniPay", () => {
    expect(parseIntake(model(five), "A tip jar for my club")!.questions.some((q) => q.id === MINIPAY_QUESTION_ID)).toBe(false);
    expect(fallbackIntake("A snake game for MiniPay").questions.some((q) => q.id === MINIPAY_QUESTION_ID)).toBe(false);
  });

  it("Yes turns the MiniPay kit on and No doesn't", () => {
    const intake = fallbackIntake("A jumping game where you dodge rocks");
    const answer = (pick: string) => planBrief({ ...intake, answers: { [MINIPAY_QUESTION_ID]: { picks: [pick] } } }, true);
    const yes = answer("yes");
    const no = answer("no");
    expect(yes.miniPay).toBe(true);
    expect(yes.text).toMatch(/mini-app kit is on/);
    expect(no.miniPay).toBeUndefined();
    // No's words never name MiniPay, so the kit's keywords can't turn it on from that answer either.
    expect(detectKits(no.answerWords, starterFiles())).not.toContain(miniApp);
  });
});

it("planning leaves the project at version 0", async () => {
  await plan();
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  expect(p.currentVersion).toBe(0);
});

describe("a game's plan (D91)", () => {
  const racer = "Build a car racing game for me that's playable on mini pay, I want leaderboards and season pass, make it endless with power ups and there should be an in app store";
  const card = (question: string, options: string[]) => ({ question, label: question.split(" ").slice(0, 2).join(" "), multiple: true, options });
  const args = (questions: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ summary: "An endless racer", recommended_palette: "ocean", questions, ...extra });

  it("keeps the model's own obstacle, power-up and character cards, as multiple choice, and drops its score question", () => {
    const parsed = parseIntake(
      args([
        card("How do you steer?", ["Tap left or right", "Tilt"]),
        { ...card("What gets in your way on the road?", ["Oncoming traffic", "Oil slicks", "Road works"]), multiple: false },
        card("Which power-ups?", ["Nitro", "Shield", "Coin magnet"]),
        card("Who else is on the road?", ["Rival racers", "Police", "Just traffic"]),
        card("What should happen with high scores?", ["Leaderboard", "Own best"]),
        card("What does the store sell?", ["Cars", "Level ups", "Power packs"]),
      ]),
      racer,
    )!;
    const ids = parsed.questions.map((q) => q.id);
    expect(ids).toEqual(["q1", "q2", "q3", "q4", "q5", "palette"]);
    expect(parsed.questions[1].multiple).toBe(true);
    expect(parsed.questions.map((q) => q.question).join(" ")).not.toMatch(/high scores/);
    // They said leaderboard and MiniPay already: neither card is shown, and the plan has a board.
    expect(ids).not.toContain(LEADERBOARD_QUESTION_ID);
    expect(ids).not.toContain(MINIPAY_QUESTION_ID);
    expect(parsed.leaderboard).toBe(true);
  });

  it("keeps the brief, cleaned, and only for a game", () => {
    const brief = { name: "Neon Drift", pitch: "Weave through night traffic — chain near misses.", loop: "dodge, collect, boost", lose: "you crash", harder: "traffic speeds up", extras: ["near-miss bonus", "daily missions", "ghost run", "a fourth"] };
    const parsed = parseIntake(args([card("How do you steer?", ["Tap", "Tilt"])], { game_brief: brief }), racer)!;
    expect(parsed.game).toEqual({ ...brief, pitch: "Weave through night traffic, chain near misses.", extras: ["near-miss bonus", "daily missions", "ghost run"] });
    expect(parseIntake(args([card("Who can join?", ["Anyone", "Friends"])], { game_brief: brief }), "A tip jar for my club")!.game).toBeUndefined();
    expect(planBrief(parsed, true).text).toMatch(/"Neon Drift"[\s\S]*Loop: dodge, collect, boost[\s\S]*near-miss bonus/);
  });

  it("sends the game rules and the brief field only with a game's request", () => {
    expect(intakeContext(racer, [])).toContain(GAME_RULES);
    expect(intakeContext("A tip jar for my club", [])).not.toContain(GAME_RULES);
    expect(intakeTools(racer)).toBe(INTAKE_TOOLS_GAME);
    expect(intakeTools("A tip jar for my club")).toBe(INTAKE_TOOLS);
    expect(JSON.stringify(INTAKE_TOOLS)).not.toMatch(/game_brief/);
    expect(GAME_RULES).toMatch(/obstacles[\s\S]*power-ups[\s\S]*controlled by the computer/);
  });

  it("a Yes on the leaderboard card puts a board in the plan, and MiniPay with it brings the contract", () => {
    const intake = fallbackIntake("A jumping game where you dodge rocks");
    const brief = (answers: Record<string, string>) => planBrief({ ...intake, answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { picks: [v] }])) }, true);
    const yes = brief({ [LEADERBOARD_QUESTION_ID]: "yes" });
    expect(yes.leaderboard).toBe(true);
    expect(yes.text).toMatch(/posting a score asks for the wallet/);
    expect(yes.text).not.toMatch(/leaderboard contract/);
    expect(brief({ [LEADERBOARD_QUESTION_ID]: "yes", [MINIPAY_QUESTION_ID]: "yes" }).text).toMatch(/leaderboard contract/);
    const no = brief({ [LEADERBOARD_QUESTION_ID]: "no" });
    expect(no.leaderboard).toBeUndefined();
    expect(no.text).toMatch(/Leaderboard: no/);
    // No answer's words turn a kit on.
    expect(detectKits(yes.answerWords, starterFiles())).toEqual([]);
  });

  it("a request that already asks for a leaderboard has one even when every card is skipped", () => {
    const intake = fallbackIntake("A snake game with a leaderboard");
    expect(intake.questions.some((q) => q.id === LEADERBOARD_QUESTION_ID)).toBe(false);
    expect(planBrief(intake, true).leaderboard).toBe(true);
  });
});
