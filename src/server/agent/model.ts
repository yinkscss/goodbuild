import "server-only";

import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

/** The two LiteLLM aliases the app uses (D14). Models are chosen in litellm/config.yaml. */
export type ModelTier = "strong" | "cheap";
export const MODEL_ALIAS: Record<ModelTier, string> = { strong: "gb-strong", cheap: "gb-cheap" };

export type ChatMessage = ChatCompletionMessageParam;
export type ToolSpec = ChatCompletionTool;

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

/** Streaming chat with tool calls. Implemented over LiteLLM, or scripted in tests. */
export interface ModelClient {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

/**
 * LiteLLM proxy client (OpenAI-compatible). Base URL and key from LITELLM_BASE_URL and
 * LITELLM_MASTER_KEY. Provider keys never reach this process; LiteLLM holds them.
 */
export function liteLlmClient(): ModelClient {
  const baseURL = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";
  const apiKey = process.env.LITELLM_MASTER_KEY ?? "";
  const client = new OpenAI({ baseURL, apiKey: apiKey || "missing", maxRetries: 0, timeout: 300_000 });

  return {
    async *stream(req: ModelRequest) {
      let response;
      try {
        response = await client.chat.completions.create(
          {
            model: MODEL_ALIAS[req.tier],
            messages: req.messages,
            tools: req.tools && req.tools.length ? req.tools : undefined,
            max_tokens: req.maxTokens,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: req.signal },
        );
      } catch (error) {
        throw new ModelUnavailableError(describe(error, baseURL));
      }

      const pending = new Map<number, ToolCall>();
      let finishReason: string | null = null;
      let model: string = MODEL_ALIAS[req.tier];
      let callId = "";

      for await (const chunk of response) {
        callId ||= chunk.id;
        if (chunk.model) model = chunk.model;
        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta;
          if (delta?.content) yield { type: "text", delta: delta.content } as const;
          for (const tc of delta?.tool_calls ?? []) {
            const existing = pending.get(tc.index) ?? { id: tc.id ?? `call_${tc.index}`, name: "", arguments: "" };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            pending.set(tc.index, existing);
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
        if (chunk.usage) {
          yield {
            type: "usage",
            model,
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
            callId,
          } as const;
        }
      }
      for (const call of [...pending.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)) {
        yield { type: "tool_call", call } as const;
      }
      yield { type: "done", finishReason } as const;
    },
  };
}

function describe(error: unknown, baseURL: string): string {
  const e = error as { status?: number; message?: string; code?: string };
  if (e?.code === "ECONNREFUSED" || /fetch failed|ECONNREFUSED|Connection error/i.test(e?.message ?? "")) {
    return `The AI service isn't reachable at ${baseURL}. Start it with \`pnpm llm\`.`;
  }
  const text = e?.message ?? "";
  if (/AnthropicException|DeepseekException|invalid x-api-key|authentication_error/i.test(text) && e?.status === 401) {
    return "The AI provider rejected its API key. Check ANTHROPIC_API_KEY and DEEPSEEK_API_KEY in .env.local, then restart `pnpm llm`.";
  }
  if (e?.status === 401 || /No api key passed|Invalid proxy|LiteLLM Virtual Key/i.test(text)) {
    return "The AI service rejected GoodBuild's key. LITELLM_MASTER_KEY must match in the app and the proxy.";
  }
  if (e?.status === 429) return "The AI provider is rate-limiting requests. Try again in a minute.";
  return e?.message ?? "The AI service failed.";
}
