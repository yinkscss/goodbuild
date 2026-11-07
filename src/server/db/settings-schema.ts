import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Switches the owner can change while the app runs (D50). One row per switch. A missing row means
 * the switch's default, which for the mainnet switch is "off".
 */
export const appSettings = pgTable(
  "app_settings",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Lowercased admin wallet that last changed it, or null when it was set by hand in SQL. */
    updatedBy: text("updated_by"),
  },
  (t) => [check("app_settings_key_known", sql`${t.key} in ('mainnet_access')`)],
);
