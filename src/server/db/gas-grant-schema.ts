import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./schema";

/**
 * One row per network-fee top-up the gas wallet sends to a GoodDollar-verified person (D41, D124, D156).
 *
 * Vote grants (`reason = hackathon_vote`): `goodid_root` is unique among them, so a person gets one
 * however many wallets or tabs they use; the insert decides who wins a race. Deploy grants
 * (`reason = deploy`, D156): many per person, at most one per `plan_key` (project, chain, source, day).
 * Both kinds share this table so one lock and one nonce sequence cover everything the gas wallet signs. The signed transaction is saved before it is broadcast, so a crash or an
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
    goodidRoot: text("goodid_root").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    /** Lowercased session wallet that received it. Never taken from the request. */
    wallet: text("wallet").notNull(),
    reason: text("reason").notNull(),
    /** Deploy grants only: `<project>:<chain>:<sourceHash>:<UTC day>`. Makes a repeated prepare idempotent. */
    planKey: text("plan_key"),
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
    uniqueIndex("gas_grants_vote_root_unique").on(t.goodidRoot).where(sql`${t.reason} = 'hackathon_vote'`),
    uniqueIndex("gas_grants_plan_unique").on(t.goodidRoot, t.planKey).where(sql`${t.planKey} is not null`),
    index("gas_grants_root_day_idx").on(t.goodidRoot, t.createdAt),
    check("gas_grants_plan_key_check", sql`(${t.reason} = 'deploy') = (${t.planKey} is not null)`),
  ],
);

export type GasGrant = typeof gasGrants.$inferSelect;
