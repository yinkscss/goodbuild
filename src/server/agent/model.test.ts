// @vitest-environment node
import { LoadAPIKeyError, APICallError } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";

import { aiSdkClient, ModelUnavailableError, toSdkMessages, withFallback, type ChatMessage, type ModelClient, type ModelEvent, type ModelRequest } from "./model";

type Chunk = Record<string, unknown>;

const usage = {
  inputTokens: { total: 1200, noCache: 200, cacheRead: 1000, cacheWrite: 0 },
  outputTokens: { total: 40, text: 40, reasoning: 0 },
};

function mockModel(opts: { modelId?: string; chunks?: Chunk[]; error?: unknown } = {}) {
  const modelId = opts.modelId ?? "claude-sonnet-5-5";
  const chunks: Chunk[] = opts.chunks ?? [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: "msg_1", modelId },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: "On " },
    { type: "text-delta", id: "t", delta: "it." },
    { type: "text-end", id: "t" },
    { type: "tool-call", toolCallId: "t1", toolName: "read_file", input: '{"path":"src/App.tsx"}' },
    { type: "finish", usage, finishReason: { unified: "tool-calls", raw: "tool_use" } },
  ];
  return new MockLanguageModelV4({
    modelId,
    doStream: async () => {
      if (opts.error) throw opts.error;
      return { stream: simulateReadableStream({ chunks }) as never };
    },
  });
}

const tools = [
  {
    type: "function" as const,
    function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  },
];

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return { tier: "strong", messages: [{ role: "user", content: "hi" }], maxTokens: 100, ...overrides };
}

async function collect(client: ModelClient, req: ModelRequest = request()): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of client.stream(req)) out.push(e);
  return out;
}

describe("aiSdkClient", () => {
  it("maps text, tool calls, usage and done", async () => {
    const strong = mockModel();
    const events = await collect(aiSdkClient({ strong, cheap: mockModel({ modelId: "deepseek-flash" }) }), request({ tools }));
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("On it.");
    expect(events.find((e) => e.type === "tool_call")).toEqual({
      type: "tool_call",
      call: { id: "t1", name: "read_file", arguments: '{"path":"src/App.tsx"}' },
    });
    expect(events.find((e) => e.type === "usage")).toMatchObject({
      model: "claude-sonnet-5-5",
      inputTokens: 1200,
      outputTokens: 40,
      cachedInputTokens: 1000,
      callId: "msg_1",
    });
    expect(events.at(-1)).toMatchObject({ type: "done" });
    // The tool was offered to the model without an execute function.
    const sent = strong.doStreamCalls[0];
    expect(sent.maxOutputTokens).toBe(100);
    expect(sent.tools?.map((t) => t.name)).toEqual(["read_file"]);
  });

  it("uses the cheap model for the cheap tier and always reports a callId", async () => {
    const cheap = mockModel({
      modelId: "deepseek-flash",
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "ok" },
        { type: "text-end", id: "t" },
        { type: "finish", usage, finishReason: { unified: "stop", raw: "stop" } },
      ],
    });
    const strong = mockModel();
    const events = await collect(aiSdkClient({ strong, cheap }), request({ tier: "cheap" }));
    expect(strong.doStreamCalls).toHaveLength(0);
    expect(cheap.doStreamCalls).toHaveLength(1);
    const u = events.find((e) => e.type === "usage") as Extract<ModelEvent, { type: "usage" }>;
    expect(u.model).toBe("deepseek-flash");
    expect(u.callId).toBeTruthy();
  });

  it("sends the system prompt with an Anthropic cache marker", async () => {
    const strong = mockModel();
    await collect(aiSdkClient({ strong, cheap: strong }), request({ messages: [{ role: "system", content: "You build dApps." }, { role: "user", content: "hi" }] }));
    const prompt = strong.doStreamCalls[0].prompt;
    expect(prompt[0]).toMatchObject({ role: "system", content: "You build dApps.", providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } });
  });

  it("maps a missing key to a plain message naming the variable", async () => {
    const strong = mockModel({ error: new LoadAPIKeyError({ message: "Anthropic API key is missing" }) });
    const err = await collect(aiSdkClient({ strong, cheap: strong })).catch((e) => e);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect(err.message).toMatch(/ANTHROPIC_API_KEY/);
    expect(err.message).toMatch(/restart `pnpm dev`/);

    const cheap = mockModel({ error: new APICallError({ message: "bad key", url: "https://api.deepseek.com", requestBodyValues: {}, statusCode: 401 }) });
    const err2 = await collect(aiSdkClient({ strong, cheap }), request({ tier: "cheap" })).catch((e) => e);
    expect(err2.message).toMatch(/DEEPSEEK_API_KEY/);
  });

  it("says the provider is unreachable on a 5xx", async () => {
    const strong = mockModel({ error: new APICallError({ message: "boom", url: "https://x", requestBodyValues: {}, statusCode: 503, isRetryable: false }) });
    const err = await collect(aiSdkClient({ strong, cheap: strong })).catch((e) => e);
    expect(err.message).toMatch(/unreachable/);
  });
});

