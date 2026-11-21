// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type Db } from "@/server/db/client";
import { messages } from "@/server/db/schema";
import { signInUser } from "@/server/auth/service";
import { createProjectFromPrompt } from "@/server/projects";
import { costMicro } from "@/lib/pricing";
import { checkContracts, pathProblem } from "./checks";
import { scriptedModel } from "./fake-model";
import { V2_LIMITS, setV1HarnessForTests, usesHarnessV2 } from "./harness";
import { toSdkMessages, type ChatMessage } from "./model";
import { capResult, requestView } from "./request-view";
import { changesSince, fixContext } from "./focused";
import { fixTierByWriter, repeatedEditNote, runTurn, wantsSpec } from "./runner";
import { SPEC_PATH, parseSpec, readSpec } from "./spec";
import { loadFiles } from "./store";
import { typeCheck as realTypeCheck } from "./type-check";
import { Workspace } from "./workspace";
import type { RunCheckResult } from "./run-check";

const ADMIN = "0x1111111111111111111111111111111111111111";
const HEADER = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";
const TIP_JAR = HEADER + "contract TipJar {\n  event Tipped(address indexed from, uint256 amount);\n  function tip() external payable { emit Tipped(msg.sender, msg.value); }\n}\n";
const APP = `import { ConnectButton } from "./components/ConnectButton";
import { TipJarAbi, TipJarAddress } from "./contracts";
export default function App() {
  const live = Boolean(TipJarAddress[11142220]);
  return <main><h1>Tips</h1><ConnectButton />{live ? "Live" : "Deploy the contract to go live"} {TipJarAbi.length}</main>;
}
`;
const SPEC = {
  summary: "A tip jar for the football club: supporters send tips and see the latest ones.",
  direction: "Bold club colours, a big scoreboard number, rounded cards.",
  pages: [{ route: "/", purpose: "Send a tip and see the total", elements: ["Send tip button", "Recent tips"] }],
  contracts: [{ name: "TipJar", purpose: "Takes tips and records them", functions: [{ name: "tip", who: "anyone", does: "Sends a tip" }], invariants: ["Every tip emits Tipped"] }],
  acceptance: [{ name: "Home loads", needs: "local", steps: [{ goto: "/" }, { expect: { text: "Tips" } }] }],
};

describe("harness flag (D152)", () => {
  it("is on for every build, with no setting to turn it off", () => {
    setV1HarnessForTests(false);
    // The old setting does nothing now.
    process.env.HARNESS_V2 = "off";
    expect(usesHarnessV2()).toBe(true);
    delete process.env.HARNESS_V2;
    setV1HarnessForTests(true);
    expect(usesHarnessV2()).toBe(false);
  });
  it("has its limits in code, with no setting", () => {
    expect(V2_LIMITS).toEqual({ maxCalls: 90, maxRounds: 40, checkBudgetMs: 240_000 });
  });
});

describe("requestView (D152)", () => {
  const big = "x".repeat(2_000);
  const convo: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: big, cache: true },
    { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "create_file", arguments: JSON.stringify({ path: "src/App.tsx", content: `line\n${big}` }) } }] },
    { role: "tool", tool_call_id: "a", content: "y".repeat(10_000) },
    { role: "assistant", content: null, tool_calls: [{ id: "b", type: "function", function: { name: "edit_file", arguments: JSON.stringify({ path: "src/App.tsx", edits: [{ search: big, replace: big }] }) } }] },
    { role: "user", content: "fix it" },
    { role: "assistant", content: null, tool_calls: [{ id: "c", type: "function", function: { name: "create_file", arguments: JSON.stringify({ path: "src/B.tsx", content: big }) } }] },
  ];

  it("trims file bodies and long results before the boundary and keeps the rest", () => {
    const view = requestView(convo, 5);
    expect(view[1]).toBe(convo[1]); // user messages are never trimmed
    const created = JSON.parse((view[2] as Extract<ChatMessage, { role: "assistant" }>).tool_calls![0].function.arguments);
    expect(created).toEqual({ path: "src/App.tsx", content: "[2 lines written to src/App.tsx earlier in this turn; read_file src/App.tsx for its current text]" });
    expect((view[3] as Extract<ChatMessage, { role: "tool" }>).content.length).toBeLessThan(4_200);
    expect((view[3] as Extract<ChatMessage, { role: "tool" }>).content).toContain("characters cut");
    expect(JSON.parse((view[4] as Extract<ChatMessage, { role: "assistant" }>).tool_calls![0].function.arguments).edits[0].replace).toContain("read_file src/App.tsx");
    expect(view[6]).toBe(convo[6]); // after the boundary, as it was
  });
  it("is deterministic and never changes the conversation", () => {
    const before = JSON.stringify(convo);
    expect(JSON.stringify(requestView(convo, 5))).toBe(JSON.stringify(requestView(convo, 5)));
    expect(JSON.stringify(convo)).toBe(before);
    expect(requestView(convo, 0)).toBe(convo);
  });
});

