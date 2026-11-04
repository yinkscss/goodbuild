import "server-only";

import { demoModel } from "./demo-model";
import { aiSdkClient, withFallback, type ModelClient } from "./model";

/** The AI SDK with cheap-model fallback in normal use; the scripted demo model when GOODBUILD_DEMO_MODEL=1 (dev only). */
export function modelClient(): ModelClient {
  return process.env.GOODBUILD_DEMO_MODEL === "1" ? demoModel() : withFallback(aiSdkClient(), aiSdkClient());
}

export { runTurn, TurnBusyError, type TurnEvent, type TurnRecord, type Step } from "./runner";
