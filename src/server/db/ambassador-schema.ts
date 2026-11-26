import { pgTable, uuid, text, timestamp, integer, uniqueIndex, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./schema";
import { referrals } from "./referral-schema";

export const ambassadorPayouts = pgTable("ambassador_payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  wallet: text("wallet").notNull(),
  amountG: integer("amount_g").notNull(),
  status: text("status").notNull().default("requested"),
  reason: text("reason"),
  txHash: text("tx_hash"),
  logIndex: integer("log_index"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, t => [
  uniqueIndex("ambassador_one_open_request").on(t.userId).where(sql`${t.status} in ('requested', 'processing')`),
  uniqueIndex("ambassador_transfer_once").on(t.txHash, t.logIndex),
  check("ambassador_payout_status", sql`${t.status} in ('requested', 'processing', 'paid', 'rejected')`),
  check("ambassador_positive_payout", sql`${t.amountG} >= 25000`),
]);

export const ambassadorEarnings = pgTable("ambassador_earnings", {
  id: uuid("id").primaryKey().defaultRandom(),
  referralId: uuid("referral_id").notNull().unique().references(() => referrals.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  root: text("root").notNull().unique(),
  amountG: integer("amount_g").notNull().default(5000),
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }).notNull().defaultNow(),
  voteHash: text("vote_hash"),
  payoutId: uuid("payout_id").references(() => ambassadorPayouts.id),
});

export const ambassadorAudit = pgTable("ambassador_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  payoutId: uuid("payout_id").references(() => ambassadorPayouts.id),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A paid ambassador payout turned into Naira through GoodCash (D173). The person's own wallet signs the G$ transfer;
 * GoodCash pays the bank. We keep the bank's name, the account name and the last four digits only, never the full
 * account number. One live or paid cash out per payout; a failed, refunded or expired one can be tried again.
 */
export const ambassadorCashouts = pgTable("ambassador_cashouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  payoutId: uuid("payout_id").notNull().references(() => ambassadorPayouts.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  wallet: text("wallet").notNull(),
  goodcashId: text("goodcash_id").notNull().unique(),
  mode: text("mode").notNull(),
  amountG: integer("amount_g").notNull(),
  naira: integer("naira").notNull().default(0),
  nairaPerDollar: text("naira_per_dollar"),
  status: text("status").notNull().default("awaiting_signature"),
  bankName: text("bank_name").notNull(),
  accountName: text("account_name").notNull(),
  accountLast4: text("account_last4").notNull(),
  txHash: text("tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, t => [
  uniqueIndex("ambassador_cashout_one_active").on(t.payoutId).where(sql`${t.status} in ('awaiting_signature', 'sent', 'processing', 'paid')`),
  index("ambassador_cashouts_user").on(t.userId),
  check("ambassador_cashout_status", sql`${t.status} in ('awaiting_signature', 'sent', 'processing', 'paid', 'failed', 'refunded', 'expired')`),
]);