describe("Anthropic caching and billing (D152)", () => {
  const msgs: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "context", cache: true },
    { role: "assistant", content: null, tool_calls: [{ id: "t", type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t", content: "file" },
  ];
  it("marks the tail only when asked, for three breakpoints in all", () => {
    const plain = toSdkMessages(msgs);
    expect(plain.messages.at(-1)?.providerOptions).toBeUndefined();
    const tailed = toSdkMessages(msgs, { cacheTail: true });
    expect(tailed.messages.at(-1)?.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    const marks = [...tailed.system, ...tailed.messages].filter((m) => m.providerOptions?.anthropic).length;
    expect(marks).toBe(3);
  });
  it("prices cache writes at Sonnet's write rate, and nothing extra for DeepSeek", () => {
    const base = costMicro("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 0 });
    expect(base).toBe(2_000_000);
    expect(costMicro("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 1_000_000 })).toBe(2_500_000);
    expect(costMicro("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 600_000, cacheWriteTokens: 400_000 })).toBe(60_000 + 1_000_000);
    expect(costMicro("deepseek-flash", { inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 1_000_000 })).toBe(costMicro("deepseek-flash", { inputTokens: 1_000_000, outputTokens: 0 }));
    // An unknown model is priced like the most expensive one, cache writes included.
    expect(costMicro("some-new-model", { inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 1_000_000 })).toBe(2_500_000);
  });
});

describe("wantsSpec (D152)", () => {
  const base = { milestone: false, contractsAllowed: true, hasContracts: false, firstBuild: false, request: "make the header blue" };
  const planned = parseSpec({ summary: "s", direction: "d", pages: [], contracts: [], acceptance: [] });
  const spec = planned.ok ? planned.spec : null;
  it("plans a new app once, and a later milestone reuses that plan", () => {
    expect(wantsSpec({ ...base, spec: null, firstBuild: true })).toBe(true);
    expect(wantsSpec({ ...base, spec: null, milestone: true, contractsAllowed: false })).toBe(true);
    // The wallet milestone: a plan exists and the milestone brings no contracts.
    expect(wantsSpec({ ...base, spec, milestone: true, contractsAllowed: false })).toBe(false);
    // The payments milestone brings contracts the plan doesn't have yet.
    expect(wantsSpec({ ...base, spec, milestone: true, contractsAllowed: true })).toBe(true);
    expect(wantsSpec({ ...base, spec: spec && { ...spec, contracts: [{ name: "Goals", purpose: "p", state: [], functions: [], events: [], invariants: [] }] }, milestone: true })).toBe(false);
  });
  it("outside milestones, plans again only for a contract change", () => {
    expect(wantsSpec({ ...base, spec })).toBe(false);
    expect(wantsSpec({ ...base, spec, hasContracts: true, request: "let people withdraw early" })).toBe(true);
    expect(wantsSpec({ ...base, spec: null })).toBe(false);
  });
});

describe("fixTierByWriter (D152)", () => {
  const ui = { file: "src/App.tsx", message: "x", source: "runtime" as const };
  const sol = { file: "contracts/TipJar.sol", message: "x", source: "solc" as const };
  const test = { file: "contracts/test/TipJar.t.sol", message: "x", source: "test" as const };
  it("sends a first fix to whoever wrote every failing file", () => {
    expect(fixTierByWriter(1, [ui], new Map([["src/App.tsx", "cheap"]]))).toBe("cheap");
    expect(fixTierByWriter(1, [sol, test], new Map([["contracts/TipJar.sol", "strong"]]))).toBe("strong");
    expect(fixTierByWriter(1, [sol], new Map([["contracts/TipJar.sol", "cheap"]]))).toBe("cheap");
  });
  it("goes by path for files from earlier turns, to strong only for its own files, on every attempt", () => {
    expect(fixTierByWriter(1, [ui], new Map())).toBe("cheap");
    expect(fixTierByWriter(1, [sol], new Map())).toBe("strong");
    expect(fixTierByWriter(1, [ui, sol], new Map([["src/App.tsx", "cheap"]]))).toBe("strong");
    // DeepSeek keeps fixing the front end it wrote, however many attempts it takes.
    expect(fixTierByWriter(2, [ui], new Map([["src/App.tsx", "cheap"]]))).toBe("cheap");
    expect(fixTierByWriter(5, [ui], new Map())).toBe("cheap");
    expect(fixTierByWriter(3, [sol], new Map())).toBe("strong");
  });
});

describe("the spec (D152)", () => {
  it("parses a spec and refuses one without a summary or with a bad contract name", () => {
    const ok = parseSpec(SPEC);
    expect(ok.ok && ok.spec.contracts[0].functions[0]).toEqual({ name: "tip", who: "anyone", does: "Sends a tip" });
    expect(ok.ok && ok.spec.acceptance[0].needs).toBe("local");
    expect(parseSpec({ ...SPEC, summary: " " }).ok).toBe(false);
    expect(parseSpec({ ...SPEC, contracts: [{ name: "tip jar", purpose: "x", functions: [] }] }).ok).toBe(false);
  });
  it("is written only by write_spec, and the builder can't change it", () => {
    const ws = new Workspace({ "src/App.tsx": "x" });
    const out = ws.execute("write_spec", JSON.stringify(SPEC), "build");
    expect(out.ok).toBe(true);
    expect(out.plan?.summary).toBe(SPEC.summary);
    expect(readSpec(ws.files)?.contracts[0].name).toBe("TipJar");
    expect(pathProblem(SPEC_PATH)).toContain("the app's spec");
    expect(ws.execute("edit_file", JSON.stringify({ path: SPEC_PATH, edits: [{ search: "Tip", replace: "x" }] }), "build").ok).toBe(false);
    expect(ws.execute("delete_file", JSON.stringify({ path: SPEC_PATH }), "build").ok).toBe(false);
    expect(ws.execute("write_spec", JSON.stringify(SPEC), "plan").ok).toBe(false);
  });
});

describe("require with a message (D152)", { timeout: 60_000 }, () => {
  const withRequire = HEADER + "contract Jar {\n  uint256 public total;\n  function add(uint256 a) external { require(a > 0, \"zero\"); total += a; }\n}\n";
  it("passes in v2 and is still refused in v1", async () => {
    const v1 = await checkContracts({ "contracts/Jar.sol": withRequire });
    expect(v1.errors.some((e) => e.message.includes("custom error"))).toBe(true);
    const v2 = await checkContracts({ "contracts/Jar.sol": withRequire }, { allowRequire: true });
    expect(v2.ok).toBe(true);
  });
  it("keeps every security guardrail in v2", async () => {
    const unsafe = HEADER + "contract Jar {\n  function bye() external { require(msg.sender == tx.origin, \"x\"); }\n}\n";
    const report = await checkContracts({ "contracts/Jar.sol": unsafe }, { allowRequire: true });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => /tx\.origin/.test(e.message))).toBe(true);
  });
});

describe("runTurn with harness v2", { timeout: 120_000 }, () => {
  let db: Db;
  let userId: string;
  let projectId: string;
  let queuedId: string;
  const saved = { ACCEPTANCE: process.env.ACCEPTANCE };

  beforeEach(async () => {
    db = await createTestDb();
    const user = await signInUser(db, { wallet: ADMIN, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    userId = user.id;
    const p = await createProjectFromPrompt(db, userId, { prompt: "A tip jar for our football club", network: "celo-sepolia" });
    projectId = p.id;
    const [m] = await db.select().from(messages).where(eq(messages.projectId, projectId));
    queuedId = m.id;
  });
  afterEach(() => {
    setV1HarnessForTests(true);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const opened: RunCheckResult = { ran: true, issues: [], note: "opened the app with no errors", ms: 5, outline: "route: /\nh1: Tips" };

  it("writes the spec and the contracts on the strong model, then the front end on the fast one", async () => {
    setV1HarnessForTests(false);
    const { client, requests } = scriptedModel([
      { tools: [{ name: "run_checks", args: {} }, { name: "write_spec", args: SPEC }] },
      { tools: [{ name: "create_file", args: { path: "contracts/TipJar.sol", content: TIP_JAR } }, { name: "create_file", args: { path: "src/App.tsx", content: "nope" } }, { name: "add_kit", args: { name: "motion" } }] },
      { tools: [{ name: "run_tests", args: {} }] },
      { text: "TipJar is written." },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: APP } }, { name: "create_file", args: { path: "contracts/Other.sol", content: TIP_JAR } }, { name: "write_spec", args: { ...SPEC, summary: "Rewritten by the builder" } }] },
      { tools: [{ name: "open_app", args: { route: "/" } }] },
      { text: "Built a tip jar for the club." },
    ]);
    const record = await runTurn({ db, model: client, runCheck: async () => opened }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});

    expect(record.status).toBe("ready");
    expect(requests.map((r) => r.tier)).toEqual(["strong", "strong", "strong", "strong", "cheap", "cheap", "cheap"]);
    // The spec call reads and writes the spec only; the builders get the v2 tools and prompt.
    expect(requests[0].tools?.map((t) => t.function.name)).toContain("write_spec");
    expect(requests[0].tools?.map((t) => t.function.name)).not.toContain("create_file");
    expect(requests[4].tools?.map((t) => t.function.name)).toEqual(expect.arrayContaining(["run_tests", "open_app"]));
    expect(String(requests[0].messages[0].content)).toContain("Work until the app does what was asked");
    // The strong calls cache the tail; the fast ones don't need to.
    expect(requests[1].cacheTail).toBe(true);
    expect(requests[4].cacheTail).toBeUndefined();
    // Each phase writes only its own files.
    const toolResults = (i: number) => requests[i].messages.filter((m) => m.role === "tool").map((m) => String(m.content));
    expect(toolResults(2).some((c) => c.includes("This is the contracts phase"))).toBe(true);
    expect(toolResults(5).some((c) => c.includes("contracts/ can't change now"))).toBe(true);
    // add_kit's starter files pass the phase gate, and a tool the phase doesn't offer is refused.
    expect(toolResults(2).filter((c) => c.includes("This is the contracts phase")).length).toBe(2);
    expect(toolResults(5)).toContain("Error: write_spec isn't available in this step.");
    // The spec step's tools don't include the checks, and they are refused before they run.
    expect(toolResults(4)).toContain("Error: run_checks isn't available in this step.");
    // The contracts phase has a conversation of its own (D162): the request's context and its task, not the spec step's rounds.
    expect(toolResults(1)).toEqual([]);
    expect(requests[1].messages.map((m) => m.role)).toEqual(["system", "user", "user"]);
    expect(String(requests[1].messages.at(-1)?.content)).toMatch(/^CONTRACTS\./);
    // The front end doesn't re-read the contract work: it continues the build's own conversation.
    expect(requests[4].messages.some((m) => m.role === "assistant" && m.tool_calls?.some((c) => c.function.name === "run_tests"))).toBe(false);
    // run_tests compiled the contract; the front end was told the ABI is ready; open_app showed the page.
    expect(toolResults(3).some((c) => c.includes("Compiled TipJar with no errors"))).toBe(true);
    expect(String(requests[4].messages.at(-1)?.content)).toContain('import { <Name>Abi, <Name>Address } from "./contracts" for TipJar');
    expect(toolResults(6).some((c) => c.includes("h1: Tips"))).toBe(true);
    expect(record.plan?.summary).toBe(SPEC.summary);
    expect(record.log).toEqual(expect.arrayContaining(["harness: v2 (D152)", "phase: contracts (strong model)", "phase: front end (fast model)"]));

    const files = await loadFiles(db, projectId);
    expect(readSpec(files)?.summary).toBe(SPEC.summary);
    expect(Object.keys(files).some((p) => p.includes("motion"))).toBe(false);
    expect(files["contracts/TipJar.sol"]).toBe(TIP_JAR);
    expect(files["contracts/Other.sol"]).toBeUndefined();
    expect(files["src/App.tsx"]).toBe(APP);
    expect(files["src/contracts/TipJar.ts"]).toContain("export const TipJarAbi");
  });

  it("sends the first fix of the front end back to the fast model that wrote it", async () => {
    setV1HarnessForTests(false);
    const broken = 'import { Missing } from "./Missing";\nexport default function App() { return <main><Missing /></main>; }\n';
    const { client, requests } = scriptedModel([
      { tools: [{ name: "write_spec", args: { ...SPEC, contracts: [] } }] },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: broken } }] },
      { text: "Built the page." },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: "export default function App() { return <main><h1>Tips</h1></main>; }\n" } }] },
      { text: "Fixed the import." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(requests.map((r) => r.tier)).toEqual(["strong", "cheap", "cheap", "cheap", "cheap"]);
    expect(record.log).toContain("· fix attempt 1 on the fast model (the files' writer)");
    expect(record.log).not.toContain("phase: contracts (strong model)");
    // The fix attempt's own edit and checks are shown under it; the steps before it stand alone.
    const children = record.steps.filter((s) => s.parent === "fix:1");
    expect(children.some((s) => s.label.startsWith("Writing App.tsx"))).toBe(true);
    expect(children.some((s) => s.id.startsWith("checks:") || s.label === "Checking the app")).toBe(true);
    expect(record.steps.find((s) => s.id === "fix:1")?.parent).toBeUndefined();
    expect(record.steps.filter((s) => !s.parent).some((s) => s.label.startsWith("Writing App.tsx"))).toBe(true);
  });

  it("refuses write_spec in a v1 build", async () => {
    setV1HarnessForTests(true);
    const { client, requests } = scriptedModel([
      { tools: [{ name: "write_spec", args: SPEC }, { name: "create_file", args: { path: "src/App.tsx", content: APP } }] },
      { text: "Built it." },
    ]);
    await runTurn({ db, model: client, runCheck: async () => opened }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(requests[1].messages.filter((m) => m.role === "tool").map((m) => String(m.content))).toContain("Error: write_spec isn't available in this step.");
    expect((await loadFiles(db, projectId))[SPEC_PATH]).toBeUndefined();
  });

});

