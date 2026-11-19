import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Outbox for the on-chain GoodBuild Registry (D156). A row is one activity event waiting to be written to Celo
 * mainnet. `key` is unique per event and subject, so enqueueing twice (a retry, or the backfill) is harmless.
 * `builder` and `app` are salted hashes, never wallets or ids. The worker sends pending rows in batches.
 *
 *   pending   waiting for the next batch
 *   sending   in a batch that was sent; `batch_tx` is saved the moment it is broadcast, and the next sweep looks up
 *             its receipt instead of sending again. Rows with no `batch_tx` after 10 minutes go back to pending.
 *   sent      mined successfully in `batch_tx`
 *   failed    the batch reverted; the owner looks
 */
export const registryEvents = pgTable(
  "registry_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    /** Matches GoodBuildRegistry.Kind: 0 BuilderJoined … 5 GdollarIntegrated. */
    kind: integer("kind").notNull(),
    builder: text("builder").notNull(),
    app: text("app").notNull(),
    target: text("target").notNull(),
    txHash: text("tx_hash").notNull(),
    /** When it happened. Live events: now. Backfilled history: the source row's own time. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("pending"),
    batchTx: text("batch_tx"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    check("registry_events_status_known", sql`${t.status} in ('pending', 'sending', 'sent', 'failed')`),
    check("registry_events_kind_known", sql`${t.kind} between 0 and 5`),
    index("registry_events_status_idx").on(t.status, t.createdAt),
  ],
);
