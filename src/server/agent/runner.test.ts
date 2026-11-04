// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type Db } from "@/server/db/client";
import { messages, projects, usageEvents } from "@/server/db/schema";
import { signInUser } from "@/server/auth/service";
import { createProjectFromPrompt } from "@/server/projects";
import { scriptedModel } from "./fake-model";
import { runTurn, TurnBusyError, type TurnEvent } from "./runner";
import { claimTurn, listVersions, loadFiles, revertTo } from "./store";

const HEADER = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";
const BROKEN = HEADER + "contract TipJar {\n  event Tipped(address indexed from, uint256 amount);\n  function tip() external payable { emit Tipped(msg.sender, msg.value) }\n}\n";
const FIXED = HEADER + "contract TipJar {\n  event Tipped(address indexed from, uint256 amount);\n  function tip() external payable { emit Tipped(msg.sender, msg.value); }\n}\n";
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

describe("runTurn", { timeout: 120_000 }, () => {
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
    // Fix attempt 1 goes to the cheap model; everything else to the strong one.
    expect(requests.map((r) => r.tier)).toEqual(["strong", "strong", "cheap", "cheap"]);
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
    expect(assistant.content).toContain("tip.\n\nAdded the missing semicolon.");
    expect(chat.find((m) => m.id === queuedId)?.status).toBe("done");

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types).toContain("plan");
    expect(types).toContain("file");
    expect(types.at(-1)).toBe("done");
  });

  it("stops after 3 failed fix attempts and saves the build as needs_fix", async () => {
    const stuck = { tools: [{ name: "edit_file", args: { path: "contracts/TipJar.sol", edits: [{ search: "event Tipped", replace: "event  Tipped" }] } }] };
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "contracts/TipJar.sol", content: BROKEN } }] },
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
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project.status).toBe("needs_fix");
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

  it("ends cleanly when the model is unreachable, and releases the lock", async () => {
    const { ModelUnavailableError } = await import("./model");
    const client = {
      async *stream() {
        throw new ModelUnavailableError("The AI service isn't reachable at http://localhost:4000. Start it with `pnpm llm`.");
      },
    };
    const { events, emit } = collect();
    const record = await runTurn({ db, model: client }, { projectId, userId, mode: "build", userMessageId: queuedId }, emit);
    expect(record.status).toBe("error");
    expect(record.error).toMatch(/pnpm llm/);
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