describe("acceptance flows in a v2 build (D152 PR 2)", { timeout: 120_000 }, () => {
  let db: Db;
  let userId: string;
  let projectId: string;
  let queuedId: string;
  const saved = { ACCEPTANCE: process.env.ACCEPTANCE };

  beforeEach(async () => {
    db = await createTestDb();
    const user = await signInUser(db, { wallet: ADMIN, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    userId = user.id;
    const p = await createProjectFromPrompt(db, userId, { prompt: "A landing page for our football club", network: "celo-sepolia" });
    projectId = p.id;
    const [m] = await db.select().from(messages).where(eq(messages.projectId, projectId));
    queuedId = m.id;
    setV1HarnessForTests(false);
  });
  afterEach(() => {
    setV1HarnessForTests(true);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const spec = { ...SPEC, contracts: [] };
  const withoutTips = "export default function App() { return <main><h1>Hello</h1></main>; }\n";
  // A run check that passes the spec's one flow only when the page says "Tips".
  const seen: Array<{ only?: string; flows: number }> = [];
  const flowCheck = async (files: Record<string, string>, opts: { acceptance?: { flows: unknown[]; only?: string } } = {}): Promise<RunCheckResult> => {
    if (opts.acceptance) seen.push({ only: opts.acceptance.only, flows: opts.acceptance.flows.length });
    const pass = files["src/App.tsx"]?.includes("Tips");
    return {
      ran: true,
      issues: [],
      note: "opened the app with no errors",
      ms: 1,
      ...(opts.acceptance ? { acceptance: [pass ? { name: "Home loads", needs: "local" as const, status: "pass" as const } : { name: "Home loads", needs: "local" as const, status: "fail" as const, step: 2, reason: 'step 2 (expect text "Tips" to show) failed: timeout', outline: "route: /\nh1: Hello" }] } : {}),
    };
  };

  it("warn: shows failing flows to the builder, through run_acceptance and run_checks, without blocking", async () => {
    seen.length = 0;
    const { client, requests } = scriptedModel([
      { tools: [{ name: "write_spec", args: spec }] },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: withoutTips } }] },
      { tools: [{ name: "run_acceptance", args: { flow: "home" } }] },
      { tools: [{ name: "run_checks", args: {} }] },
      { text: "Built the page." },
    ]);
    const record = await runTurn({ db, model: client, runCheck: flowCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    const results = (i: number) => requests[i].messages.filter((m) => m.role === "tool").map((m) => String(m.content));
    expect(results(3).some((c) => c.startsWith("FAIL Home loads: step 2") && c.includes("What the page showed:\nroute: /"))).toBe(true);
    expect(results(4).some((c) => c.includes("These acceptance flows from the spec fail"))).toBe(true);
    expect(seen[0]).toEqual({ only: "home", flows: 1 });
    expect(record.status).toBe("ready");
    expect(record.log.some((l) => l.startsWith("acceptance: 0 of 1 flows pass") && l.endsWith("(not blocking)"))).toBe(true);
  });

  it("never blocks on a failing flow, whatever the old ACCEPTANCE setting says", async () => {
    process.env.ACCEPTANCE = "enforce";
    const { client, requests } = scriptedModel([
      { tools: [{ name: "write_spec", args: spec }] },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: withoutTips } }] },
      { text: "Built the page." },
    ]);
    const record = await runTurn({ db, model: client, runCheck: flowCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(requests).toHaveLength(3);
    expect(record.steps.some((s) => s.id.startsWith("fix:"))).toBe(false);
  });

  it("v1 never runs acceptance flows, even with a spec file", async () => {
    setV1HarnessForTests(true);
    seen.length = 0;
    const { client } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: withoutTips } }] },
      { text: "Built it." },
    ]);
    const record = await runTurn({ db, model: client, runCheck: flowCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(seen).toEqual([]);
  });
});

