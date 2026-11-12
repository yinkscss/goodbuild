import { bigint, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { users } from "./schema";

/**
 * Hackathon registrations (D98, D99). One row per human: unique on the GoodDollar identity root, so
 * linked wallets and second accounts of the same person can't register twice. Also unique per
 * account. The credit itself lives in the ledger; these columns only point at its entries.
 */
export const hackathonRegistrations = pgTable(
  "hackathon_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hackathon: text("hackathon").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Lowercased GoodDollar root, read from the Identity contract at claim time. */
    goodidRoot: text("goodid_root").notNull(),
    /** Lowercased wallet that claimed. */
    wallet: text("wallet").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startEntryId: uuid("start_entry_id"),
    startMicro: bigint("start_micro", { mode: "number" }).notNull().default(0),
    deployEntryId: uuid("deploy_entry_id"),
    deployMicro: bigint("deploy_micro", { mode: "number" }).notNull().default(0),
    deployGrantedAt: timestamp("deploy_granted_at", { withTimezone: true }),
    /** Unspent grant removed after the deadline (a negative ledger adjust), and when. */
    expiredEntryId: uuid("expired_entry_id"),
    expiredMicro: bigint("expired_micro", { mode: "number" }).notNull().default(0),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("hackathon_registrations_root_unique").on(t.hackathon, t.goodidRoot), uniqueIndex("hackathon_registrations_user_unique").on(t.hackathon, t.userId)],
);

export type HackathonRegistration = typeof hackathonRegistrations.$inferSelect;

/**
 * Claims that were refused because the identity was already used or the budget was spent: the
 * admin page shows these as attempts to claim twice. Not-verified refusals aren't kept (no root).
 */
export const hackathonRefusals = pgTable(
  "hackathon_refusals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hackathon: text("hackathon").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goodidRoot: text("goodid_root").notNull(),
    wallet: text("wallet").notNull(),
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("hackathon_refusals_idx").on(t.hackathon, t.createdAt)],
);

export type HackathonRefusal = typeof hackathonRefusals.$inferSelect;
