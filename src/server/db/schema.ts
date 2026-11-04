import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Stage 1 schema (D8: project code and chat in our DB; app data on-chain).
 * Credits tables (CREDITS.md §3) arrive in M6, deployments in M5.
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Lowercased 0x address. The user is keyed by wallet (AUTH.md Flow 4). */
  wallet: text("wallet").notNull().unique(),
  /** D10 attestations, captured on first sign-in. */
  ageOk: boolean("age_ok").notNull().default(false),
  countryOk: boolean("country_ok").notNull().default(false),
  attestedAt: timestamp("attested_at", { withTimezone: true }),
  /** "embedded" (email login) or "external". */
  walletKind: text("wallet_kind").notNull().default("external"),
  /** GoodID root, filled when face verification lands (CREDITS.md §5). */
  goodidRoot: text("goodid_root"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Server-side session rows so sign-out and rotation can revoke a cookie. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** The session this one replaced on rotation. */
    rotatedFrom: uuid("rotated_from"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    templateId: text("template_id"),
    /** Target chain for deploys (11142220 Celo Sepolia by default). */
    chainId: integer("chain_id").notNull(),
    /** draft | building | ready | needs_fix | deployed */
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [index("projects_owner_idx").on(t.ownerId, t.updatedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** user | assistant | system */
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** queued | streaming | done | error. A user prompt starts queued until the agent (M4) picks it up. */
    status: text("status").notNull().default("done"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_project_idx").on(t.projectId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Message = typeof messages.$inferSelect;