describe("fixes in a v2 build (D162)", { timeout: 120_000 }, () => {
  let db: Db;
  let userId: string;
  let projectId: string;
  let queuedId: string;
  const spec = { ...SPEC, contracts: [] };
  const broken = 'import { Missing } from "./Missing";\nexport default function App() { return <main><Missing /></main>; }\n';
  const fixed = "export default function App() { return <main><h1>Tips</h1></main>; }\n";

  beforeEach(async () => {
    db = await createTestDb();
    const user = await signInUser(db, { wallet: ADMIN, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    userId = user.id;
    const p = await createProjectFromPrompt(db, userId, { prompt: "A tip jar for our football club", network: "celo-sepolia" });
    projectId = p.id;
    const [m] = await db.select().from(messages).where(eq(messages.projectId, projectId));
    queuedId = m.id;
    setV1HarnessForTests(false);
  });
  afterEach(() => setV1HarnessForTests(true));

  it("fixes in a conversation of its own: the problems and the files they name, numbered", async () => {
    const { client, requests } = scriptedModel([
      { tools: [{ name: "write_spec", args: spec }] },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: broken } }] },
      { text: "Built the page." },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: fixed } }] },
      { text: "Fixed the import." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    const fix = requests[3];
    expect(fix.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(fix.messages[0].content).toBe(requests[1].messages[0].content);
    const context = String(fix.messages[1].content);
    expect(context).toMatch(/^FIX\. GoodBuild built this app/);
    expect(context).toContain("The person asked for:");
    expect(context).toContain(`The plan for the app: ${spec.summary}`);
    expect(context).toContain('=== src/App.tsx ===');
    expect(context).toContain('1| import { Missing } from "./Missing";');
    // The token report (D162): every call counted under its step.
    expect(record.tokens?.map((r) => r.step)).toEqual(expect.arrayContaining(["spec", "build", "fix"]));
    expect(record.log.some((l) => l.startsWith("tokens by step: "))).toBe(true);
  });

  it("tries another way, fresh, when the same problem comes back, and stops after that", async () => {
    const stillBroken = broken.replace("<main>", "<main className=\"p-4\">");
    const { client, requests } = scriptedModel([
      { tools: [{ name: "write_spec", args: spec }] },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: broken } }] },
      { text: "Built the page." },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: stillBroken } }] },
      { text: "Tried a fix." },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: fixed } }] },
      { text: "Fixed it another way." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(record.log).toContain("! the same errors came back after a fix; trying once more, another way");
    const retry = String(requests[5].messages[1].content);
    expect(requests[5].messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(retry).toContain("Your last attempt didn't fix these problems");
    expect(retry).toContain('+export default function App() { return <main className="p-4">');
    expect(record.steps.find((s) => s.id === "fix:2")).toMatchObject({ status: "done", detail: "all checks pass" });
  });

  it("gives type errors one fix, then finishes the build with them noted", async () => {
    const typeCheck = async (files: Record<string, string>) => ({
      ran: true,
      issues: files["src/App.tsx"]?.includes("count={") ? [{ file: "src/App.tsx", line: 1, source: "types" as const, message: "Property 'count' does not exist on type 'IntrinsicAttributes'." }] : [],
      note: "checked",
      ms: 1,
    });
    const typed = 'function Badge() { return <span>1</span>; }\nexport default function App() { return <main><Badge count={2} /></main>; }\n';
    const { client, requests } = scriptedModel([
      { tools: [{ name: "write_spec", args: spec }] },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: typed } }] },
      { text: "Built the page." },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: typed.replace("<main>", "<main className=\"p-2\">") } }] },
      { text: "Tried." },
    ]);
    const record = await runTurn({ db, model: client, typeCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    // One fix attempt had the type error; it was not fixed, and the build still finished.
    expect(requests).toHaveLength(5);
    expect(String(requests[3].messages[1].content)).toContain("Property 'count' does not exist");
    expect(record.steps.some((s) => s.id === "fix:2")).toBe(false);
    expect(record.checks).toEqual({ errors: 0, warnings: 0 });
  });
});

