// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { FileChange, TurnEvent, TurnRecord } from "@/lib/turn-types";
import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { messages, turnJobCalls, turnJobs, usageEvents } from "@/server/db/schema";
import { claimJob, enqueueTurn, jobContext } from "@/server/jobs/jobs";
import { createProjectFromPrompt } from "@/server/projects";

import { scriptedModel, type ScriptedReply } from "./fake-model";
import type { ModelClient, UserPart } from "./model";
import { MAX_REVIEW_ISSUES, parseReview, reviewEnabled, reviewFixMessage, reviewPrompt, worthReviewing } from "./review";
import type { RunCheckOptions, RunCheckResult } from "./run-check";
import { runTurn } from "./runner";
import { loadFiles } from "./store";
import { LeaseLostError, type TurnJobContext } from "./turn-progress";

const change = (path: string, added: number, removed = 0): FileChange => ({ path, op: "edit", added, removed, diff: "" });

describe("the review's rules", () => {
  it("is off unless the server turns it on", () => {
    expect(reviewEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(reviewEnabled({ VISUAL_REVIEW: "off" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(reviewEnabled({ VISUAL_REVIEW: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(reviewEnabled({ VISUAL_REVIEW: "on" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("looks at every first build, and at a later turn only when it changed enough of what people see", () => {
    expect(worthReviewing(true, [])).toBe(true);
    expect(worthReviewing(false, [change("src/App.tsx", 3, 2)])).toBe(false);
    expect(worthReviewing(false, [change("src/pages/Home.tsx", 40, 10), change("public/index.html", 12)])).toBe(true);
    // A contract or a helper isn't something a screenshot shows.
    expect(worthReviewing(false, [change("contracts/TipJar.sol", 200), change("src/lib/useTipJar.ts", 90)])).toBe(false);
  });

  it("reads a verdict from the reply, and refuses one it can't act on", () => {
    expect(parseReview('{"ok": true}')).toEqual({ ok: true, issues: [] });
    expect(parseReview('Here you go:\n```json\n{"ok": false, "issues": ["phone: the title is cut off — add break-words", ""]}\n```')).toEqual({ ok: false, issues: ["phone: the title is cut off, add break-words"] });
    // "ok" with a list is a list.
    expect(parseReview('{"ok": true, "issues": ["computer: the footer overlaps the form"]}')).toEqual({ ok: false, issues: ["computer: the footer overlaps the form"] });
    expect(parseReview('{"ok": false}')).toBeNull();
    expect(parseReview('{"ok": false, "issues": []}')).toBeNull();
    expect(parseReview("It looks fine to me.")).toBeNull();
    expect(parseReview("")).toBeNull();
    const many = JSON.stringify({ ok: false, issues: Array.from({ length: 9 }, (_, i) => `issue ${i}`) });
    expect(parseReview(many)?.issues).toHaveLength(MAX_REVIEW_ISSUES);
  });

  it("tells the reviewer what the screenshots can't show, and the builder to fix the list and nothing else", () => {
    const prompt = reviewPrompt({ request: "A tip jar for our football club", direction: "Soft and friendly, for club members" });
    expect(prompt).toContain("A tip jar for our football club");
    expect(prompt).toContain("Soft and friendly, for club members");
    for (const expected of ["uploaded appear as empty boxes", "system font", "Deploy the contract to go live", "Connect wallet", "JSON only"]) expect(prompt).toContain(expected);
    expect(prompt).not.toContain("—");
    const fix = reviewFixMessage(["phone: the title is cut off", "computer: two cards overlap"]);
    expect(fix).toContain("- [visual] phone: the title is cut off\n- [visual] computer: two cards overlap");
    expect(fix).toContain("change nothing else");
  });
});

// ---------------------------------------------------------------------------
// In a turn

const APP = 'export default function App() { return <main className="p-4"><h1 className="text-2xl">Lagos Football Club tips</h1></main>; }\n';
const TIDY = APP.replace('className="text-2xl"', 'className="text-2xl break-words"');
const ISSUE = "phone: the headline runs off the right edge of the screen. Add break-words to the h1.";
const VERDICT = JSON.stringify({ ok: false, issues: [ISSUE] });

const BUILD: ScriptedReply[] = [
  { tools: [{ name: "set_plan", args: { summary: "A warm tip page for club members", steps: ["Write the page"] } }] },
  { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP } }] },
  { text: "Built your tip page." },
];
const FIX: ScriptedReply[] = [{ tools: [{ name: "edit_file", args: { path: "src/App.tsx", edits: [{ search: 'className="text-2xl"', replace: 'className="text-2xl break-words"' }] } }] }, { text: "Tidied." }];

let phone: Uint8Array;
let computer: Uint8Array;
beforeAll(async () => {
  const blank = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).png().toBuffer();
  phone = new Uint8Array(await blank(375, 2400));
  computer = new Uint8Array(await blank(1280, 2000));
});

/** A run check that opens anything, and takes pictures when asked. */
function fakeRunCheck(options: { shots?: boolean } = {}) {
  const asked: boolean[] = [];
  const run = async (_files: Record<string, string>, o: RunCheckOptions = {}): Promise<RunCheckResult> => {
    asked.push(Boolean(o.screenshots));
    return {
      ran: true,
      issues: [],
      note: "opened the app with no errors",
      ms: 5,
      ...(o.screenshots && options.shots !== false ? { screenshots: [{ width: 375, png: phone }, { width: 1280, png: computer }] } : {}),
    };
  };
  return { run, asked };
}

let db: Db;
let userId: string;
let projectId: string;
let queuedId: string;

beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: "0xabc", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  projectId = (await createProjectFromPrompt(db, userId, { prompt: "A tip jar for our football club", network: "celo-sepolia" })).id;
  const [m] = await db.select().from(messages).where(eq(messages.projectId, projectId));
  queuedId = m.id;
});

const build = (model: ModelClient, deps: { runCheck?: ReturnType<typeof fakeRunCheck>["run"]; review?: boolean } = {}) =>
  runTurn({ db, model, review: true, ...deps }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});

describe("the review in a build (D87)", { timeout: 120_000 }, () => {
  it("shows the strong model the page on a phone and a computer, and leaves a page that looks right alone", async () => {
    const check = fakeRunCheck();
    const { client, requests } = scriptedModel([...BUILD, { text: '{"ok": true}' }]);
    const record = await build(client, { runCheck: check.run });

    expect(record.status).toBe("ready");
    expect(record.review).toEqual({ ok: true, issues: [], fixed: false });
    expect(requests).toHaveLength(4);
    const ask = requests[3];
    expect(ask.tier).toBe("strong");
    // A question of its own: one message, no tools, and nothing of the build's conversation.
    expect(ask.messages).toHaveLength(1);
    expect(ask.tools).toBeUndefined();
    const parts = ask.messages[0].content as UserPart[];
    expect(parts.map((p) => p.type)).toEqual(["text", "image", "image"]);
    expect((parts[0] as { text: string }).text).toContain("A tip jar for our football club");
    expect((parts[0] as { text: string }).text).toContain("A warm tip page for club members");
    // Cropped to the top, so the model reads them at full size.
    const sizes = await Promise.all(parts.slice(1).map((p) => sharp(Buffer.from((p as { data: string }).data, "base64")).metadata()));
    expect(sizes.map((s) => [s.width, s.height])).toEqual([[375, 1568], [1280, 1400]]);
    // The pictures were taken once, after the checks passed.
    expect(check.asked.filter(Boolean)).toHaveLength(1);
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toBe(APP);
    expect(record.steps.find((s) => s.id === "review")).toMatchObject({ status: "done", detail: "looks right on a phone and a computer" });
    // The look is billed with the build.
    expect(await db.select().from(usageEvents)).toHaveLength(4);
  });

  it("hands what it saw to the build model for one pass, and keeps the fix when the checks still pass", async () => {
    const { client, requests } = scriptedModel([...BUILD, { text: VERDICT }, ...FIX]);
    const record = await build(client, { runCheck: fakeRunCheck().run });

    expect(record.status).toBe("ready");
    expect(record.review).toEqual({ ok: false, issues: [ISSUE], fixed: true });
    expect(requests.map((r) => r.tier)).toEqual(["cheap", "cheap", "cheap", "strong", "cheap", "cheap"]);
    expect(String(requests[4].messages.at(-1)?.content)).toContain(`- [visual] ${ISSUE}`);
    // The reviewer's JSON never enters the build's conversation or the person's reply.
    expect(JSON.stringify(requests[4].messages)).not.toContain('"ok"');
    const [reply] = (await db.select().from(messages).where(eq(messages.projectId, projectId))).filter((m) => m.role === "assistant");
    expect(reply.content).toBe("Built your tip page.");
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toBe(TIDY);
    expect(record.steps.find((s) => s.id === "review:fix")).toMatchObject({ status: "done", detail: "1 thing fixed" });
    expect(record.changes.find((c) => c.path === "src/App.tsx")?.diff).toContain("break-words");
  });

  it("puts the page back as it was when the fix breaks a check, and says what it saw", async () => {
    const breaks: ScriptedReply[] = [{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: 'import { Gone } from "./Gone";\n' + APP } }] }, { text: "Tidied." }];
    const { client } = scriptedModel([...BUILD, { text: VERDICT }, ...breaks]);
    const record = await build(client, { runCheck: fakeRunCheck().run });

    expect(record.status).toBe("ready");
    expect(record.checks).toEqual({ errors: 0, warnings: 0 });
    expect(record.review).toEqual({ ok: false, issues: [ISSUE], fixed: false });
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toBe(APP);
    expect(record.steps.find((s) => s.id === "review:fix")?.detail).toMatch(/left as it was/);
    // No second round of fixing on the strong model for a cosmetic fix that went wrong.
    expect(record.steps.some((s) => s.id.startsWith("fix:"))).toBe(false);
  });

  it("says what it saw and leaves the page alone when the builder's pass changes nothing", async () => {
    const idle = scriptedModel([...BUILD, { text: VERDICT }, { text: "Nothing to change." }]);
    const record = await build(idle.client, { runCheck: fakeRunCheck().run });
    expect(record.review).toEqual({ ok: false, issues: [ISSUE], fixed: false });
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toBe(APP);
    expect(record.steps.find((s) => s.id === "review:fix")?.detail).toBe("nothing was changed");
  });

  it("changes nothing when the reviewer's reply can't be read as a verdict", async () => {
    const vague = scriptedModel([...BUILD, { text: "It looks fine to me, nice work." }]);
    const record = await build(vague.client, { runCheck: fakeRunCheck().run });
    expect(record.status).toBe("ready");
    expect(record.review).toBeUndefined();
    expect(vague.requests).toHaveLength(4);
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toBe(APP);
  });

  it("doesn't run when it is off", async () => {
    const off = scriptedModel(BUILD);
    const offCheck = fakeRunCheck();
    expect((await build(off.client, { runCheck: offCheck.run, review: false })).review).toBeUndefined();
    expect(off.requests).toHaveLength(3);
    expect(offCheck.asked.some(Boolean)).toBe(false);
  });

  it("doesn't run on a server with no run check, even when it is turned on", async () => {
    // The default here: RUN_CHECK isn't set, so there is no browser to take the pictures.
    expect(process.env.RUN_CHECK).toBeUndefined();
    expect(process.env.RUN_CHECK_WS_ENDPOINT).toBeUndefined();
    const none = scriptedModel(BUILD);
    const record = await build(none.client, { review: true });
    expect(record.status).toBe("ready");
    expect(record.review).toBeUndefined();
    expect(none.requests).toHaveLength(3);
    expect(record.steps.some((s) => s.id === "review")).toBe(false);
  });

  it("skips, without asking the model, when the run check can't take pictures", async () => {
    const none = scriptedModel(BUILD);
    const record = await build(none.client, { runCheck: fakeRunCheck({ shots: false }).run });
    expect(record.status).toBe("ready");
    expect(record.review).toBeUndefined();
    expect(none.requests).toHaveLength(3);
    expect(record.steps.find((s) => s.id === "review")).toMatchObject({ status: "done", detail: "skipped" });
  });

  it("doesn't look again after a small change to a project that is already built", async () => {
    await build(scriptedModel([...BUILD, { text: '{"ok": true}' }]).client, { runCheck: fakeRunCheck().run });
    const [next] = await db.insert(messages).values({ projectId, role: "user", content: "Make the headline say Tips", status: "queued", meta: { mode: "build" } }).returning({ id: messages.id });
    const check = fakeRunCheck();
    const small = scriptedModel([{ tools: [{ name: "edit_file", args: { path: "src/App.tsx", edits: [{ search: "Lagos Football Club tips", replace: "Tips" }] } }] }, { text: "Done." }]);
    const record = await runTurn({ db, model: small.client, review: true, runCheck: check.run }, { projectId, userId, mode: "build", userMessageId: next.id }, () => {});
    expect(record.status).toBe("ready");
    expect(record.review).toBeUndefined();
    expect(small.requests).toHaveLength(2);
    expect(check.asked.some(Boolean)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// After a crash

/** Claim the job and run it, optionally losing the process right after the n-th save. */
async function runJob(jobId: string, model: ModelClient, crashAfter?: number) {
  const owner = `w-${Math.random()}`;
  const claimed = await claimJob(db, owner);
  if (!claimed || claimed.id !== jobId) throw new Error("not claimed");
  const ctx = await jobContext(db, claimed, owner, new AbortController().signal);
  let saves = 0;
  const wrapped: TurnJobContext = {
    ...ctx,
    commit: async (fn) => {
      const result = await ctx.commit(fn);
      saves++;
      if (crashAfter !== undefined && saves === crashAfter) throw new LeaseLostError();
      return result;
    },
  };
  const events: TurnEvent[] = [];
  const record = await runTurn({ db, model, job: wrapped, review: true, runCheck: fakeRunCheck().run }, { projectId: claimed.projectId, userId: claimed.userId, mode: "build", userMessageId: claimed.userMessageId }, (e) => void events.push(e));
  return { record, saves };
}

const withoutResume = (r: TurnRecord): TurnRecord => ({ ...r, log: r.log.filter((l) => !l.startsWith("↻")), steps: r.steps.map((s) => ({ ...s, id: s.id.replace(/^(tool:\d+):.*$/, "$1") })) });

describe("the review after a crash", { timeout: 180_000 }, () => {
  it("resumes at every save point with the same result, never asking the reviewer or paying twice", async () => {
    const SCRIPT = [...BUILD, { text: VERDICT }, ...FIX];
    const straight = scriptedModel(SCRIPT);
    const ref = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "Build the tip page" });
    const refRun = await runJob(ref.id, straight.client);
    const refFiles = await loadFiles(db, projectId);
    const refUsage = (await db.select().from(usageEvents)).length;
    expect(refRun.record.review).toEqual({ ok: false, issues: [ISSUE], fixed: true });
    expect(straight.requests).toHaveLength(SCRIPT.length);

    for (let crashAfter = 1; crashAfter < refRun.saves; crashAfter++) {
      db = await createTestDb();
      const user = await signInUser(db, { wallet: "0xabc", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
      userId = user.id;
      projectId = (await createProjectFromPrompt(db, userId, { prompt: "A tip jar for our football club", network: "celo-sepolia" })).id;
      const job = await enqueueTurn(db, { projectId, userId, mode: "build", prompt: "Build the tip page" });

      const first = scriptedModel(SCRIPT);
      await expect(runJob(job.id, first.client, crashAfter)).rejects.toBeInstanceOf(LeaseLostError);
      await db.update(turnJobs).set({ leaseExpiresAt: sql`now() - interval '1 second'` }).where(eq(turnJobs.id, job.id));
      const logged = (await db.select().from(turnJobCalls).where(eq(turnJobCalls.jobId, job.id))).length;
      const second = scriptedModel(SCRIPT.slice(logged));
      const resumed = await runJob(job.id, second.client);

      const label = `crash after save ${crashAfter}`;
      expect(resumed.record.status, label).toBe("ready");
      expect(await loadFiles(db, projectId), label).toEqual(refFiles);
      expect(withoutResume(resumed.record), label).toEqual(withoutResume(refRun.record));
      expect((await db.select().from(usageEvents)).length, label).toBe(refUsage);
      // Every saved reply, the reviewer's included, was replayed and not asked for again.
      expect(second.requests.length, label).toBe(SCRIPT.length - logged);
    }
  });
});
