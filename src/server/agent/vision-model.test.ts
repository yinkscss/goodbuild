// @vitest-environment node
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { expect, it } from "vitest";

import { withoutThinking } from "./vision-model";

it("asks DeepSeek for no thinking on every call", async () => {
  const seen: unknown[] = [];
  const model = new MockLanguageModelV4({
    modelId: "deepseek-flash",
    doGenerate: async (options) => {
      seen.push(options.providerOptions);
      return {
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      };
    },
  });
  await generateText({ model: withoutThinking(model), prompt: "hi" });
  expect(seen[0]).toMatchObject({ deepseek: { thinking: { type: "disabled" } } });
});
