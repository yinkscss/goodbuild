// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type Db } from "@/server/db/client";
import { messages, projects, usageEvents } from "@/server/db/schema";
import { signInUser } from "@/server/auth/service";
import { createProjectFromPrompt } from "@/server/projects";
import { dbAssetStore, ingestAsset } from "./asset-store";
import { scriptedModel } from "./fake-model";
import { KITS, type Kit } from "./kits";
import { FREE_BUILD_CEILING_MICRO, freeBuildCeilingMicro, runTurn, TurnBusyError, type TurnEvent } from "./runner";
import { claimTurn, listVersions, loadFiles, revertTo, saveFiles } from "./store";
import { starterFiles } from "./template";
import { fallbackIntake } from "./plan-intake";
import { fixTier, isRepeat, plainDashes } from "./runner";

describe("plainDashes", () => {
  it("turns em dashes into commas in replies", () => {
    expect(plainDashes("Built it — swap the address later.")).toBe("Built it, swap the address later.");
    expect(plainDashes("a—b")).toBe("a, b");
    expect(plainDashes("no dashes here - fine")).toBe("no dashes here - fine");
  });
});
import { DEMO_APP, DEMO_TIP_JAR_DRAFT, demoModel } from "./demo-model";

const HEADER = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";
const BROKEN = HEADER + "contract TipJar {\n  event Tipped(address indexed from, uint256 amount);\n  function tip() external payable { emit Tipped(msg.sender, msg.value) }\n}\n";
const FIXED = HEADER + "contract TipJar {\n  event Tipped(address indexed from, uint256 amount);\n  function tip() external payable { emit Tipped(msg.sender, msg.value); }\n}\n";
const PAGE = "export default function App() { return <main>Ready</main>; }\n";
const APP = `import { ConnectButton } from "./components/ConnectButton";
import { TipJarAbi, TipJarAddress } from "./contracts";
export default function App() {
  const live = Boolean(TipJarAddress[11142220]);
  return <main><ConnectButton />{live ? "Live" : "Deploy the contract to go live"} {TipJarAbi.length}</main>;
}
`;

let db: Db;
let userId: string;
let projectId: string;
let queuedId: string;

beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: "0xabc", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  const p = await createProjectFromPrompt(db, userId, { prompt: "A tip jar for our football club", network: "celo-sepolia" });
  projectId = p.id;
  const [m] = await db.select().from(messages).where(eq(messages.projectId, projectId));
  queuedId = m.id;
});

function collect() {
  const events: TurnEvent[] = [];
  return { events, emit: (e: TurnEvent) => events.push(e) };
}

describe("isRepeat", () => {
  it("matches repeats ignoring case, spacing and punctuation", () => {
    expect(isRepeat("Built the tip jar!", ["built the  tip jar"])).toBe(true);
    expect(isRepeat("Fixed the semicolon.", ["Built the tip jar."])).toBe(false);
    expect(isRepeat("ok", ["ok"])).toBe(false); // too short to judge
  });
});

describe("fixTier (D19 amendment)", () => {
  const t = { file: "contracts/test/A.t.sol", message: "ATest.testX failed", source: "test" as const };
  const solc = { file: "contracts/A.sol", message: "bad", source: "solc" as const };
  it("sends a first attempt with only test failures to the cheap tier", () => {
    expect(fixTier(1, [t, t])).toBe("cheap");
  });
  it("treats a compile error inside a test file as a test failure", () => {
    const testCompile = { file: "contracts/test/A.t.sol", message: "Invalid implicit conversion", source: "solc" as const };
    expect(fixTier(1, [testCompile, t])).toBe("cheap");
    expect(fixTier(1, [testCompile, solc])).toBe("strong");
    expect(fixTier(2, [testCompile])).toBe("strong");
  });
  it("sends mixed failures, a second attempt, or no errors to the strong tier", () => {
    expect(fixTier(1, [t, solc])).toBe("strong");
    expect(fixTier(2, [t])).toBe("strong");
    expect(fixTier(1, [])).toBe("strong");
  });
});

