import type { ModelClient, ModelEvent, ModelRequest, ModelTier } from "./model";

export interface ScriptedReply {
  text?: string;
  tools?: Array<{ name: string; args: unknown }>;
  usage?: { input: number; output: number };
}

/**
 * A deterministic model for tests and offline demos: returns scripted replies in order
 * and records each request (tier, last message) so tests can assert on routing.
 */
export function scriptedModel(replies: ScriptedReply[], model: Partial<Record<ModelTier, string>> = {}) {
  const requests: ModelRequest[] = [];
  let i = 0;
  const client: ModelClient = {
    async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
      requests.push({ ...req, messages: [...req.messages] });
      const reply = replies[i++];
      if (!reply) {
        yield { type: "text", delta: "Done." };
        yield { type: "done", finishReason: "stop" };
        return;
      }
      if (reply.text) {
        for (const chunk of reply.text.match(/[\s\S]{1,12}/g) ?? []) yield { type: "text", delta: chunk };
      }
      for (const [n, t] of (reply.tools ?? []).entries()) {
        yield { type: "tool_call", call: { id: `call_${i}_${n}`, name: t.name, arguments: typeof t.args === "string" ? t.args : JSON.stringify(t.args) } };
      }
      yield {
        type: "usage",
        model: model[req.tier] ?? (req.tier === "strong" ? "claude-sonnet-5-5" : "deepseek-flash"),
        inputTokens: reply.usage?.input ?? 1000,
        outputTokens: reply.usage?.output ?? 200,
        cachedInputTokens: 0,
        callId: `fake-${i}-${Math.random().toString(36).slice(2)}`,
      };
      yield { type: "done", finishReason: reply.tools?.length ? "tool_calls" : "stop" };
    },
  };
  return { client, requests };
}
