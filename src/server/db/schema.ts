import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
    /** Latest checkpoint number (0 = template only). */
    currentVersion: integer("current_version").notNull().default(0),
    /** Set while an agent turn runs; one turn per project at a time. */
    turnStartedAt: timestamp("turn_started_at", { withTimezone: true }),
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

/** Current working files of a project (generated app + contracts). */
export const projectFiles = pgTable(
  "project_files",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.path] })],
);

/** A checkpoint per prompt (AI_AGENT.md §4): a full snapshot of the files. */
export const versions = pgTable(
  "versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    /** The assistant message that produced it. */
    messageId: uuid("message_id"),
    summary: text("summary").notNull(),
    files: jsonb("files").$type<Record<string, string>>().notNull(),
    /** Set when this version restores an older one. */
    revertedFrom: integer("reverted_from"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("versions_project_number_idx").on(t.projectId, t.number)],
);

/** One row per model call, priced with GoodBuild's table (D13). M6 debits from these. */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    messageId: uuid("message_id"),
    /** Provider call id; unique so a replay can't double count. */
    callId: text("call_id").notNull().unique(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    providerCostMicro: bigint("provider_cost_micro", { mode: "number" }).notNull(),
    chargedMicro: bigint("charged_micro", { mode: "number" }).notNull(),
    markupBps: integer("markup_bps").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_user_idx").on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Version = typeof versions.$inferSelect;