describe("runTurn", { timeout: 120_000 }, () => {
  it("seeds the selected project chain into generated helpers and model context", async () => {
    await db.update(projects).set({ chainId: 42220 }).where(eq(projects.id, projectId));
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: "export default function App() { return <main>Ready</main>; }\n" } }] },
      { text: "Built the app for Celo Mainnet." },
    ]);

    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    const files = await loadFiles(db, projectId);

    expect(record.status).toBe("ready");
    expect(files["src/lib/chain.ts"]).toContain("export const chain = celo;");
    expect(files["src/lib/goodbuild/wallet.ts"]).toContain("export const appChain = celo;");
    expect(String(requests[0].messages.at(-1)?.content)).toContain("Project target chain: Celo Mainnet (42220)");
  });

  it("builds, auto-fixes a compile error with the cheap model, checkpoints and bills usage", async () => {
    const { client, requests } = scriptedModel([
      {
        tools: [
          { name: "set_plan", args: { summary: "One contract, TipJar.sol, and a page to tip.", steps: ["Write TipJar.sol", "Build the UI"] } },
          { name: "create_file", args: { path: "contracts/TipJar.sol", content: BROKEN } },
          { name: "create_file", args: { path: "src/App.tsx", content: APP } },
        ],
        usage: { input: 20_000, output: 3_000 },
      },
      { text: "Built a tip jar: supporters send CELO and the page lists every tip." },
      { tools: [{ name: "edit_file", args: { path: "contracts/TipJar.sol", edits: [{ search: "msg.value) }", replace: "msg.value); }" }] } }] },
      { text: "Added the missing semicolon." },
    ]);
    const { events, emit } = collect();
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, emit);

    expect(record.status).toBe("ready");
    expect(record.version).toBe(1);
    expect(record.contracts?.map((c) => c.name)).toEqual(["TipJar"]);
    expect(record.plan?.steps).toHaveLength(2);
    // D19: the build runs on the cheap model; fix attempts go to the strong one.
    expect(requests.map((r) => r.tier)).toEqual(["cheap", "cheap", "strong", "strong"]);
    expect(record.steps.find((s) => s.id === "fix:1")).toMatchObject({ status: "done" });
    expect(record.log.some((l) => l.includes("TipJar"))).toBe(true);

    const files = await loadFiles(db, projectId);
    expect(files["contracts/TipJar.sol"]).toBe(FIXED);
    expect(files["src/contracts/TipJar.ts"]).toContain("export const TipJarAbi");
    expect(files["src/contracts/index.ts"]).toContain('export * from "./TipJar"');
    expect(files["src/components/ui/button.tsx"]).toBeDefined(); // starter template seeded

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project).toMatchObject({ status: "ready", currentVersion: 1, turnStartedAt: null });

    const usage = await db.select().from(usageEvents).where(eq(usageEvents.projectId, projectId));
    expect(usage).toHaveLength(4);
    expect(record.chargedMicro).toBe(usage.reduce((a, u) => a + u.chargedMicro, 0));
    expect(usage.every((u) => u.chargedMicro >= u.providerCostMicro && u.markupBps === 2500)).toBe(true);

    const chat = await db.select().from(messages).where(eq(messages.projectId, projectId));
    const assistant = chat.find((m) => m.role === "assistant")!;
    expect(assistant.status).toBe("done");
    expect(assistant.content).toContain("Built a tip jar");
    // Fix passes are quiet: the first reply (and its follow-ups) stays the last thing shown.
    expect(assistant.content).not.toContain("Added the missing semicolon.");
    expect(events.some((e) => e.type === "text" && e.delta.includes("semicolon"))).toBe(false);
    expect(chat.find((m) => m.id === queuedId)?.status).toBe("done");

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types).toContain("plan");
    expect(types).toContain("file");
    expect(types.at(-1)).toBe("done");
    // The sandbox gets the written files before the checks and the fix loop.
    const filesAt = events.findIndex((e) => e.type === "files");
    const fixAt = events.findIndex((e) => e.type === "step" && e.step.id === "fix:1");
    expect(filesAt).toBeGreaterThan(-1);
    expect(filesAt).toBeLessThan(fixAt);
    expect(events[filesAt]).toMatchObject({ type: "files", files: { "src/App.tsx": APP } });
  });

  it("gives the model uploaded assets: module, manifest, reference image once, and checks /assets/ paths", async () => {
    const sharp = (await import("sharp")).default;
    const store = dbAssetStore(db);
    const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#0f766e" } }).png().toBuffer();
    await ingestAsset({ store, db, model: null, projectId, userId, fileName: "Logo.png", kind: "logo", bytes: png });
    await ingestAsset({ store, db, model: null, projectId, userId, fileName: "inspo.png", kind: "reference", bytes: png });
    const app = 'import { assets } from "./assets";\nexport default function App() { return <header><img src={assets.logo.src} alt="" /><img src="/assets/missing.png" alt="" /></header>; }\n';
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: app } }] },
      { text: "Added your logo to the header." },
      { tools: [{ name: "edit_file", args: { path: "src/App.tsx", edits: [{ search: '<img src="/assets/missing.png" alt="" />', replace: "" }] } }] },
      { text: "Removed the missing image." },
    ]);
    const { emit } = collect();
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, emit);

    const first = requests[0].messages.at(-1)!;
    expect(Array.isArray(first.content)).toBe(true);
    const parts = first.content as Array<{ type: string; text?: string }>;
    expect(parts.filter((p) => p.type === "image")).toHaveLength(1);
    expect(parts[0].text).toContain("/assets/logo.png (logo, png, 40x20 · palette #0f766e) → assets.logo");
    expect(parts[0].text).toContain("inspo.png (design reference");
    expect(record.log.some((l) => l.startsWith("attached 1 design reference"))).toBe(true);
    // The check caught the made-up path; the fix removed it.
    expect(record.steps.find((s) => s.id === "app")?.detail).toContain("/assets/missing.png");
    expect(record.status).toBe("ready");
    const files = await loadFiles(db, projectId);
    expect(files["src/assets/index.ts"]).toContain('logo: { src: "/assets/logo.png"');
    expect(await store.unattached(projectId)).toHaveLength(0);
  });

  it("shows the summary once when the model repeats it after a fix", async () => {
    const summary = "Built a tip jar: supporters send CELO and the page lists every tip.";
    const { client } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "contracts/TipJar.sol", content: BROKEN } }, { name: "create_file", args: { path: "src/App.tsx", content: PAGE } }] },
      { text: summary },
      { tools: [{ name: "edit_file", args: { path: "contracts/TipJar.sol", edits: [{ search: "msg.value) }", replace: "msg.value); }" }] } }] },
      { text: summary + " " },
    ]);
    const { events, emit } = collect();
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, emit);
    const [assistant] = (await db.select().from(messages).where(eq(messages.projectId, projectId))).filter((m) => m.role === "assistant");
    expect(assistant.content).toBe(summary);
    expect(assistant.content.split("Built a tip jar").length - 1).toBe(1);
    // The fix pass is quiet, so the repeat never reaches the user.
    expect(events.some((e) => e.type === "text_set")).toBe(false);
    expect(record.status).toBe("ready");
  });

  it("asks for a reply when the build pass runs out of tool rounds, and flags no-op edits", async () => {
    const noop = { name: "edit_file", args: { path: "src/App.tsx", edits: [{ search: "export default", replace: "export default" }] } };
    const { client, requests } = scriptedModel([
      { text: "I'll start by planning this out.", tools: [{ name: "set_plan", args: { summary: "Add a thank-you banner.", steps: ["Banner"] } }, { name: "create_file", args: { path: "src/App.tsx", content: PAGE } }] },
      ...Array.from({ length: 19 }, () => ({ tools: [noop] })),
      { text: "Added a thank-you banner.\n\nWant it to show the tip amount?" },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    const [assistant] = (await db.select().from(messages).where(eq(messages.projectId, projectId))).filter((m) => m.role === "assistant");
    expect(assistant.content).toBe("Added a thank-you banner.\n\nWant it to show the tip amount?");
    expect(record.log).toContain("! stopped: too many tool rounds in one pass");
    const toolResults = requests.at(-1)!.messages.filter((m) => m.role === "tool").map((m) => String(m.content));
    expect(toolResults.some((c) => c.startsWith("No change: src/App.tsx"))).toBe(true);
    expect(String(requests.at(-1)!.messages.at(-1)!.content)).toMatch(/Reply to the user now/);
  });

  it("stops a build on free AI at its spending ceiling, then replies and saves what it made (D82)", async () => {
    const { client, requests } = scriptedModel([
      { text: "Planning.", tools: [{ name: "set_plan", args: { summary: "A page.", steps: ["Page"] } }, { name: "create_file", args: { path: "src/App.tsx", content: PAGE } }], usage: { input: 1_000_000, output: 1_000_000 } }, // about $1.9 charged: over the ceiling, under the hard stop
      { text: "I built the page; it ran out of room to do more." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.chargedMicro).toBeGreaterThanOrEqual(FREE_BUILD_CEILING_MICRO);
    // The build call, then only the reply: no more work, no fix attempts.
    expect(requests).toHaveLength(2);
    expect(String(requests[1].messages.at(-1)!.content)).toMatch(/Reply to the user now/);
    expect(record.log.some((l) => l.includes("most one build may spend on free AI"))).toBe(true);
    expect(record.status).not.toBe("error");
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toBe(PAGE);
  });

  it("reads the free-build ceiling from the environment", () => {
    expect(freeBuildCeilingMicro({})).toBe(FREE_BUILD_CEILING_MICRO);
    expect(freeBuildCeilingMicro({ FREE_BUILD_CEILING_MICRO: "2500000" })).toBe(2_500_000);
    expect(freeBuildCeilingMicro({ FREE_BUILD_CEILING_MICRO: "nope" })).toBe(FREE_BUILD_CEILING_MICRO);
  });

  it("asks for the reply again when the only reply came with a tool call", async () => {
    const { client } = scriptedModel([
      { text: "Built it.\n\nWant a goal bar?", tools: [{ name: "create_file", args: { path: "src/App.tsx", content: PAGE } }] },
      {},
      { text: "Built a tip page.\n\nWant a goal bar?" },
    ]);
    await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    const [assistant] = (await db.select().from(messages).where(eq(messages.projectId, projectId))).filter((m) => m.role === "assistant");
    expect(assistant.content).toBe("Built a tip page.\n\nWant a goal bar?");
  });

  it("a saved starter page is rebuilt on the next turn, and the preview updates before the checks", async () => {
    await saveFiles(db, projectId, starterFiles());
    const { client } = scriptedModel([
      { text: "Still looking." },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: "export default function App() { return <main>Friday</main>; }\n" } }] },
      { text: "Built the page." },
    ]);
    const { events, emit } = collect();
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", prompt: "The page still says the app is being written. Build it." }, emit);
    expect(record.status).toBe("ready");
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toContain("Friday");
    const filesAt = events.findIndex((e) => e.type === "files");
    const fixAt = events.findIndex((e) => e.type === "step" && e.step.id === "fix:1");
    expect(filesAt).toBeGreaterThan(-1);
    expect(filesAt).toBeLessThan(fixAt);
    const shown = events[filesAt];
    const saved = events.filter((e) => e.type === "files").at(-1);
    expect(shown?.type === "files" ? shown.files["src/App.tsx"] : "").toContain("Your app is being written");
    expect(saved?.type === "files" ? saved.files["src/App.tsx"] : "").toContain("Friday");
  });

  it("a build-mode question on an existing project is answered without checks or a new version", async () => {
    const first = scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP } }] }, { text: "Built it." }]);
    await runTurn({ db, model: first.client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    const { client } = scriptedModel([{ text: "I build dApps on Celo and websites.\n\nWant a landing page?" }]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", prompt: "what can you build?" }, () => {});
    expect(record.status).toBe("answered");
    expect(record.version).toBeUndefined();
    expect(record.steps.some((s) => s.id === "compile" || s.id === "app")).toBe(false);
    expect(await listVersions(db, projectId)).toHaveLength(1);
  });

  it("keeps the reply that comes with suggest_next, saves the chips and ends the pass", async () => {
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP } }] },
      { text: "Built a tip page.", tools: [{ name: "suggest_next", args: { suggestions: ["Add a leaderboard of top tippers", "  Let tips carry a note  ", "third"] } }] },
    ]);
    const { events, emit } = collect();
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, emit);
    expect(requests).toHaveLength(2); // no extra round after suggest_next
    expect(record.suggestions).toEqual(["Add a leaderboard of top tippers", "Let tips carry a note"]);
    expect(events).toContainEqual({ type: "suggestions", items: record.suggestions });
    const [assistant] = (await db.select().from(messages).where(eq(messages.projectId, projectId))).filter((m) => m.role === "assistant");
    expect(assistant.content).toBe("Built a tip page.");
    expect((assistant.meta as { suggestions?: string[] }).suggestions).toHaveLength(2);

    // The next turn's history names the chips, so "yes, the first one" has a referent.
    const next = scriptedModel([{ text: "On it." }]);
    await runTurn({ db, model: next.client }, { projectId, userId, mode: "build", prompt: "yes, the first one" }, () => {});
    const msgs = next.requests[0].messages;
    expect(String(msgs.at(-1)!.content)).toContain("offered these next steps as buttons");
    expect(String(msgs.at(-1)!.content)).toContain("1. Add a leaderboard of top tippers");
    // Not appended to the assistant's own history, so the model doesn't copy the format.
    expect(msgs.filter((m) => m.role === "assistant").every((m) => !String(m.content).includes("next steps"))).toBe(true);
  });

  it("a response cut off at the output limit doesn't end the pass; the model is asked for smaller files", async () => {
    const { client, requests } = scriptedModel([
      { text: "", finish: "length" }, // the create_file it was writing was dropped
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP } }] },
      { text: "Built it." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.log).toContain("! a response hit the output limit; asking for smaller files");
    expect(String(requests[1].messages.at(-1)!.content)).toMatch(/smaller pieces/);
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toBe(APP);
  });

  it("plan steps sent as objects become readable text", async () => {
    const { client } = scriptedModel([
      { tools: [{ name: "set_plan", args: { summary: "RTX", steps: [{ title: "Write RTX.sol", detail: "ERC-20" }, "Build the UI", { foo: 1 }] } }] },
      { text: "Planned." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "plan", userMessageId: queuedId }, () => {});
    expect(record.plan?.steps).toEqual(["Write RTX.sol", "Build the UI"]);
  });

  it("runs contract tests after compiling and sends failures to the fix loop on the cheap tier", async () => {
    const { readFileSync } = await import("node:fs");
    const run2 = readFileSync(new URL("./fixtures/rtx-run2.sol", import.meta.url), "utf8");
    const fixed = run2.replace("bool ok = transferFrom(from, to, amount);\n        if (!ok) revert TransferFailed();", "_transfer(from, to, amount);");
    const test =
      HEADER +
      'import {Test, Actor} from "@goodbuild/Test.sol";\nimport {MockGoodDollar} from "@goodbuild/MockGoodDollar.sol";\nimport {RTX} from "../RTX.sol";\n' +
      "contract RTXTest is Test {\n  function testSupply() public {\n    RTX rtx = new RTX(new MockGoodDollar());\n    assertEq(rtx.totalSupply(), 50_000_001e18, \"supply\");\n  }\n}\n";
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "contracts/RTX.sol", content: fixed } }, { name: "create_file", args: { path: "contracts/test/RTX.t.sol", content: test } }, { name: "create_file", args: { path: "src/App.tsx", content: PAGE } }] },
      { text: "Built RTX." },
      { tools: [{ name: "edit_file", args: { path: "contracts/test/RTX.t.sol", edits: [{ search: "50_000_001e18", replace: "50_000_000e18" }] } }] },
      { text: "Fixed the test." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    // Only a test failed, so the first fix attempt ran on the cheap tier.
    expect(requests.map((r) => r.tier)).toEqual(["cheap", "cheap", "cheap", "cheap"]);
    expect(record.steps.find((s) => s.id === "test")).toMatchObject({ status: "error" });
    expect(record.steps.find((s) => s.id === "test:1")).toMatchObject({ status: "done", detail: "1 test passed in a local EVM" });
    expect(record.status).toBe("ready");
    expect(record.contracts?.map((c) => c.name)).toEqual(["RTX"]);
    expect(Object.keys(await loadFiles(db, projectId)).some((p) => p.startsWith("src/contracts/RTXTest"))).toBe(false);
  });

  it("reports the auto-fix result clearly in the step rows", async () => {
    const { client } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "contracts/TipJar.sol", content: BROKEN } }, { name: "create_file", args: { path: "src/App.tsx", content: PAGE } }] },
      { text: "Done." },
      { tools: [{ name: "edit_file", args: { path: "contracts/TipJar.sol", edits: [{ search: "msg.value) }", replace: "msg.value); }" }] } }] },
      { text: "Added the semicolon." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    const compileFail = record.steps.find((s) => s.id === "compile");
    expect(compileFail).toMatchObject({ status: "error" });
    expect(compileFail?.detail).toMatch(/^1 error: TipJar\.sol:5 /);
    expect(record.steps.find((s) => s.id === "fix:1")).toMatchObject({ status: "done", detail: "all checks pass" });
    expect(record.steps.find((s) => s.id === "autofix")).toEqual({
      id: "autofix",
      label: "Auto-fix: fixed",
      detail: "Fixed 1 error on attempt 1 of 5",
      status: "done",
    });
    expect(record.log).toContain("✓ fixed 1 error on attempt 1 of 5");
  });

  it("stops early on a stuck fix and saves the build as needs_fix", async () => {
    const stuck = { tools: [{ name: "edit_file", args: { path: "contracts/TipJar.sol", edits: [{ search: "event Tipped", replace: "event  Tipped" }] } }] };
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "contracts/TipJar.sol", content: BROKEN } }, { name: "create_file", args: { path: "src/App.tsx", content: PAGE } }] },
      { text: "Done." },
      stuck,
      { text: "Tried." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("needs_fix");
    expect(record.version).toBe(1);
    // Attempt 2 sees identical errors and stops early instead of burning credits.
    expect(record.log).toContain("! the same errors came back after a fix, stopping");
    expect(requests.length).toBeLessThanOrEqual(6);
    expect(record.steps.find((s) => s.id === "autofix")).toMatchObject({
      label: "Auto-fix: failed",
      detail: "Failed after 1 attempt: the same error came back",
      status: "error",
    });
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project.status).toBe("needs_fix");
  });

  it("a G$ request that gets a native-CELO contract is sent back to fix it", async () => {
    const gd = await createProjectFromPrompt(db, userId, { prompt: "A tip jar that splits G$ 70/30", network: "celo-sepolia" });
    const [q] = await db.select().from(messages).where(eq(messages.projectId, gd.id));
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "contracts/TipJar.sol", content: FIXED } }, { name: "create_file", args: { path: "src/App.tsx", content: PAGE } }] }, // takes msg.value
      { text: "Done." },
      { text: "I'd rather not." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId: gd.id, userId, mode: "build", userMessageId: q.id }, () => {});
    expect(record.status).toBe("needs_fix");
    const fixPrompt = String(requests[2].messages.at(-1)?.content);
    expect(fixPrompt).toMatch(/msg\.value \(native CELO\)/);
    expect(fixPrompt).toMatch(/payable/);
  });

  it("the demo model builds the G$ tip jar end to end", async () => {
    const gd = await createProjectFromPrompt(db, userId, { prompt: "A tip jar for Ikeja FC that splits G$ 70/30 between the coach and the kit fund", templateId: "tip-jar", network: "celo-sepolia" });
    const [q] = await db.select().from(messages).where(eq(messages.projectId, gd.id));
    const record = await runTurn({ db, model: demoModel() }, { projectId: gd.id, userId, mode: "build", userMessageId: q.id }, () => {});
    expect(record.status).toBe("ready");
    expect(record.steps.find((s) => s.id === "autofix")).toMatchObject({ label: "Auto-fix: fixed" });
    const files = await loadFiles(db, gd.id);
    expect(files["contracts/TipJar.sol"]).toBe(DEMO_TIP_JAR_DRAFT.replace("emit Tipped(from, amount, note)\n", "emit Tipped(from, amount, note);\n"));
    expect(files["src/App.tsx"]).toBe(DEMO_APP);
    expect(files["src/contracts/TipJar.ts"]).toContain('"name": "onTokenTransfer"');
    expect(files["src/contracts/TipJar.ts"]).not.toContain('"stateMutability": "payable"');
  });

  it("plan mode answers without editing files or checkpointing", async () => {
    const { client } = scriptedModel([
      { tools: [{ name: "set_plan", args: { summary: "Add a leaderboard page", steps: ["Track totals", "New page"] } }, { name: "create_file", args: { path: "src/X.tsx", content: "x" } }] },
      { text: "Here's the plan. Switch to build mode to run it." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "plan", prompt: "How would you add a leaderboard?" }, () => {});
    expect(record.status).toBe("answered");
    expect(record.version).toBeUndefined();
    expect(record.changes).toHaveLength(0);
    expect(await loadFiles(db, projectId)).toEqual({});
  });

  it("allows one turn per project at a time", async () => {
    expect(await claimTurn(db, projectId, userId)).toBe(true);
    const { client } = scriptedModel([]);
    await expect(runTurn({ db, model: client }, { projectId, userId, mode: "build", prompt: "x" }, () => {})).rejects.toBeInstanceOf(TurnBusyError);
  });

  it("refuses another user's project", async () => {
    const other = await signInUser(db, { wallet: "0xdef", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    const { client } = scriptedModel([]);
    await expect(runTurn({ db, model: client }, { projectId, userId: other.id, mode: "build", prompt: "x" }, () => {})).rejects.toBeInstanceOf(TurnBusyError);
  });

  it("retries once when the provider fails mid-response, dropping the partial text", async () => {
    const { ModelUnavailableError } = await import("./model");
    const inner = scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP } }] }, { text: "Built it." }]);
    let failed = false;
    const client = {
      async *stream(req: Parameters<typeof inner.client.stream>[0]) {
        if (!failed) {
          failed = true;
          yield { type: "text" as const, delta: "Half a repl" };
          throw new ModelUnavailableError("The AI provider rejected the request: Failed to process successful response");
        }
        yield* inner.client.stream(req);
      },
    };
    const { events, emit } = collect();
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, emit);
    expect(record.status).toBe("ready");
    expect(record.log).toContain("! the AI provider failed mid-response; retrying once");
    expect(events).toContainEqual({ type: "text_set", text: "" });
    const [assistant] = (await db.select().from(messages).where(eq(messages.projectId, projectId))).filter((m) => m.role === "assistant");
    expect(assistant.content).toBe("Built it.");
  });

  it("ends cleanly when the model is unreachable, and releases the lock", async () => {
    const { ModelUnavailableError } = await import("./model");
    const client = {
      async *stream() {
        throw new ModelUnavailableError("The AI provider has no valid API key. Set ANTHROPIC_API_KEY in .env.local, then restart `pnpm dev`.");
      },
    };
    const { events, emit } = collect();
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, emit);
    expect(record.status).toBe("error");
    expect(record.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(await claimTurn(db, projectId, userId)).toBe(true);
  });

  it("reverts to an earlier version as a new checkpoint", async () => {
    const first = scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP.replace(/TipJar\w*/g, "x").replace(/import \{ x, x \} from "\.\/contracts";\n/, "") } }] }, { text: "v1" }]);
    await runTurn({ db, model: first.client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    const v1 = await loadFiles(db, projectId);
    const second = scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/Extra.tsx", content: "export const a = 1;\n" } }] }, { text: "v2" }]);
    await runTurn({ db, model: second.client }, { projectId, userId, mode: "build", prompt: "add extra" }, () => {});
    expect((await loadFiles(db, projectId))["src/Extra.tsx"]).toBeDefined();

    const n = await revertTo(db, projectId, 1);
    expect(n).toBe(3);
    expect(await loadFiles(db, projectId)).toEqual(v1);
    const versions = await listVersions(db, projectId);
    expect(versions[0]).toMatchObject({ number: 3, revertedFrom: 1 });
    const chat = await db.select().from(messages).where(eq(messages.projectId, projectId));
    expect(chat.some((m) => m.role === "system" && m.content.startsWith("Reverted to v1"))).toBe(true);
  });
});

