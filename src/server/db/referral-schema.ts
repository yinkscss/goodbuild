import { bigint, index, pgTable, timestamp, uuid, text, uniqueIndex } from "drizzle-orm/pg-core";

import { users } from "./schema";

/**
 * Invites (D155): one row per person who opened a friend's link and signed in. Rows only move forward:
 * created on sign-in, `verified_at` when the chain shows a GoodDollar root, `voted_at` when the vote
 * for GoodBuildIt is confirmed, `settled_at` when the bonus is paid (both sides together, or neither).
 *
 * `referee_user_id` is unique, so a person is invited once. `referee_root` is unique too, so a second
 * account behind the same GoodDollar identity can't be invited (and paid) again.
 */
export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerUserId: uuid("referrer_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    refereeUserId: uuid("referee_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    /** Lowercased GoodDollar root of the invited person, set once they verify. */
    refereeRoot: text("referee_root"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    votedAt: timestamp("voted_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    refereeEntryId: uuid("referee_entry_id"),
    refereeMicro: bigint("referee_micro", { mode: "number" }).notNull().default(0),
    referrerEntryId: uuid("referrer_entry_id"),
    referrerMicro: bigint("referrer_micro", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    uniqueIndex("referrals_referee_user").on(t.refereeUserId),
    uniqueIndex("referrals_referee_root").on(t.refereeRoot),
    index("referrals_referrer").on(t.referrerUserId),
  ],
);

export type Referral = typeof referrals.$inferSelect;
