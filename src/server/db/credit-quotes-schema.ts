import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./schema";

/**
 * Every G$ price quote GoodBuild signed for the credits contract (D56). One row per quote, keyed by the
 * quote's `ref` (the same bytes32 the contract records and emits in `Redeemed`). It is the audit trail
 * between what we offered, what the chain says was paid, and what reached the ledger, and it is how the
 * monthly verification bonus is counted per GoodID root: a quote counts against the cap while it can
 * still be paid (not expired) or once it was paid.
 */
export const creditQuotes = pgTable(
  "credit_quotes",
  {
    ref: text("ref").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    chainId: integer("chain_id").notNull(),
    wallet: text("wallet").notNull(),
    /** The verified GoodID root behind the wallet when a bonus was included, lowercased. */
    goodidRoot: text("goodid_root"),
    /** Whole credits in the pack (10, 50, 100). */
    pack: integer("pack").notNull(),
    creditsMicro: bigint("credits_micro", { mode: "number" }).notNull(),
    bonusMicro: bigint("bonus_micro", { mode: "number" }).notNull().default(0),
    /** G$ in wei, as a decimal string. */
    gdWei: text("gd_wei").notNull(),
    /** USD per G$ the price used, as text, for the audit trail. */
    gdUsd: text("gd_usd").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    paidTx: text("paid_tx"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_quotes_root_idx").on(t.goodidRoot, t.createdAt), index("credit_quotes_user_idx").on(t.userId)],
);

export type CreditQuote = typeof creditQuotes.$inferSelect;