describe("the fix loop's guards", () => {
  it("counts attempts that don't beat the best error count, and resets on progress", async () => {
    const { fixProgress } = await import("./runner");
    expect(fixProgress(6, 0, 1)).toEqual({ best: 1, stalls: 0 });
    expect(fixProgress(1, 0, 6)).toEqual({ best: 1, stalls: 1 });
    expect(fixProgress(1, 1, 5)).toEqual({ best: 1, stalls: 2 });
    expect(fixProgress(5, 1, 3)).toEqual({ best: 3, stalls: 0 });
  });

  it("knows when only contract tests are failing", async () => {
    const { onlyTestFailures } = await import("./runner");
    const test = { file: "contracts/test/A.t.sol", message: "A.testX failed", source: "test" as const };
    const testCompile = { file: "contracts/test/A.t.sol", message: "bad", source: "solc" as const };
    const contract = { file: "contracts/A.sol", message: "bad", source: "solc" as const };
    expect(onlyTestFailures([test, testCompile])).toBe(true);
    expect(onlyTestFailures([test, contract])).toBe(false);
    expect(onlyTestFailures([])).toBe(false);
  });
});

describe("run check in a turn (D67)", { timeout: 120_000 }, () => {
  const CRASHES = "export default function App() { const items: string[] = undefined as never; return <main>{items.length}</main>; }\n";
  const crash = { file: "src/App.tsx", message: "The app crashed when it ran: Cannot read properties of undefined (reading 'length') (in <App>)", source: "runtime" as const };

  it("sends a crash to auto-fix on the strong model, and the build ends ready once the app runs", async () => {
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: CRASHES } }] },
      { text: "Built the page." },
      { tools: [{ name: "edit_file", args: { path: "src/App.tsx", edits: [{ search: "undefined as never", replace: "[]" }] } }] },
      { text: "Fixed." },
    ]);
    const opened: string[] = [];
    const runCheck = async (files: Record<string, string>) => {
      opened.push(files["src/App.tsx"]);
      const bad = files["src/App.tsx"].includes("undefined as never");
      return { ran: true, issues: bad ? [crash] : [], note: bad ? "1 problem when the app ran" : "opened the app with no errors", ms: 1200 };
    };
    const { events, emit } = collect();
    const record = await runTurn({ db, model: client, runCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, emit);

    expect(record.status).toBe("ready");
    expect(opened).toHaveLength(2);
    expect((await loadFiles(db, projectId))["src/App.tsx"]).toContain("= []");
    // The fix pass got the runtime error, on the strong tier.
    expect(requests[2].tier).toBe("strong");
    expect(String(requests[2].messages.at(-1)?.content)).toContain("[runtime] The app crashed when it ran");
    expect(record.steps.find((s) => s.id === "run")).toMatchObject({ status: "error" });
    expect(record.steps.find((s) => s.id === "run:1")).toMatchObject({ status: "done", detail: "it runs" });
    expect(record.steps.find((s) => s.id === "autofix")).toMatchObject({ label: "Auto-fix: fixed" });
    expect(events.some((e) => e.type === "log" && e.line.includes("run check: opened the app with no errors (1.2s)"))).toBe(true);
  });

  it("never fails a build because the check couldn't run", async () => {
    const { client } = scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: "export default function App() { return <main>Ready</main>; }\n" } }] }, { text: "Built it." }]);
    const runCheck = async () => ({ ran: false, issues: [], note: "skipped: the browser wasn't available (connect ECONNREFUSED)", ms: 8000 });
    const record = await runTurn({ db, model: client, runCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(record.steps.find((s) => s.id === "run")).toMatchObject({ status: "done", detail: "skipped" });
  });

  it("doesn't open an app whose other checks failed, and gives the check the contract modules the app imports", async () => {
    const { client } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "contracts/TipJar.sol", content: BROKEN } }, { name: "create_file", args: { path: "src/App.tsx", content: APP } }] },
      { text: "Built a tip jar." },
      { tools: [{ name: "edit_file", args: { path: "contracts/TipJar.sol", edits: [{ search: "msg.value) }", replace: "msg.value); }" }] } }] },
      { text: "Fixed." },
    ]);
    const seen: Array<Record<string, string>> = [];
    const runCheck = async (files: Record<string, string>) => {
      seen.push(files);
      return { ran: true, issues: [], note: "opened the app with no errors", ms: 900 };
    };
    const record = await runTurn({ db, model: client, runCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    // Once: not while the contract failed to compile.
    expect(seen).toHaveLength(1);
    expect(seen[0]["src/contracts/TipJar.ts"]).toContain("TipJarAbi");
    expect(seen[0]["src/contracts/index.ts"]).toContain('export * from "./TipJar"');
  });

  it("stays off when the server hasn't turned it on", async () => {
    const { client } = scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: "export default function App() { return <main>Ready</main>; }\n" } }] }, { text: "Built it." }]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.steps.some((s) => s.id === "run")).toBe(false);
  });
});

