// Queue events for everything before the registry went live (D132). Safe to run twice. The worker then sends them.
//   pnpm tsx scripts/registry-backfill.ts      (needs DATABASE_URL and REGISTRY_SALT)
import { getDb } from "../src/server/db/client";
import { backfillRegistry, registryEnabled } from "../src/server/registry/outbox";

if (!registryEnabled()) {
  console.error("Set REGISTRY_SALT and REGISTRY_ADDRESS first.");
  process.exit(1);
}
console.log(`Queued ${await backfillRegistry(await getDb())} new events.`);
process.exit(0);
