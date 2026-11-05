import "server-only";

import { getDb } from "@/server/db/client";
import { modelClient, visionClient } from "@/server/agent";
import { currentWorker, ensureWorker, type TurnWorker } from "./worker";

/**
 * The worker inside the Next server (started from instrumentation.ts, and lazily from the turn
 * routes as a backstop). GOODBUILD_INLINE_WORKER=0 turns it off when `pnpm worker` runs
 * separately (hosting is open, Q31): the web process then only queues and streams.
 */
export function inlineWorker(): TurnWorker | undefined {
  if (process.env.GOODBUILD_INLINE_WORKER === "0") return currentWorker();
  return ensureWorker({ getDb, model: modelClient, namer: visionClient });
}

/** A job was queued or a stop was requested: let a local worker look now. */
export function kickWorker() {
  inlineWorker()?.kick();
}