describe("type check and the run_checks tool (D68)", { timeout: 120_000 }, () => {
  const GOOD = "export default function App() { return <main>Ready</main>; }\n";
  const BAD = 'import { Button } from "./components/ui/button";\nexport default function App() { return <main><Button size="huge">Go</Button></main>; }\n';
  const typeError = { file: "src/App.tsx", line: 2, message: `Type '"huge"' is not assignable to type '"default" | "sm" | "lg"'.`, source: "types" as const };
  /** Stands in for TypeScript: an error while the app still says size="huge". */
  const fakeTypes = () => {
    const runs: string[] = [];
    const typeCheck = async (files: Record<string, string>) => {
      runs.push(files["src/App.tsx"]);
      const bad = files["src/App.tsx"].includes('"huge"');
      return { ran: true, issues: bad ? [typeError] : [], note: bad ? "1 type error" : "types are consistent", ms: 5000 };
    };
    return { runs, typeCheck };
  };
  const toolResult = (req: { messages: Array<{ role: string; content?: unknown }> }) => String(req.messages.filter((m) => m.role === "tool").at(-1)?.content);

  it("lets the builder run the checks, fix what they report on the build model, and doesn't check the same files twice", async () => {
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: BAD } }, { name: "run_checks", args: {} }] },
      { tools: [{ name: "edit_file", args: { path: "src/App.tsx", edits: [{ search: 'size="huge"', replace: 'size="lg"' }] } }, { name: "run_checks", args: {} }] },
      { text: "Built the page." },
    ]);
    const { runs, typeCheck } = fakeTypes();
    const { events, emit } = collect();
    const record = await runTurn({ db, model: client, typeCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, emit);

    expect(record.status).toBe("ready");
    // The builder saw the error, then a clean result. Every call was on the build tier: no fix pass.
    expect(toolResult(requests[1])).toContain("[types] Type '\"huge\"' is not assignable");
    expect(toolResult(requests[2])).toContain("All checks pass");
    expect(requests.map((r) => r.tier)).toEqual(["cheap", "cheap", "cheap"]);
    expect(record.steps.some((s) => s.id.startsWith("fix:"))).toBe(false);
    // Two checks, both the builder's own. The end of the turn reused the second.
    expect(runs).toHaveLength(2);
    expect(events.some((e) => e.type === "log" && e.line.includes("nothing changed since the builder's last check"))).toBe(true);
    expect(record.steps.find((s) => s.id === "types:check1")).toMatchObject({ status: "error" });
    expect(record.steps.find((s) => s.id === "types:check2")).toMatchObject({ status: "done", detail: "types are consistent" });
  });

  it("checks again at the end when the builder edited after its last check", async () => {
    const { client } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: GOOD } }, { name: "run_checks", args: {} }] },
      { tools: [{ name: "edit_file", args: { path: "src/App.tsx", edits: [{ search: "Ready", replace: "Welcome" }] } }] },
      { text: "Built the page." },
    ]);
    const { runs, typeCheck } = fakeTypes();
    const record = await runTurn({ db, model: client, typeCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(runs).toHaveLength(2);
    expect(runs[1]).toContain("Welcome");
  });

  it("stops answering after three checks in a turn", async () => {
    const check = { tools: [{ name: "run_checks", args: {} }] };
    const { client, requests } = scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: GOOD } }] }, check, check, check, check, { text: "Built the page." }]);
    const { runs, typeCheck } = fakeTypes();
    const record = await runTurn({ db, model: client, typeCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(runs).toHaveLength(3);
    expect(toolResult(requests[5])).toContain("already run the checks 3 times");
  });

  it("sends type errors to auto-fix when enforced, on the cheap model first", async () => {
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: BAD } }] },
      { text: "Built the page." },
      { tools: [{ name: "edit_file", args: { path: "src/App.tsx", edits: [{ search: 'size="huge"', replace: 'size="lg"' }] } }] },
      { text: "Fixed." },
    ]);
    const { typeCheck } = fakeTypes();
    const record = await runTurn({ db, model: client, typeCheck, typeCheckMode: "enforce" }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(requests[2].tier).toBe("cheap");
    expect(String(requests[2].messages.at(-1)?.content)).toContain("[types] Type '\"huge\"'");
    expect(record.steps.find((s) => s.id === "autofix")).toMatchObject({ label: "Auto-fix: fixed" });
  });

  it("only notes type errors in warn mode: the build finishes, and the builder is told if it asks", async () => {
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: BAD } }, { name: "run_checks", args: {} }] },
      { text: "Built the page." },
    ]);
    const { typeCheck } = fakeTypes();
    const { events, emit } = collect();
    const record = await runTurn({ db, model: client, typeCheck, typeCheckMode: "warn" }, { projectId, userId, mode: "build", userMessageId: queuedId }, emit);
    expect(record.status).toBe("ready");
    expect(record.checks).toMatchObject({ errors: 0 });
    expect(toolResult(requests[1])).toContain("Nothing blocks the build, but these are worth fixing");
    expect(toolResult(requests[1])).toContain("[types]");
    expect(record.steps.find((s) => s.id === "types:check1")).toMatchObject({ status: "done", detail: "1 type error noted" });
    expect(events.some((e) => e.type === "log" && e.line.includes("type check: 1 type error, noted, not blocking"))).toBe(true);
    expect(record.steps.some((s) => s.id.startsWith("fix:"))).toBe(false);
  });

  it("refuses run_checks in plan mode, and leaves the type check off when the server hasn't set it", async () => {
    const plan = scriptedModel([{ tools: [{ name: "run_checks", args: {} }] }, { text: "Here is the plan." }]);
    await runTurn({ db, model: plan.client }, { projectId, userId, mode: "plan", userMessageId: queuedId }, () => {});
    expect(toolResult(plan.requests[1])).toContain("plan mode can't run the checks");
  });
});

