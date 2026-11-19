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
export const TIER_FOR = { plan: "cheap", build: "cheap", fix: "strong", testFix: "cheap", review: "strong", spec: "strong", contracts: "strong" } as const satisfies Record<string, ModelTier>;
/** `testFix`: first auto-fix attempt when every failing check is a contract test (D19 amendment). Later attempts use `fix`. */
/** `review`: reading the screenshots of a finished build (D87). What it finds is fixed on `build`. */
/** `spec` and `contracts` (D152, harness v2 only): the app's plan and acceptance flows, then its contracts and their tests. */

export const MODEL_IDS: Record<ModelTier, string> = { strong: "claude-sonnet-5-5", cheap: "deepseek-flash" };
const KEY_NAME: Record<ModelTier, string> = { strong: "ANTHROPIC_API_KEY", cheap: "DEEPSEEK_API_KEY" };

/** A user message part: text, or a base64 image (design references, read by the vision tier). */
export type UserPart = { type: "text"; text: string } | { type: "image"; data: string; mediaType: "image/png" | "image/jpeg" | "image/webp" };

/** OpenAI-style chat messages, the shape the runner builds. Converted to AI SDK messages inside the client. */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | UserPart[]; /** Stable prefix up to here: let Anthropic cache it for the rest of the turn. */ cache?: boolean }
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
  | { type: "usage"; model: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; callId: string; /** Prompt tokens written to the cache (a subset of inputTokens), billed at the provider's write rate (D152). */ cacheWriteTokens?: number }
  | { type: "done"; finishReason: string | null };

export interface ModelRequest {
  tier: ModelTier;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens: number;
  signal?: AbortSignal;
  /**
   * Turn off DeepSeek's thinking, for short answers on a tight output limit. With it on,
   * deepseek-flash spent all of 500, 2,500 and 6,000 output tokens on reasoning (HARNESS.md).
   */
  noThinking?: boolean;
  /** Sponsored calls are retried by the runner so each attempt goes through its budget guard. */
  noRetries?: boolean;
  /**
   * Also cache the end of the conversation on Anthropic (D152): the system prompt and the context are
   * marked already, so a long fix pass otherwise re-sends everything after them at the full price.
   */
  cacheTail?: boolean;
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

/** How long a model stream may send nothing before it counts as dropped (D138). MODEL_IDLE_MS overrides; default 2 minutes. */
export const MODEL_IDLE_MS = 120_000;

export function modelIdleMs(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.MODEL_IDLE_MS);
  return Number.isSafeInteger(value) && value > 0 ? value : MODEL_IDLE_MS;
}

/**
 * Vercel AI SDK client (D18). Provider keys come from ANTHROPIC_API_KEY and DEEPSEEK_API_KEY
 * in the server environment. Tools have no `execute`, so the SDK only returns the calls and
 * the runner applies the edits. `models` is injectable for tests.
 */
export function aiSdkClient(models?: Record<ModelTier, LanguageModel>, idleMs = modelIdleMs()): ModelClient {
  return {
    async *stream(req: ModelRequest) {
      const tier = req.tier;
      // D138: a stream that sends nothing at all (no text, thinking or tool input) for idleMs is treated as a
      // dropped connection. It ends as ModelUnavailableError, which the runner retries once, instead of
      // the build sitting on "Thinking" for as long as the provider holds the socket.
      const idle = new AbortController();
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const touch = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idle.abort(), idleMs);
      };
      const signal = req.signal ? AbortSignal.any([req.signal, idle.signal]) : idle.signal;
      touch();
      let result;
      try {
        const model = (models ?? defaultModels())[tier];
        const { system, messages } = toSdkMessages(req.messages, { cacheTail: req.cacheTail });
        result = streamText({
          model,
          messages: [...system, ...messages],
          allowSystemInMessages: true,
          tools: toSdkTools(req.tools),
          maxOutputTokens: req.maxTokens,
          maxRetries: req.noRetries ? 0 : 1,
          abortSignal: signal,
          ...(req.noThinking ? { providerOptions: { deepseek: { thinking: { type: "disabled" } } } } : {}),
        });
      } catch (error) {
        clearTimeout(idleTimer);
        throw new ModelUnavailableError(describe(error, tier));
      }

      let finishReason: string | null = null;
      try {
        for await (const part of result.fullStream) {
          touch();
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
                cacheWriteTokens: part.usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
                callId: part.response?.id || `call_${crypto.randomUUID()}`,
              } as const;
              break;
            case "error":
              throw part.error;
            default:
              break;
          }
        }
        // An abort ends the SDK's stream quietly (an "abort" part), so the idle stop is checked here too.
        if (idle.signal.aborted && !req.signal?.aborted) throw idle.signal.reason;
      } catch (error) {
        if (idle.signal.aborted && !req.signal?.aborted) throw new ModelUnavailableError(`The AI provider sent nothing for ${Math.round(idleMs / 1000)} seconds.`);
        throw new ModelUnavailableError(describe(error, tier));
      } finally {
        clearTimeout(idleTimer);
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

const CACHE = { anthropic: { cacheControl: { type: "ephemeral" } } } as const;

/**
 * The runner's OpenAI-style messages become AI SDK messages. System text is cached on Anthropic, and so is
 * a user message marked `cache`. With `cacheTail` the last message is marked too (D152): three of the four
 * breakpoints Anthropic allows, so each round of a long pass reads the one before it from the cache.
 */
export function toSdkMessages(input: ChatMessage[], options: { cacheTail?: boolean } = {}): { system: ModelMessage[]; messages: ModelMessage[] } {
  const system: ModelMessage[] = [];
  const messages: ModelMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const m of input) {
    if (m.role === "system") {
      system.push({ role: "system", content: m.content, providerOptions: CACHE });
    } else if (m.role === "user") {
      const content =
        typeof m.content === "string"
          ? m.content
          : m.content.map((p) => (p.type === "text" ? { type: "text" as const, text: p.text } : { type: "file" as const, data: p.data, mediaType: p.mediaType }));
      messages.push({ role: "user", content, ...(m.cache ? { providerOptions: CACHE } : {}) });
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
  const last = messages.at(-1);
  if (options.cacheTail && last && !last.providerOptions) last.providerOptions = CACHE;
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
