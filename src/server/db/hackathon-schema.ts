import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

/** Contact and onboarding progress are saved before verification or a credit claim. */
export const hackathonParticipants = pgTable("hackathon_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  hackathon: text("hackathon").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  flowstate: text("flowstate").notNull().default("pending"),
  flowstateClaimAt: timestamp("flowstate_claim_at", { withTimezone: true }),
  flowstateTxHash: text("flowstate_tx_hash"),
  flowstateVotedAt: timestamp("flowstate_voted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("hackathon_participants_user_unique").on(t.hackathon, t.userId)]);

export const hackathonEntries = pgTable("hackathon_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  hackathon: text("hackathon").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  alias: text("alias").notNull(),
  title: text("title").notNull(),
  pitch: text("pitch").notNull(),
  liveUrl: text("live_url").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("hackathon_entries_user_unique").on(t.hackathon, t.userId)]);

export const hackathonApprovals = pgTable("hackathon_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => hackathonEntries.id, { onDelete: "cascade" }),
  goodidRoot: text("goodid_root").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("hackathon_approvals_human_unique").on(t.entryId, t.goodidRoot)]);

/**
 * FlowState vote state per account (D126), for everyone who votes through GoodBuild's dialog, with or
 * without an email or a hackathon signup. Holds the eligibility-claim rate limit and the confirmed vote.
 * A hackathon participant row, when there is one, gets the same vote copied onto it for the CSV and claims.
 */
export const flowstateVoters = pgTable("flowstate_voters", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  claimAt: timestamp("claim_at", { withTimezone: true }),
  txHash: text("tx_hash"),
  votedAt: timestamp("voted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per published project per day, taken by the worker just after midnight West Africa Time
 * (D134). Comparing today's rank with the latest earlier snapshot gives the up arrows on the
 * leaderboard. `day` is the WAT date, YYYY-MM-DD.
 */
export const hackathonRankSnapshots = pgTable(
  "hackathon_rank_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hackathon: text("hackathon").notNull(),
    day: text("day").notNull(),
    entryId: uuid("entry_id").notNull().references(() => hackathonEntries.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    approvals: integer("approvals").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("hackathon_rank_snapshots_day_entry").on(t.hackathon, t.day, t.entryId)],
);

