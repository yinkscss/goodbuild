/**
 * One-off backfill: mark accounts verified whose wallet GoodDollar's Identity contract already says is
 * verified, but which were never recorded (`users.verified_at` null). Before the fix, the hackathon
 * vote, approval and FlowState flows read verification from the chain without saving it, so anyone
 * verified with GoodDollar elsewhere never pressed Verify here and /stats left them out.
 * Dry run by default (prints what it would record). Add --write to save. Run against production
 * with its DATABASE_URL:
 *
 *   pnpm exec tsx --require ./scripts/worker-preload.cjs --env-file-if-exists=.env.local scripts/goodid-backfill.ts [--write]
 */
import { isNull } from "drizzle-orm";
import type { Address } from "viem";
import { celo } from "viem/chains";

import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { publicClientFor } from "@/server/deploy/service";
import { readGoodIdRoot, recordGoodIdRoot } from "@/server/goodid";

const BATCH = 10;

async function main() {
  const write = process.argv.includes("--write");
  const db = await getDb();
  const client = publicClientFor(celo.id);
  const rows = await db.select({ id: users.id, wallet: users.wallet }).from(users).where(isNull(users.verifiedAt));
  console.log(`${rows.length} accounts not marked verified; checking each on Celo${write ? "" : " (dry run)"}`);
  let found = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    await Promise.all(
      rows.slice(i, i + BATCH).map(async (row) => {
        try {
          const root = await readGoodIdRoot(client, row.wallet as Address);
          if (!root) return;
          found++;
          if (write) await recordGoodIdRoot(db, row.id, root);
        } catch (error) {
          failed++;
          console.error(`read failed for account ${row.id}`, error instanceof Error ? error.message : error);
        }
      }),
    );
  }
  console.log(`${found} verified on-chain${write ? " and recorded" : " (run with --write to record)"}; ${failed} reads failed`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
