import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./schema";

/**
 * One row per GoodDollar-verified person who received (or is receiving) network-fee CELO from the
 * gas wallet (D41, amended by D124 in DECISIONS.md: top up to 0.3 CELO, once per person, 50 a day).
 *
 * `goodid_root` is unique: the insert decides who wins a race, so a person gets one grant however many
 * wallets or tabs they use. The signed transaction is saved before it is broadcast, so a crash or an
 * unclear answer resends the SAME transaction (same nonce: it can land only once), never a new payment.
 *
 *   claimed      row taken, nothing signed yet. A crash here leaves nothing on-chain; the next try re-signs.
 *   signed       raw transaction saved, broadcast may or may not have happened.
 *   confirmed    mined successfully.
 *   needs_review unclear after retries, or mined but reverted. Never retried automatically; the owner looks.
 */
export const gasGrants = pgTable(
  "gas_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goodidRoot: text("goodid_root").notNull().unique(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    /** Lowercased session wallet that received it. Never taken from the request. */
    wallet: text("wallet").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("claimed"),
    /** Wei, as a decimal string. */
    amountWei: text("amount_wei"),
    nonce: integer("nonce"),
    txHash: text("tx_hash"),
    rawTx: text("raw_tx"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    check("gas_grants_status_known", sql`${t.status} in ('claimed', 'signed', 'confirmed', 'needs_review')`),
    check("gas_grants_reason_known", sql`${t.reason} in ('hackathon_vote', 'deploy')`),
    index("gas_grants_created_idx").on(t.createdAt),
  ],
);

export type GasGrant = typeof gasGrants.$inferSelect;
