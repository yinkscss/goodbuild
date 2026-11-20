// Queue events for everything before the registry went live (D156). Safe to run twice. The worker then sends them.
//   pnpm exec tsx --require ./scripts/worker-preload.cjs scripts/registry-backfill.ts   (needs DATABASE_URL, REGISTRY_SALT, REGISTRY_ADDRESS)
import { getDb } from "../src/server/db/client";
import { backfillRegistry, registryEnabled } from "../src/server/registry/outbox";

async function main() {
  if (!registryEnabled()) {
    console.error("Set REGISTRY_SALT and REGISTRY_ADDRESS first.");
    process.exit(1);
  }
  console.log(`Queued ${await backfillRegistry(await getDb())} new events.`);
  process.exit(0);
}
void main();
