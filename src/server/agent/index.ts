import "server-only";

import { demoModel } from "./demo-model";
import { aiSdkClient, cheapModel, strongModel, withFallback, type ModelClient } from "./model";
import { withoutThinking } from "./vision-model";

/** The AI SDK with cheap-model fallback in normal use; the scripted demo model when GOODBUILD_DEMO_MODEL=1 (dev only). */
export function modelClient(): ModelClient {
  return process.env.GOODBUILD_DEMO_MODEL === "1" ? demoModel() : withFallback(aiSdkClient(), aiSdkClient());
}

/** For short image questions (visual check, upload descriptions): same routing, no DeepSeek thinking. */
export function visionClient(): ModelClient {
  if (process.env.GOODBUILD_DEMO_MODEL === "1") return demoModel();
  return aiSdkClient({ strong: strongModel(), cheap: withoutThinking(cheapModel()) });
}

export { runTurn, TurnBusyError, type TurnEvent, type TurnRecord, type Step } from "./runner";