describe("what v2 sends (D162)", () => {
  it("sends design pictures until told to drop them, then a note", () => {
    const convo: ChatMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: [{ type: "text", text: "context" }, { type: "image", data: "AAAA", mediaType: "image/png" }] },
    ];
    expect(requestView(convo, 1)).toEqual(convo);
    const dropped = requestView(convo, 1, { dropImages: true });
    const parts = dropped[1].content as Array<{ type: string; text?: string }>;
    expect(parts.map((p) => p.type)).toEqual(["text", "text"]);
    expect(parts[1].text).toMatch(/design reference picture was shown earlier/);
  });

  it("cuts long check output as it arrives and keeps its ends", () => {
    const long = `first problem\n${"x".repeat(20_000)}\nsummary at the end`;
    const out = capResult(long);
    expect(out.length).toBeLessThan(8_200);
    expect(out.startsWith("first problem")).toBe(true);
    expect(out.endsWith("summary at the end")).toBe(true);
    expect(capResult("short")).toBe("short");
  });

  it("reads a very long file a part at a time", () => {
    const big = Array.from({ length: 2_000 }, (_, i) => `const line${i} = ${i};`).join("\n");
    const ws = new Workspace({ "src/Big.ts": big, "src/App.tsx": APP }, { v2: true });
    const whole = ws.execute("read_file", JSON.stringify({ path: "src/Big.ts" }), "build");
    expect(whole.result.length).toBeLessThan(17_000);
    expect(whole.result).toContain("2000 lines in all");
    const part = ws.execute("read_file", JSON.stringify({ path: "src/Big.ts", start_line: 1990, end_line: 2000 }), "build");
    expect(part.result).toContain("const line1999 = 1999;");
  });

  it("shows a long file's first lines, not all of it, after a repeated failed edit", () => {
    const big = Array.from({ length: 900 }, (_, i) => `const line${i} = ${i};`).join("\n");
    const note = repeatedEditNote(big, true);
    expect(note).toContain("The file has 900 lines");
    expect(note.length).toBeLessThan(5_000);
    expect(repeatedEditNote("short file", true)).toContain("Current file:\nshort file");
  });
});

