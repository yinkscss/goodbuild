import { pgTable, uuid, text, timestamp, integer, uniqueIndex, check } from "drizzle-orm/pg-core";
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