describe("toSdkMessages", () => {
  it("marks only the flagged user message for Anthropic caching", () => {
    const { messages } = toSdkMessages([
      { role: "user", content: "old" },
      { role: "user", content: "project context", cache: true },
    ]);
    expect(messages[0]).toEqual({ role: "user", content: "old" });
    expect(messages[1]).toMatchObject({ role: "user", providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } });
  });


  it("round-trips an assistant tool call and its result", () => {
    const convo: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      { role: "assistant", content: "reading", tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] },
      { role: "tool", tool_call_id: "c1", content: "file body" },
      { role: "assistant", content: "done" },
    ];
    const { system, messages } = toSdkMessages(convo);
    expect(system).toHaveLength(1);
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "reading" },
        { type: "tool-call", toolCallId: "c1", toolName: "read_file", input: { path: "a.ts" } },
      ],
    });
    expect(messages[2]).toEqual({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "c1", toolName: "read_file", output: { type: "text", value: "file body" } }],
    });
    expect(messages[3]).toEqual({ role: "assistant", content: [{ type: "text", text: "done" }] });
  });

  it("tolerates invalid tool-call JSON from the model", () => {
    const { messages } = toSdkMessages([{ role: "assistant", content: null, tool_calls: [{ id: "c", type: "function", function: { name: "f", arguments: "{oops" } }] }]);
    expect(messages[0]).toEqual({ role: "assistant", content: [{ type: "tool-call", toolCallId: "c", toolName: "f", input: {} }] });
  });
});

describe("withFallback", () => {
  const failing = (): ModelClient => ({
    async *stream() {
      throw new ModelUnavailableError("strong down");
    },
  });
  const replying = (text: string, calls: ModelRequest[] = []): ModelClient => ({
    async *stream(req) {
      calls.push(req);
      yield { type: "text", delta: text } as const;
      yield { type: "done", finishReason: "stop" } as const;
    },
  });

  it("retries once on cheap when strong fails before output", async () => {
    const calls: ModelRequest[] = [];
    const events = await collect(withFallback(failing(), replying("from cheap", calls)));
    expect(events[0]).toEqual({ type: "text", delta: "from cheap" });
    expect(calls[0].tier).toBe("cheap");
  });

  it("does not replay after output has streamed", async () => {
    const midStream: ModelClient = {
      async *stream() {
        yield { type: "text", delta: "partial" } as const;
        throw new ModelUnavailableError("dropped");
      },
    };
    const calls: ModelRequest[] = [];
    const out: ModelEvent[] = [];
    await expect(
      (async () => {
        for await (const e of withFallback(midStream, replying("x", calls)).stream(request())) out.push(e);
      })(),
    ).rejects.toThrow("dropped");
    expect(out).toEqual([{ type: "text", delta: "partial" }]);
    expect(calls).toHaveLength(0);
  });

  it("does not fall back for cheap calls or aborted requests", async () => {
    await expect(collect(withFallback(replying("s"), failing()), request({ tier: "cheap" }))).rejects.toThrow("strong down");
    const ctrl = new AbortController();
    ctrl.abort();
    const calls: ModelRequest[] = [];
    await expect(collect(withFallback(failing(), replying("c", calls)), request({ signal: ctrl.signal }))).rejects.toThrow("strong down");
    expect(calls).toHaveLength(0);
  });
});
