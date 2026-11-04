import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { APICallError, jsonSchema, LoadAPIKeyError, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";

/** Which model class a call needs (D14). Plan and code use strong; cheap tasks and fallback use cheap. */
export type ModelTier = "strong" | "cheap";

/** Provider model IDs per tier (D18). Prices for both live in src/config/model-pricing.ts. */
/**
 * Which tier each kind of work uses (D19). DeepSeek writes the first pass; Claude fixes what
 * the checks reject. Moving follow-up edits to Claude later is one line: build for edits.
 */
export const TIER_FOR = { plan: "cheap", build: "cheap", fix: "strong" } as const satisfies Record<string, ModelTier>;

export const MODEL_IDS: Record<ModelTier, string> = { strong: "claude-sonnet-5-5", cheap: "deepseek-flash" };
const KEY_NAME: Record<ModelTier, string> = { strong: "ANTHROPIC_API_KEY", cheap: "DEEPSEEK_API_KEY" };

/** OpenAI-style chat messages, the shape the runner builds. Converted to AI SDK messages inside the client. */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments as produced by the model (may be invalid JSON). */
  arguments: string;
}

export type ModelEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; model: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; callId: string }
  | { type: "done"; finishReason: string | null };

export interface ModelRequest {
  tier: ModelTier;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens: number;
  signal?: AbortSignal;
}

/** Streaming chat with tool calls. Implemented over the Vercel AI SDK, or scripted in tests. */
export interface ModelClient {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

function defaultModels(): Record<ModelTier, LanguageModel> {
  // Created lazily so a missing key surfaces as a mapped error on the first call, not at import.
  return {
    strong: createAnthropic()(MODEL_IDS.strong),
    cheap: createDeepSeek()(MODEL_IDS.cheap),
  };
}

/**
 * Vercel AI SDK client (D18). Provider keys come from ANTHROPIC_API_KEY and DEEPSEEK_API_KEY
 * in the server environment. Tools have no `execute`, so the SDK only returns the calls and
 * the runner applies the edits. `models` is injectable for tests.
 */
export function aiSdkClient(models?: Record<ModelTier, LanguageModel>): ModelClient {
  return {
    async *stream(req: ModelRequest) {
      const tier = req.tier;
      let result;
      try {
        const model = (models ?? defaultModels())[tier];
        const { system, messages } = toSdkMessages(req.messages);
        result = streamText({
          model,
          messages: [...system, ...messages],
          allowSystemInMessages: true,
          tools: toSdkTools(req.tools),
          maxOutputTokens: req.maxTokens,
          maxRetries: 1,
          abortSignal: req.signal,
        });
      } catch (error) {
        throw new ModelUnavailableError(describe(error, tier));
      }

      let finishReason: string | null = null;
      try {
        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-delta":
              if (part.text) yield { type: "text", delta: part.text } as const;
              break;
            case "tool-call":
              yield {
                type: "tool_call",
                call: { id: part.toolCallId, name: part.toolName, arguments: JSON.stringify(part.input ?? {}) },
              } as const;
              break;
            case "finish-step":
              finishReason = part.finishReason ?? null;
              yield {
                type: "usage",
                model: part.response?.modelId || MODEL_IDS[tier],
                inputTokens: part.usage?.inputTokens ?? 0,
                outputTokens: part.usage?.outputTokens ?? 0,
                cachedInputTokens: part.usage?.inputTokenDetails?.cacheReadTokens ?? 0,
                callId: part.response?.id || `call_${crypto.randomUUID()}`,
              } as const;
              break;
            case "error":
              throw part.error;
            default:
              break;
          }
        }
      } catch (error) {
        throw new ModelUnavailableError(describe(error, tier));
      }
      yield { type: "done", finishReason } as const;
    },
  };
}

/**
 * A strong call that fails before emitting anything is retried once on cheap. Failures after
 * output has streamed are rethrown (a replay would duplicate text and tool calls). Cheap calls
 * and aborted requests never fall back.
 */
export function withFallback(strong: ModelClient, cheap: ModelClient): ModelClient {
  return {
    async *stream(req: ModelRequest) {
      if (req.tier !== "strong") {
        yield* cheap.stream(req);
        return;
      }
      let emitted = false;
      try {
        for await (const event of strong.stream(req)) {
          emitted = true;
          yield event;
        }
        return;
      } catch (error) {
        if (emitted || req.signal?.aborted) throw error;
      }
      yield* cheap.stream({ ...req, tier: "cheap" });
    },
  };
}

/** The runner's OpenAI-style messages become AI SDK messages. System text is cached on Anthropic. */
export function toSdkMessages(input: ChatMessage[]): { system: ModelMessage[]; messages: ModelMessage[] } {
  const system: ModelMessage[] = [];
  const messages: ModelMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const m of input) {
    if (m.role === "system") {
      system.push({ role: "system", content: m.content, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } });
    } else if (m.role === "user") {
      messages.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const parts: Extract<ModelMessage, { role: "assistant" }>["content"] = [];
      if (m.content) parts.push({ type: "text", text: m.content });
      for (const c of m.tool_calls ?? []) {
        toolNames.set(c.id, c.function.name);
        parts.push({ type: "tool-call", toolCallId: c.id, toolName: c.function.name, input: parseArgs(c.function.arguments) });
      }
      if (parts.length) messages.push({ role: "assistant", content: parts });
    } else {
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: m.tool_call_id,
            toolName: toolNames.get(m.tool_call_id) ?? "unknown",
            output: { type: "text", value: m.content },
          },
        ],
      });
    }
  }
  return { system, messages };
}

function toSdkTools(specs?: ToolSpec[]): ToolSet | undefined {
  if (!specs?.length) return undefined;
  const tools: ToolSet = {};
  for (const s of specs) {
    tools[s.function.name] = tool({
      description: s.function.description,
      inputSchema: jsonSchema(s.function.parameters ?? { type: "object", properties: {} }),
    });
  }
  return tools;
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function describe(error: unknown, tier: ModelTier): string {
  if (error instanceof ModelUnavailableError) return error.message;
  const key = KEY_NAME[tier];
  const keyHelp = `The AI provider has no valid API key. Set ${key} in .env.local, then restart \`pnpm dev\`.`;
  if (LoadAPIKeyError.isInstance(error)) return keyHelp;
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) return keyHelp;
    if (error.statusCode === 429) return "The AI provider is rate-limiting requests. Try again in a minute.";
    if (error.statusCode === undefined || error.statusCode >= 500) return "The AI provider is unreachable right now. Try again in a minute.";
    return `The AI provider rejected the request: ${error.message}`;
  }
  const e = error as { code?: string; message?: string; cause?: { code?: string } };
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|Cannot connect/i.test(`${e?.code ?? ""} ${e?.cause?.code ?? ""} ${e?.message ?? ""}`)) {
    return "The AI provider is unreachable right now. Check your connection and try again.";
  }
  return e?.message ?? "The AI service failed.";
}
