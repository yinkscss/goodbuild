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
import { harnessLimits, harnessMode, usesHarnessV2 } from "./harness";
import { toSdkMessages, type ChatMessage } from "./model";
import { requestView } from "./request-view";
import { fixTierByWriter, runTurn } from "./runner";
import { SPEC_PATH, parseSpec, readSpec } from "./spec";
import { loadFiles, saveFiles } from "./store";
import { starterFiles } from "./template";
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
  it("is off unless HARNESS_V2 says on or admins", () => {
    expect(harnessMode({})).toBe("off");
    expect(harnessMode({ HARNESS_V2: "yes" })).toBe("off");
    expect(harnessMode({ HARNESS_V2: " ON " })).toBe("on");
    expect(harnessMode({ HARNESS_V2: "admins" })).toBe("admins");
  });
  it("in admins mode, turns on only for wallets in ADMIN_WALLETS", () => {
    const env = { HARNESS_V2: "admins", ADMIN_WALLETS: `${ADMIN.toUpperCase().replace("0X", "0x")}, junk` };
    expect(usesHarnessV2(ADMIN, env)).toBe(true);
    expect(usesHarnessV2("0x2222222222222222222222222222222222222222", env)).toBe(false);
    expect(usesHarnessV2(null, env)).toBe(false);
    expect(usesHarnessV2("0xabc", { HARNESS_V2: "on" })).toBe(true);
    expect(usesHarnessV2(ADMIN, {})).toBe(false);
  });
  it("raises the limits only through positive whole numbers", () => {
    expect(harnessLimits({})).toEqual({ maxCalls: 90, maxRounds: 40, checkBudgetMs: 240_000 });
    expect(harnessLimits({ V2_MAX_CALLS: "120", V2_MAX_ROUNDS: "-1", CHECK_BUDGET_MS: "x" })).toEqual({ maxCalls: 120, maxRounds: 40, checkBudgetMs: 240_000 });
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

describe("fixTierByWriter (D152)", () => {
  const ui = { file: "src/App.tsx", message: "x", source: "runtime" as const };
  const sol = { file: "contracts/TipJar.sol", message: "x", source: "solc" as const };
  const test = { file: "contracts/test/TipJar.t.sol", message: "x", source: "test" as const };
  it("sends a first fix to whoever wrote every failing file", () => {
    expect(fixTierByWriter(1, [ui], new Map([["src/App.tsx", "cheap"]]))).toBe("cheap");
    expect(fixTierByWriter(1, [sol, test], new Map([["contracts/TipJar.sol", "strong"]]))).toBe("strong");
    expect(fixTierByWriter(1, [sol], new Map([["contracts/TipJar.sol", "cheap"]]))).toBe("cheap");
  });
  it("goes by path for files from earlier turns, and to strong when mixed or later", () => {
    expect(fixTierByWriter(1, [ui], new Map())).toBe("cheap");
    expect(fixTierByWriter(1, [sol], new Map())).toBe("strong");
    expect(fixTierByWriter(1, [ui, sol], new Map([["src/App.tsx", "cheap"]]))).toBe("strong");
    expect(fixTierByWriter(2, [ui], new Map([["src/App.tsx", "cheap"]]))).toBe("strong");
    expect(fixTierByWriter(1, [], new Map())).toBe("strong");
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
  const saved = { HARNESS_V2: process.env.HARNESS_V2, ADMIN_WALLETS: process.env.ADMIN_WALLETS };

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
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const opened: RunCheckResult = { ran: true, issues: [], note: "opened the app with no errors", ms: 5, outline: "route: /\nh1: Tips" };

  it("writes the spec and the contracts on the strong model, then the front end on the fast one", async () => {
    process.env.HARNESS_V2 = "on";
    const { client, requests } = scriptedModel([
      { tools: [{ name: "write_spec", args: SPEC }] },
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
    process.env.HARNESS_V2 = "on";
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
  });

  it("stays on v1 for a wallet that isn't an admin in admins mode", async () => {
    process.env.HARNESS_V2 = "admins";
    process.env.ADMIN_WALLETS = "0x2222222222222222222222222222222222222222";
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: "export default function App() { return <main>Ready</main>; }\n" } }] },
      { text: "Built it." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(requests.map((r) => r.tier)).toEqual(["cheap", "cheap"]);
    expect(requests[0].tools?.map((t) => t.function.name)).not.toContain("write_spec");
    expect(record.log).not.toContain("harness: v2 (D152)");
  });
});

describe("acceptance flows in a v2 build (D152 PR 2)", { timeout: 120_000 }, () => {
  let db: Db;
  let userId: string;
  let projectId: string;
  let queuedId: string;
  const saved = { HARNESS_V2: process.env.HARNESS_V2, ACCEPTANCE: process.env.ACCEPTANCE };

  beforeEach(async () => {
    db = await createTestDb();
    const user = await signInUser(db, { wallet: ADMIN, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    userId = user.id;
    const p = await createProjectFromPrompt(db, userId, { prompt: "A landing page for our football club", network: "celo-sepolia" });
    projectId = p.id;
    const [m] = await db.select().from(messages).where(eq(messages.projectId, projectId));
    queuedId = m.id;
    process.env.HARNESS_V2 = "on";
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const spec = { ...SPEC, contracts: [] };
  const withTips = "export default function App() { return <main><h1>Tips</h1></main>; }\n";
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
    expect(record.log.some((l) => l.startsWith("acceptance: 0 of 1 flows pass") && l.endsWith("(warn: not blocking)"))).toBe(true);
  });

  it("enforce: a failing flow goes to the fix loop, back to the model that wrote the page", async () => {
    process.env.ACCEPTANCE = "enforce";
    const { client, requests } = scriptedModel([
      { tools: [{ name: "write_spec", args: spec }] },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: withoutTips } }] },
      { text: "Built the page." },
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: withTips } }] },
      { text: "Fixed the heading." },
    ]);
    const record = await runTurn({ db, model: client, runCheck: flowCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(requests.map((r) => r.tier)).toEqual(["strong", "cheap", "cheap", "cheap", "cheap"]);
    expect(String(requests[3].messages.at(-1)?.content)).toContain('[acceptance] Acceptance flow "Home loads"');
    expect(record.steps.find((s) => s.id === "fix:1")).toMatchObject({ status: "done" });
    const files = await loadFiles(db, projectId);
    expect(files["src/App.tsx"]).toBe(withTips);
  });

  it("enforce: flows from an earlier turn's spec only warn, so a later change can reword the page", async () => {
    process.env.ACCEPTANCE = "enforce";
    await saveFiles(db, projectId, { ...starterFiles(), [SPEC_PATH]: JSON.stringify(spec) });
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: withoutTips } }, { name: "run_checks", args: {} }] },
      { text: "Renamed the heading." },
    ]);
    const record = await runTurn({ db, model: client, runCheck: flowCheck }, { projectId, userId, mode: "build", userMessageId: queuedId }, () => {});
    expect(record.status).toBe("ready");
    expect(requests.map((r) => r.tier)).toEqual(["cheap", "cheap"]);
    expect(requests[1].messages.filter((m) => m.role === "tool").some((m) => String(m.content).includes("These acceptance flows from the spec fail"))).toBe(true);
    expect(record.log.some((l) => l.startsWith("acceptance: 0 of 1 flows pass") && l.endsWith("(the spec is from an earlier turn: not blocking)"))).toBe(true);
  });

  it("v1 never runs acceptance flows, even with a spec file", async () => {
    process.env.HARNESS_V2 = "off";
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