describe("focused fix context (D162)", () => {
  it("names what the last attempt changed when it starts again another way", () => {
    const files = { "src/App.tsx": "new line\n", "src/Other.tsx": "x\n" };
    const text = fixContext({
      request: "A tip jar",
      issues: "- src/App.tsx: [imports] ./Missing doesn't exist",
      errors: [{ file: "src/App.tsx", source: "imports", message: "./Missing doesn't exist" }],
      files,
      before: { "src/App.tsx": "old line\n", "src/Other.tsx": "x\n" },
    });
    expect(text).toContain("Your last attempt didn't fix these problems");
    expect(text).toContain("-old line");
    expect(text).toContain("+new line");
    expect(text).toContain("src/Other.tsx");
    expect(changesSince({ a: "1" }, { a: "1" })).toBe("Nothing: it changed no files.");
  });

  it("names a file too long for its budget instead of sending it", () => {
    const huge = "y\n".repeat(30_000);
    const files = { "src/A.tsx": huge, "src/B.tsx": huge, "src/C.tsx": huge };
    const text = fixContext({ request: "x", issues: "-", errors: ["src/A.tsx", "src/B.tsx", "src/C.tsx"].map((file) => ({ file, source: "types" as const, message: "m" })), files });
    expect(text.length).toBeLessThan(45_000);
    expect(text).toMatch(/Also named, not shown \(too long to include\): src\/C\.tsx/);
  });
});

