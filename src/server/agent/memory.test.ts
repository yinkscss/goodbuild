import { describe, expect, it } from "vitest";

import { scriptedModel } from "./fake-model";
import { HISTORY_WINDOW, memoryBlock, parseMemory, updateMemory, type MemoryMessage } from "./memory";

const convo = (n: number): MemoryMessage[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: i === 0 ? "Tips must be at least 5 G$ and the brand colour is #0f766e" : `message ${i}` }) as MemoryMessage);

describe("updateMemory", () => {
  it("does nothing while the conversation fits the window", async () => {
    const { client, requests } = scriptedModel([]);
    const m = await updateMemory(client, null, convo(HISTORY_WINDOW), () => undefined);
    expect(m.upTo).toBe(0);
    expect(requests).toHaveLength(0);
  });
  it("folds messages that left the window, keeping decisions as a list, and records usage", async () => {
    const { client, requests } = scriptedModel([
      { text: '```json\n{"summary": "A G$ tip jar for a club.", "decisions": ["Minimum tip 5 G$", "Brand colour #0f766e"]}\n```' },
    ]);
    const usage: string[] = [];
    const m = await updateMemory(client, null, convo(HISTORY_WINDOW + 2), (ev) => void usage.push(ev.model));
    expect(m).toEqual({ summary: "A G$ tip jar for a club.", decisions: ["Minimum tip 5 G$", "Brand colour #0f766e"], upTo: 2 });
    expect(requests[0].tier).toBe("cheap");
    expect(String(requests[0].messages[1].content)).toContain("Tips must be at least 5 G$");
    expect(usage).toEqual(["deepseek-flash"]);
    // Already folded: no new call.
    const again = await updateMemory(client, m, convo(HISTORY_WINDOW + 2), () => undefined);
    expect(again).toBe(m);
    expect(requests).toHaveLength(1);
  });
  it("keeps the user's words when the model reply can't be parsed", async () => {
    const { client } = scriptedModel([{ text: "Sorry, I can't." }]);
    const m = await updateMemory(client, { summary: "", decisions: ["Keep it green"], upTo: 0 }, convo(HISTORY_WINDOW + 1), () => undefined);
    expect(m.summary).toContain("User asked: Tips must be at least 5 G$");
    expect(m.decisions).toEqual(["Keep it green"]);
    expect(m.upTo).toBe(1);
  });
});

describe("memory text", () => {
  it("parses JSON with surrounding text and caps decisions", () => {
    const many = JSON.stringify({ summary: "s", decisions: Array.from({ length: 30 }, (_, i) => `d${i}`) });
    expect(parseMemory(`Here: ${many} done`)?.decisions).toHaveLength(15);
    expect(parseMemory("{}")).toBeNull();
  });
  it("renders decisions as rules to follow", () => {
    expect(memoryBlock({ summary: "Built a jar.", decisions: ["Minimum tip 5 G$"], upTo: 2 })).toContain("still in force; follow them):\n- Minimum tip 5 G$");
    expect(memoryBlock(null)).toBe("");
  });
});
