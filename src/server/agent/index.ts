import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";

import { demoModel } from "./demo-model";
import { aiSdkClient, MODEL_IDS, withFallback, type ModelClient } from "./model";
import { withoutThinking } from "./vision-model";

/** The AI SDK with cheap-model fallback in normal use; the scripted demo model when GOODBUILD_DEMO_MODEL=1 (dev only). */
export function modelClient(): ModelClient {
  return process.env.GOODBUILD_DEMO_MODEL === "1" ? demoModel() : withFallback(aiSdkClient(), aiSdkClient());
}

/** For short image questions (visual check, upload descriptions): same routing, no DeepSeek thinking. */
export function visionClient(): ModelClient {
  if (process.env.GOODBUILD_DEMO_MODEL === "1") return demoModel();
  return aiSdkClient({ strong: createAnthropic()(MODEL_IDS.strong), cheap: withoutThinking(createDeepSeek()(MODEL_IDS.cheap)) });
}

export { runTurn, TurnBusyError, type TurnEvent, type TurnRecord, type Step } from "./runner";
