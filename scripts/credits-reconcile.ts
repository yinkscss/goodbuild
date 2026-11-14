/**
 * Read-only credits reconciliation (GB-01). For each chain with a credits contract, prints:
 * the scan checkpoint and how far behind the chain head it is, on-chain `Redeemed` events with no ledger
 * entry yet, and a recent sample linking each paid transaction to exactly one ledger entry. Since GB-13
 * (D111) it also prints how many events carry their quote ref (rows recorded before migration 0021 have
 * none until read again) and flags any ref with more than one ledger entry.
 * It writes nothing. Run against production with its DATABASE_URL and CREDITS_* settings:
 *
 *   pnpm exec tsx --require ./scripts/worker-preload.cjs --env-file-if-exists=.env.local scripts/credits-reconcile.ts
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { creditQuotes } from "@/server/db/credit-quotes-schema";
import { ledgerEntries } from "@/server/db/schema";
import { onchainCreditEvents } from "@/server/db/onchain-credits-schema";
import { creditsClient } from "@/server/credits/chain-client";
import { creditsContract, syncCursor } from "@/server/credits/onchain";

const CHAIN_IDS = [42220, 11142220];
const SAMPLE = 10;

async function main() {
  const db = await getDb();
  for (const chainId of CHAIN_IDS) {
    const contract = creditsContract(chainId);
    if (!contract) {
      console.log(`chain ${chainId}: no credits contract configured`);
      continue;
    }
    const cursor = await syncCursor(db, chainId);
    const head = Number(await creditsClient(chainId).getBlockNumber());
    console.log(`\nchain ${chainId}`);
    console.log(`  contract            ${contract}`);
    console.log(`  CREDITS_START_BLOCK ${process.env[`CREDITS_START_BLOCK_${chainId}`] ?? "(unset: 0)"}`);
    console.log(`  scan checkpoint     ${cursor ?? "(none yet: first scan starts at CREDITS_START_BLOCK)"}`);
    console.log(`  chain head          ${head}${cursor !== null ? ` (${head - cursor} blocks behind)` : ""}`);

    const [totals] = await db
      .select({ events: sql<number>`count(*)::int`, credited: sql<number>`count(${onchainCreditEvents.ledgerEntryId})::int`, micro: sql<number>`coalesce(sum(${onchainCreditEvents.amountMicro}), 0)::bigint` })
      .from(onchainCreditEvents)
      .where(eq(onchainCreditEvents.chainId, chainId));
    console.log(`  Redeemed events     ${totals.events} (${totals.credited} credited, ${Number(totals.micro) / 1e6} USD of credit)`);

    const [refs] = await db
      .select({ withRef: sql<number>`count(${onchainCreditEvents.ref})::int`, withoutRef: sql<number>`(count(*) - count(${onchainCreditEvents.ref}))::int` })
      .from(onchainCreditEvents)
      .where(eq(onchainCreditEvents.chainId, chainId));
    console.log(`  with a ref          ${refs.withRef} (credited once per ref); without a ref ${refs.withoutRef} (recorded before migration 0021, keyed on transaction and log)`);

    const uncredited = await db
      .select({ txHash: onchainCreditEvents.txHash, logIndex: onchainCreditEvents.logIndex, block: onchainCreditEvents.blockNumber, wallet: onchainCreditEvents.wallet, userId: onchainCreditEvents.userId, micro: onchainCreditEvents.amountMicro })
      .from(onchainCreditEvents)
      .where(and(eq(onchainCreditEvents.chainId, chainId), isNull(onchainCreditEvents.ledgerEntryId)));
    console.log(`  not yet credited    ${uncredited.length}${uncredited.length ? " (wallets with no GoodBuild account yet are credited when they sign in)" : ""}`);
    for (const u of uncredited) console.log(`    ${u.txHash}#${u.logIndex} block ${u.block} wallet ${u.wallet} ${u.micro / 1e6} USD ${u.userId ? "HAS ACCOUNT: investigate" : "no account yet"}`);

    const sample = await db
      .select({ txHash: onchainCreditEvents.txHash, logIndex: onchainCreditEvents.logIndex, ref: onchainCreditEvents.ref, micro: onchainCreditEvents.amountMicro, ledgerId: onchainCreditEvents.ledgerEntryId, ledgerMicro: ledgerEntries.amountMicro })
      .from(onchainCreditEvents)
      .leftJoin(ledgerEntries, eq(ledgerEntries.id, onchainCreditEvents.ledgerEntryId))
      .where(eq(onchainCreditEvents.chainId, chainId))
      .orderBy(desc(onchainCreditEvents.blockNumber))
      .limit(SAMPLE);
    console.log(`  recent sample (transaction -> ledger entry)`);
    for (const s of sample) console.log(`    ${s.txHash}#${s.logIndex} ref ${s.ref ?? "(none)"} ${s.micro / 1e6} USD -> ${s.ledgerId ?? "none"}${s.ledgerMicro !== null && s.ledgerMicro !== s.micro ? " AMOUNT MISMATCH" : ""}`);

    // Every on-chain event has one ledger entry at most: the ledger's idempotency key is chain:tx:log.
    const dupes = await db
      .select({ refId: ledgerEntries.refId })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.refType, "onchain"), sql`${ledgerEntries.refId} like ${`${chainId}:%`}`))
      .groupBy(ledgerEntries.refId)
      .having(sql`count(*) > 1`);
    console.log(`  duplicate ledger entries for one event: ${dupes.length}`);

    // GB-13: one ledger entry per ref. Counts the ref's own key, any old-style key on the same transaction
    // (a row recorded before migration 0021), and the entry the row points at.
    const refDupes = await db.execute<{ ref: string; entries: number }>(sql`
      select e.ref, count(distinct l.id)::int as entries
      from ${onchainCreditEvents} e
      join ${ledgerEntries} l on l.idempotency_key = 'onchain:' || e.chain_id || ':' || e.ref
        or l.idempotency_key like 'onchain:' || e.chain_id || ':' || e.tx_hash || ':%'
        or l.id = e.ledger_entry_id
      where e.chain_id = ${chainId} and e.ref is not null
      group by e.ref
      having count(distinct l.id) > 1`);
    const refRows = (Array.isArray(refDupes) ? refDupes : (refDupes as { rows: { ref: string; entries: number }[] }).rows) as { ref: string; entries: number }[];
    console.log(`  refs with more than one ledger entry: ${refRows.length}${refRows.length ? " INVESTIGATE" : ""}`);
    for (const r of refRows) console.log(`    ref ${r.ref}: ${r.entries} ledger entries`);

    const [quotes] = await db
      .select({ paid: sql<number>`count(${creditQuotes.paidTx})::int`, all: sql<number>`count(*)::int` })
      .from(creditQuotes)
      .where(eq(creditQuotes.chainId, chainId));
    console.log(`  quotes issued       ${quotes.all} (${quotes.paid} marked paid)`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
