// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { liteLlmClient, ModelUnavailableError, type ModelEvent } from "./model";

// A tiny OpenAI-compatible server that streams a reply with a split tool call and usage,
// standing in for LiteLLM so the real client's parsing is tested.
let server: http.Server;
let mode: "ok" | "provider401" | "proxy401" = "ok";
let lastBody: Record<string, unknown> = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c)).on("end", () => {
      lastBody = JSON.parse(body || "{}");
      if (mode !== "ok") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: mode === "provider401" ? "litellm.AuthenticationError: AnthropicException - invalid x-api-key" : "No api key passed in." } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "claude-sonnet-5-5" };
      chunk({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "On " } }] });
      chunk({ ...base, choices: [{ index: 0, delta: { content: "it." } }] });
      chunk({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "read_", arguments: '{"pa' } }] } }] });
      chunk({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "file", arguments: 'th":"src/App.tsx"}' } }] } }] });
      chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      chunk({ ...base, choices: [], usage: { prompt_tokens: 1200, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 1000 } } });
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.LITELLM_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.LITELLM_MASTER_KEY = "sk-test";
});
afterAll(() => server.close());

async function collect(): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of liteLlmClient().stream({ tier: "strong", messages: [{ role: "user", content: "hi" }], maxTokens: 100 })) out.push(e);
  return out;
}

describe("liteLlmClient", () => {
  it("streams text, joins split tool calls, and reports usage", async () => {
    mode = "ok";
    const events = await collect();
    expect(lastBody).toMatchObject({ model: "gb-strong", stream: true, stream_options: { include_usage: true }, max_tokens: 100 });
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("On it.");
    expect(events.find((e) => e.type === "tool_call")).toEqual({
      type: "tool_call",
      call: { id: "t1", name: "read_file", arguments: '{"path":"src/App.tsx"}' },
    });
    expect(events.find((e) => e.type === "usage")).toMatchObject({ model: "claude-sonnet-5-5", inputTokens: 1200, outputTokens: 40, cachedInputTokens: 1000 });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
  });

  it("explains a bad provider key vs a bad proxy key", async () => {
    mode = "provider401";
    await expect(collect()).rejects.toThrow(/ANTHROPIC_API_KEY/);
    mode = "proxy401";
    await expect(collect()).rejects.toThrow(/LITELLM_MASTER_KEY/);
    await expect(collect()).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it("explains an unreachable proxy", async () => {
    const saved = process.env.LITELLM_BASE_URL;
    process.env.LITELLM_BASE_URL = "http://127.0.0.1:1";
    await expect(collect()).rejects.toThrow(/pnpm llm/);
    process.env.LITELLM_BASE_URL = saved;
  });
});
