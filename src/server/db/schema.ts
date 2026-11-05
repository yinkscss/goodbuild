import { sql } from "drizzle-orm";
import { bigint, boolean, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
    /** Rolling conversation memory for the agent (src/server/agent/memory.ts). */
    memory: jsonb("memory").$type<{ summary: string; decisions: string[]; upTo: number }>(),
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

/** Raw bytes (Postgres bytea). PGlite and postgres-js both return a Uint8Array/Buffer. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => new Uint8Array(v),
});

/**
 * Files the user uploads for a project (logos, images, design references). Bytes live here in
 * development; `AssetStore` (src/server/agent/assets.ts) is the seam for object storage later.
 * Never part of the model's file map: apps reference them by `/assets/<name>`.
 */
export const projectAssets = pgTable(
  "project_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** File name inside /assets/, e.g. logo.png. Unique per project. */
    name: text("name").notNull(),
    /** logo | image | reference (a design reference is described for the agent, not shipped). */
    kind: text("kind").notNull(),
    mime: text("mime").notNull(),
    bytes: bytea("bytes").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** Dominant colours, hex, most dominant first. */
    palette: jsonb("palette").$type<string[]>().notNull().default([]),
    /** Short description for the manifest; for references, a layout spec from the vision model. */
    description: text("description").notNull().default(""),
    /** Message id of the first turn that saw the image itself (null: not yet attached). */
    attachedAt: uuid("attached_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("project_assets_name_idx").on(t.projectId, t.name)],
);

/**
 * Background turn jobs (P18). A prompt becomes a queued job; a worker claims it with a lease
 * (FOR UPDATE SKIP LOCKED), runs the agent turn and commits the result. The lease is the only
 * turn lock: at most one running job per project (partial unique index).
 */
export const turnJobs = pgTable(
  "turn_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    prompt: text("prompt").notNull(),
    userMessageId: uuid("user_message_id").notNull(),
    /** Set once the turn has created its assistant message (reused on resume). */
    assistantMessageId: uuid("assistant_message_id"),
    /** queued | running | done | error | stopped | cancelled */
    status: text("status").notNull().default("queued"),
    /** How many times a worker has claimed it (1 = first run; more = resumed after a crash). */
    attempt: integer("attempt").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    stopRequested: boolean("stop_requested").notNull().default(false),
    /** Saved once after setup: what a resumed run needs instead of redoing setup (runner.ts TurnSetup). */
    setup: jsonb("setup").$type<Record<string, unknown>>(),
    /** Next turn_events seq. */
    nextSeq: integer("next_seq").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("turn_jobs_status_idx").on(t.status, t.createdAt),
    index("turn_jobs_project_idx").on(t.projectId, t.createdAt),
    uniqueIndex("turn_jobs_one_running_idx").on(t.projectId).where(sql`status = 'running'`),
    uniqueIndex("turn_jobs_user_message_idx").on(t.userMessageId),
  ],
);

/**
 * Each completed model response of a job, committed with its usage rows in one transaction.
 * A resumed run replays these instead of calling the model again (no repeated tool calls, no
 * double billing).
 */
export const turnJobCalls = pgTable(
  "turn_job_calls",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => turnJobs.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.idx] })],
);

/** The live event stream of a job, numbered, for SSE replay; deleted a while after the job ends. */
export const turnEvents = pgTable(
  "turn_events",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => turnJobs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    event: jsonb("event").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.seq] })],
);

export type TurnJob = typeof turnJobs.$inferSelect;

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Version = typeof versions.$inferSelect;
export type ProjectAsset = typeof projectAssets.$inferSelect;