describe("kits in a turn (D71)", { timeout: 120_000 }, () => {
  const demo: Kit = {
    id: "demo-kit",
    title: "Demo things",
    when: "the request is for a demo thing",
    keywords: /\bdemo thing\b/i,
    packages: { "date-fns": "4.1.0" },
    files: { "src/demo/useDemo.ts": "export const useDemo = () => 1;\n" },
    guide: "Build demo things with useDemo.",
  };
  beforeEach(() => void KITS.push(demo));
  afterEach(() => void KITS.splice(KITS.indexOf(demo), 1));
  const APP = "export default function App() { return <main>Ready</main>; }\n";

  it("turns on a kit the request asks for before the builder starts, hands it the guide, and saves it with the project", async () => {
    await db.update(messages).set({ content: "Build me a demo thing for our club" }).where(eq(messages.id, queuedId));
    const { client, requests } = scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP } }] }, { text: "Built it." }]);
    const { events, emit } = collect();
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, emit);
    expect(record.status).toBe("ready");
    const context = String(requests[0].messages.at(-1)?.content);
    expect(context).toContain("Kits on for this project: demo-kit (Demo things)");
    expect(context).toContain("Build demo things with useDemo.");
    expect(context).toContain("src/demo/useDemo.ts");
    const files = await loadFiles(db, projectId);
    expect(files["src/goodbuild.json"]).toContain("demo-kit");
    expect(files["src/demo/useDemo.ts"]).toContain("useDemo");
    expect(JSON.parse(files["package.json"]).dependencies["date-fns"]).toBe("4.1.0");
    expect(events.some((e) => e.type === "log" && e.line === "kits: turned on demo-kit for this request")).toBe(true);
  });

  it("still turns the kit on when the build starts from the plan's Start building, where the request has none of the words", async () => {
    // Plan first (D32): the person's request was the first message, answered with questions. The build turn's own message is "Start building".
    await db.update(messages).set({ content: "Build me a demo thing for our club", status: "done" }).where(eq(messages.id, queuedId));
    const [start] = await db.insert(messages).values({ projectId, role: "user", content: "Start building", status: "queued", meta: { mode: "build" } }).returning({ id: messages.id });
    const { client, requests } = scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP } }] }, { text: "Built it." }]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: start.id }, () => {});
    expect(record.status).toBe("ready");
    expect(String(requests[0].messages.at(-1)?.content)).toContain("Kits on for this project: demo-kit (Demo things)");
    expect((await loadFiles(db, projectId))["src/demo/useDemo.ts"]).toContain("useDemo");

    // A later turn goes by its own words: an old mention doesn't turn on a kit that was never asked for again.
    KITS.splice(KITS.indexOf(demo), 1);
    const other: Kit = { ...demo, id: "other-kit", keywords: /\bour club\b/i, files: { "src/other/x.ts": "export const x = 1;\n" } };
    KITS.push(other, demo);
    try {
      const [next] = await db.insert(messages).values({ projectId, role: "user", content: "Make the title bigger", status: "queued", meta: { mode: "build" } }).returning({ id: messages.id });
      const later = scriptedModel([{ text: "Done." }]);
      await runTurn({ db, model: later.client }, { projectId, userId, mode: "build", userMessageId: next.id }, () => {});
      expect(String(later.requests[0].messages.at(-1)?.content)).not.toContain("other-kit");
    } finally {
      KITS.splice(KITS.indexOf(other), 1);
    }
  });

  it("leaves a project alone when the request isn't for a kit, and lets the builder turn one on itself", async () => {
    const { client, requests } = scriptedModel([
      { tools: [{ name: "add_kit", args: { name: "demo-kit" } }, { name: "create_file", args: { path: "src/App.tsx", content: APP } }] },
      { text: "Built it." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(String(requests[0].messages.at(-1)?.content)).not.toContain("Kits on for this project");
    expect(String(requests[1].messages.find((m) => m.role === "tool")?.content)).toContain("Turned on the demo-kit kit");
    expect(record.steps.some((s) => s.label === "Adding the demo-kit kit" && s.status === "done")).toBe(true);
    expect((await loadFiles(db, projectId))["src/goodbuild.json"]).toContain("demo-kit");
  });

  /** A first build from the plan's Start building, after the plan was asked for this request. */
  const buildFromPlan = async (request: string) => {
    await db.update(messages).set({ content: request, status: "done" }).where(eq(messages.id, queuedId));
    await db.insert(messages).values({ projectId, role: "assistant", content: "A few questions.", status: "done", meta: { intake: fallbackIntake(request) } });
    const [start] = await db.insert(messages).values({ projectId, role: "user", content: "Start building", status: "queued", meta: { mode: "build" } }).returning({ id: messages.id });
    const { client } = scriptedModel([{ tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP } }] }, { text: "Built it." }]);
    await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: start.id }, () => {});
    return loadFiles(db, projectId);
  };

  it("turns the MiniPay leaderboard contract on for a MiniPay game with a leaderboard (D92)", async () => {
    const mini = await buildFromPlan("A snake game for MiniPay with a leaderboard");
    expect(JSON.parse(mini["src/goodbuild.json"]).kits).toEqual(expect.arrayContaining(["game-2d", "mini-app", "game-board"]));
    expect(mini["contracts/GameBoard.sol"]).toContain("contract GameBoard");
    expect(mini["src/game/chainBoard.ts"]).toContain("export function gameBoard");
  });

  it("leaves the contract off for a web-only game with a leaderboard: no deploy needed", async () => {
    const web = await buildFromPlan("A snake game with a leaderboard");
    expect(web["src/goodbuild.json"]).toContain("game-2d");
    expect(web["src/goodbuild.json"]).not.toContain("game-board");
    expect(web["src/game/leaderboard.ts"]).toContain("export function useLeaderboard");
  });
});
