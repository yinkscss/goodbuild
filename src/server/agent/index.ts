import "server-only";

import { demoModel } from "./demo-model";
import { liteLlmClient, type ModelClient } from "./model";

/** LiteLLM in normal use; the scripted demo model when GOODBUILD_DEMO_MODEL=1 (dev only). */
export function modelClient(): ModelClient {
  return process.env.GOODBUILD_DEMO_MODEL === "1" ? demoModel() : liteLlmClient();
}

export { runTurn, TurnBusyError, type TurnEvent, type TurnRecord, type Step } from "./runner";