describe("a wallet build with the real type check (D163)", { timeout: 180_000 }, () => {
  let db: Db;
  let userId: string;
  let projectId: string;
  let queuedId: string;
  const spec = { ...SPEC, contracts: [] };

  beforeEach(async () => {
    db = await createTestDb();
    const user = await signInUser(db, { wallet: ADMIN, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    userId = user.id;
    const p = await createProjectFromPrompt(db, userId, { prompt: "A G$ savings app where people connect their wallet", network: "celo-sepolia" });
    projectId = p.id;
    const [m] = await db.select().from(messages).where(eq(messages.projectId, projectId));
    queuedId = m.id;
    setV1HarnessForTests(false);
  });
  afterEach(() => setV1HarnessForTests(true));

  it("builds wallet code from the kit and from the wallet directly without a single fix attempt", async () => {
    const hook = 'import { useEffect, useState } from "react";\nimport { walletProvider } from "./chain";\nexport function useChainId() {\n  const [id, setId] = useState<number | null>(null);\n  useEffect(() => { void walletProvider()?.request({ method: "eth_chainId" }).then((h) => setId(parseInt(h as string, 16))); }, []);\n  return id;\n}\n';
    const app = 'import { useWallet } from "./lib/useWallet";\nimport { useGdBalance } from "./lib/goodbuild/gooddollar";\nimport { ConnectButton } from "./components/ConnectButton";\nimport { useChainId } from "./lib/useChainId";\nexport default function App() {\n  const { account, onRightNetwork, networkName } = useWallet();\n  const gd = useGdBalance();\n  const id = useChainId();\n  return <main><h1>Stash</h1><ConnectButton />{account && onRightNetwork ? <p>On {networkName} ({id})</p> : null}<p>{gd.formatted ?? "-"}</p></main>;\n}\n';
    const { client, requests } = scriptedModel([
      { tools: [{ name: "write_spec", args: spec }] },
      { tools: [{ name: "create_file", args: { path: "src/lib/useChainId.ts", content: hook } }, { name: "create_file", args: { path: "src/App.tsx", content: app } }] },
      { text: "Built the wallet card." },
    ]);
    const record = await runTurn({ db, model: client, typeCheck: realTypeCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(requests).toHaveLength(3);
    expect(record.steps.some((s) => s.id.startsWith("fix:"))).toBe(false);
    expect(record.log.some((l) => /type check: types are consistent/.test(l))).toBe(true);
  });

  it("tells the builder during a fix that leftover notes are information, not more work", async () => {
    const typeCheck = async (files: Record<string, string>) => ({
      ran: true,
      issues: files["src/App.tsx"]?.includes("count={") ? [{ file: "src/App.tsx", line: 1, source: "types" as const, message: "Property 'count' does not exist." }] : [],
      note: "checked",
      ms: 1,
    });
    const typed = 'function Badge() { return <span>1</span>; }\nexport default function App() { return <main><Badge count={2} /></main>; }\n';
    const { client, requests } = scriptedModel([
      { tools: [{ name: "write_spec", args: spec }] },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: typed } }] },
      { text: "Built." },
      { tools: [{ name: "run_checks", args: {} }] },
      { text: "Left the note." },
    ]);
    const record = await runTurn({ db, model: client, typeCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    const result = requests[4].messages.filter((m) => m.role === "tool").map((m) => String(m.content)).join("\n");
    expect(result).toContain("These are notes for information only. Don't spend more steps on them");
  });
});
