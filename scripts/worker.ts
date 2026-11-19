// Standalone background turn worker (P18), for hosting where the web process shouldn't run
// builds (Q31). Run with `pnpm worker`; set GOODBUILD_INLINE_WORKER=0 on the web server so only
// this process claims jobs. Needs DATABASE_URL (Postgres): PGlite is single-process.
import { getDb } from "../src/server/db/client";
import { modelClient, visionClient } from "../src/server/agent";
import { TurnWorker } from "../src/server/jobs/worker";
import { sweepFreeExpiry } from "../src/server/credits/free-expiry";
import { sweepRankSnapshot } from "../src/server/hackathon/ranks";

import { enqueueTakedowns, flushRegistry } from "../src/server/registry/outbox";

if (!process.env.DATABASE_URL) {
  console.error("pnpm worker needs DATABASE_URL (Postgres). PGlite can't be shared with the web server.");
  process.exit(1);
}

const worker = new TurnWorker({ getDb, model: modelClient, namer: visionClient }).start();
console.log(`[worker] ${worker.id} waiting for turn jobs`);

// Hackathon credits are NOT expired automatically (D130): builders keep what they haven't spent.

// Hourly: take back free credits not spent within FREE_CREDITS_EXPIRE_DAYS (D123). Safe to repeat.
const sweepFree = () => void sweepFreeExpiry(getDb).catch((e) => console.warn(`[worker] free credit expiry: ${(e as Error).message}`));
setInterval(sweepFree, 60 * 60 * 1000).unref();
sweepFree();

// Hourly: record today's hackathon ranks once per WAT day, for the leaderboard arrows (D134). Safe to repeat.
const sweepRanks = () => void sweepRankSnapshot(getDb).catch((e) => console.warn(`[worker] hackathon rank snapshot: ${(e as Error).message}`));
setInterval(sweepRanks, 60 * 60 * 1000).unref();
sweepRanks();

// Every 2 minutes: write queued activity events to the GoodBuild Registry on Celo (D156). Needs the recorder key
// file and REGISTRY_ADDRESS; with neither it does nothing. This is the only process that sends them.
const flush = () => void getDb().then(async (db) => { await enqueueTakedowns(db); return flushRegistry(db); }).catch((e) => console.warn(`[worker] registry: ${(e as Error).message}`));
setInterval(flush, 2 * 60 * 1000).unref();
flush();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal}: stopping after running jobs reach a safe point`);
    // Running jobs keep their lease until it expires; another worker resumes them.
    void worker.stop().then(() => process.exit(0));
  });
}
