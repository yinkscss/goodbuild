import { check, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * GoodBuild's own accounts with its AI providers (D177). One row per provider, written by every worker, so a pause
 * set by one is seen by all. While `pausedAt` is set, new builds wait in the queue instead of starting against an
 * empty account; a probe or the owner clears it and they start in order. The timestamps claim each periodic check,
 * so only one process runs it at a time, and record alerts so each is sent once.
 */
export const providerStatus = pgTable(
  "provider_status",
  {
    provider: text("provider").primaryKey(),
    /** Set while the account is empty: builds are held. */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    /** Why it paused, for the owner (the provider's refusal, never a prompt). */
    reason: text("reason"),
    /** When the last pause ended: held builds aren't counted as stuck until they've had time to run (checkHolds). */
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
    lastProbeAt: timestamp("last_probe_at", { withTimezone: true }),
    lastBalanceCheckAt: timestamp("last_balance_check_at", { withTimezone: true }),
    /** The last balance read from the provider, in `balanceCurrency`. */
    lastBalance: numeric("last_balance"),
    balanceCurrency: text("balance_currency"),
    /** The low-balance alert was sent and hasn't re-armed yet (the balance hasn't recovered). */
    lowAlertSentAt: timestamp("low_alert_sent_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("provider_status_known", sql`${t.provider} in ('deepseek', 'anthropic')`)],
);

export type ProviderStatus = typeof providerStatus.$inferSelect;
