// @vitest-environment node
// A delivery run end to end with Jev routing on, the Jev API stubbed. Same shape as delivery-extension.test.ts.
import { TIC_TAC_TOE } from "../../../test/fixtures/tic-tac-toe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/server/db/client";
import { buildDeliveries, messages, users } from "@/server/db/schema";
import { signInUser } from "@/server/auth/service";
import { createProjectFromPrompt } from "@/server/projects";
import { scriptedModel } from "@/server/agent/fake-model";
import { runTurn } from "@/server/agent/runner";
import { classifyTurn, features, questions } from "@/server/agent/jev";
import { postLedgerEntry } from "@/server/credits/ledger";
import { claimJob, jobContext, startTurn } from "./jobs";
import { prepareJevRouting } from "./jev-routing";

const GOAL = "Make me a portfolio site with my work and an about page";
const ROOT = "0x3333333333333333333333333333333333333333" as const;
const identity = { readIdentity: async () => ({ root: ROOT, expiresAt: new Date("2099-01-01") }) };
const ENV = { FREE_POLICY: "legacy", FIRST_DELIVERY_MICRO: "1000000", BUILD_REPAIR_MICRO: "1000000", JEV_ROUTING: "1", TYPESAFE_API_KEY: "fixture" };
const PAID = { ...ENV, FREE_POLICY: "verified" };
let db: Db, userId: string, projectId: string;

/** A stand-in for Jev: which capabilities the latest request asks for or rules out. */
function stubJev(requested: Partial<Record<keyof typeof features, number>>, excluded: Partial<Record<keyof typeof features, number>> = {}) {
  const fetch = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
    const asked = Object.keys((JSON.parse(init.body) as { questions: object }).questions);
    const answers = Object.fromEntries(
      asked.map((k) => {
        if (k === "kind") return [k, { type: "choice", choice: "custom", confidence: 0.9, probabilities: { custom: 0.9 } }];
        if (k.startsWith("file_")) return [k, { type: "noul", noul: 0.5 }];
        const base = k.replace(/_excluded$/, "") as keyof typeof features;
        const table = k.endsWith("_excluded") ? excluded : requested;
        return [k, { type: "noul", noul: table[base] ?? 0.01 }];
      }),
    );
    return Response.json({ model: "jev-test", answers, usage: { input_tokens: 400, output_tokens: 0 } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

async function turn(prompt: string, env = PAID) {
  const started = await startTurn(db, { userId, projectId, mode: "build", prompt }, env, identity);
  if (!("job" in started)) throw new Error("refused: " + JSON.stringify(started));
  const job = (await claimJob(db, "e2e"))!;
  const ctx = await jobContext(db, job, "e2e", new AbortController().signal);
  await prepareJevRouting(db, job, ctx, (state, signal) => classifyTurn(state, signal, { TYPESAFE_API_KEY: "fixture" }));
  return { job, ctx };
}
const plan = async () => (await db.select().from(buildDeliveries).where(eq(buildDeliveries.projectId, projectId)))[0].plan;

beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: ROOT, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  await db.update(users).set({ verifiedAt: new Date(), goodidRoot: ROOT }).where(eq(users.id, userId));
  projectId = (await createProjectFromPrompt(db, userId, { prompt: GOAL, network: "celo-sepolia" })).id;
  stubJev({});
  const { job, ctx } = await turn(GOAL, ENV);
  const model = scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: TIC_TAC_TOE } }] }, { text: "Ready" }]);
  const done = await runTurn({ db, model: model.client, job: ctx, typeCheckMode: "off", review: false, runCheck: async () => ({ ran: true, issues: [], deliveryVerified: true, note: "fixture", ms: 1 }) }, { projectId, userId, mode: "build", userMessageId: job.userMessageId }, () => {});
  expect(done.status).toBe("ready");
  await postLedgerEntry(db, { userId, kind: "adjust", amountMicro: 1_000_000, idempotencyKey: "jev-e2e" });
});

describe("Jev routing end to end", () => {
  it("starts with the interface only for a plain portfolio", async () => {
    expect((await plan()).milestones.map((m) => m.id)).toEqual(["interface"]);
  });

  it("adds the on-chain milestone for a request the keyword rules miss", async () => {
    stubJev({ payments: 0.95, gd: 0.9 });
    const { ctx } = await turn("Let visitors leave the artist a little thank-you in G$");
    expect((await plan()).milestones.map((m) => m.id)).toEqual(["interface", "payments"]);
    expect(ctx.deliveryIndex).toBe(1);
    expect(ctx.decision?.signals.payments).toBe("requested");
  });

  it("keeps a visual edit in the delivered scope even though the word 'payment' appears", async () => {
    stubJev({});
    const { ctx } = await turn("Make the heading on the payment history page bigger");
    expect((await plan()).milestones.map((m) => m.id)).toEqual(["interface"]);
    expect(ctx.deliveryIndex).toBe(0);
  });

  it("does not add a wallet milestone when the request rules the wallet out", async () => {
    stubJev({}, { wallet: 0.9 });
    await turn("Add a page about wallets. Nobody should ever have to connect one.");
    expect((await plan()).milestones.map((m) => m.id)).toEqual(["interface"]);
  });

  it("charges the classification once and records it", async () => {
    stubJev({});
    const { job } = await turn("Make the about page heading bigger");
    const [saved] = await db.select().from(messages).where(eq(messages.id, job.userMessageId));
    expect((saved.meta as { jev?: { decision?: { chargedMicro?: number } } }).jev?.decision?.chargedMicro).toBeGreaterThanOrEqual(0);
  });
});
