import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { users } from "./schema";

/**
 * Every `Redeemed` event the GoodBuildCredits contract has emitted (D52), one row per event, unique
 * on (chain, transaction, log index) so reading the same block twice can't credit twice, and (GB-13,
 * D111) unique on (chain, ref) where a ref is known, because the contract releases each quote ref once:
 * a reorg that re-includes the transaction at another log index, or a second payment of a quote whose
 * first transaction was dropped, is the same purchase and can't be a second row.
 *
 * `userId` is null when no GoodBuild account owns the wallet yet; the row is credited the moment that
 * wallet signs in (`creditPendingForWallet`). `ledgerEntryId` is set once the ledger has the deposit.
 * Rows are never deleted: they are the audit trail between the chain and the ledger.
 */
export const onchainCreditEvents = pgTable(
  "onchain_credit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    /** Lowercased 0x wallet that burned the credits. */
    wallet: text("wallet").notNull(),
    /** GBC units, which are micro-USD (6 decimals). */
    amountMicro: bigint("amount_micro", { mode: "number" }).notNull(),
    /**
     * The event's `ref` (the quote or grant ref, lowercased 0x bytes32). Null only on rows recorded before
     * migration 0021, which keep their old ledger key; it is filled in when such a row is read again.
     */
    ref: text("ref"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    ledgerEntryId: uuid("ledger_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    creditedAt: timestamp("credited_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("onchain_credit_events_log_unique").on(t.chainId, t.txHash, t.logIndex),
    uniqueIndex("onchain_credit_events_ref_unique").on(t.chainId, t.ref).where(sql`${t.ref} is not null`),
    index("onchain_credit_events_wallet_idx").on(t.wallet),
    index("onchain_credit_events_block_idx").on(t.chainId, t.blockNumber),
    check("onchain_credit_events_amount_check", sql`${t.amountMicro} > 0`),
  ],
);

export type OnchainCreditEvent = typeof onchainCreditEvents.$inferSelect;

/**
 * How far the background scan for `Redeemed` events has read, per chain (GB-01). It is its own
 * checkpoint, not the newest stored event: an empty stretch of blocks still moves it forward, and a
 * redemption the user reported directly (out of order) can't move it past an older one nobody reported.
 * It only ever moves forward, and never past head minus SYNC_CHECKPOINT_LAG (GB-13), so the newest
 * blocks are re-read every scan, by a node that may have lagged on the previous one.
 */
export const creditsSyncCursor = pgTable("credits_sync_cursor", {
  chainId: integer("chain_id").primaryKey(),
  /** The last block every `Redeemed` event up to and including has been read and recorded. */
  lastBlock: bigint("last_block", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CreditsSyncCursor = typeof creditsSyncCursor.$inferSelect;
