import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Stage 1 schema (D8: project code and chat in our DB; app data on-chain).
 * The credits ledger is at the end of this file (D45), deployments are in deploy-schema.ts.
 */

/** Who pays for a model call or a build (MAINNET_PLAN.md section 5). Older rows are all `free`. */
export const FUNDING_SOURCES = ["free", "paid", "exempt", "platform"] as const;
export type FundingSource = (typeof FUNDING_SOURCES)[number];

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

/**
 * One row per model call, priced with GoodBuild's table (D13). A money record: the free total (D29)
 * adds these up and M3 debits from them, so deleting a user is refused rather than losing them (D45).
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
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
    funding: text("funding").$type<FundingSource>().notNull().default("free"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_user_idx").on(t.userId, t.createdAt), check("usage_events_funding_check", sql`${t.funding} IN ('free', 'paid', 'exempt', 'platform')`)],
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
 * Mostly a work queue, so jobs still go when their project or user is deleted. A `paid` job is a
 * money record: a trigger refuses to delete it, and that refuses the whole delete (D45).
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
    /** Who funds this build. M2 sets it; until then every job takes the default. */
    funding: text("funding").$type<FundingSource>().notNull().default("free"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("turn_jobs_status_idx").on(t.status, t.createdAt),
    index("turn_jobs_project_idx").on(t.projectId, t.createdAt),
    uniqueIndex("turn_jobs_one_running_idx").on(t.projectId).where(sql`status = 'running'`),
    uniqueIndex("turn_jobs_user_message_idx").on(t.userMessageId),
    check("turn_jobs_funding_check", sql`${t.funding} IN ('free', 'paid', 'exempt', 'platform')`),
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

/**
 * What a ledger entry records. Free AI never appears here: it's counted from usage_events (D28 to D30).
 * deposit: credit bought (+). usage: AI spent (-). refund: credit taken back with money returned (-).
 * adjust: a correction either way, such as a chargeback or a write-off.
 */
export const LEDGER_KINDS = ["deposit", "usage", "refund", "adjust"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/**
 * The credits ledger (D45, CREDITS.md section 3). Append-only: triggers in migration 0010 refuse
 * UPDATE, DELETE and TRUNCATE, and only `postLedgerEntry` should write here. All amounts are integer
 * micro-USD. There's no link to projects, so deleting a project can't touch a money record.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Posting order. Entries of one user are posted under a lock, so this is their true order. */
    seq: bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind").$type<LedgerKind>().notNull(),
    amountMicro: bigint("amount_micro", { mode: "number" }).notNull(),
    /** The user's balance straight after this entry. */
    balanceAfterMicro: bigint("balance_after_micro", { mode: "number" }).notNull(),
    /** Set when the caller allowed this entry to take the balance below zero (the rule is in ledger.ts). */
    allowNegative: boolean("allow_negative").notNull().default(false),
    /** What the entry is about, such as "topup" and a reference. Plain text, never a foreign key. */
    refType: text("ref_type"),
    refId: text("ref_id"),
    /** Unique, so a replay can't post twice. For example `topup:<reference>`. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_user_idx").on(t.userId, t.seq),
    check("ledger_entries_kind_sign_check", sql`(${t.kind} = 'deposit' AND ${t.amountMicro} > 0) OR (${t.kind} IN ('usage', 'refund') AND ${t.amountMicro} < 0) OR (${t.kind} = 'adjust' AND ${t.amountMicro} <> 0)`),
    check("ledger_entries_key_check", sql`length(${t.idempotencyKey}) > 0`),
    check("ledger_entries_negative_check", sql`${t.balanceAfterMicro} >= 0 OR ${t.amountMicro} > 0 OR ${t.allowNegative}`),
    check("ledger_entries_allow_negative_check", sql`NOT ${t.allowNegative} OR ${t.kind} IN ('usage', 'adjust')`),
  ],
);

/**
 * The sum of a user's ledger entries, kept for fast reads and locked while posting. A deferred
 * trigger refuses to commit any change that makes it differ from the entries. It may be negative,
 * after a chargeback for example, so there's deliberately no check that it's at least zero.
 */
export const balances = pgTable("balances", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "restrict" }),
  balanceMicro: bigint("balance_micro", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type TurnJob = typeof turnJobs.$inferSelect;

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Version = typeof versions.$inferSelect;
export type ProjectAsset = typeof projectAssets.$inferSelect;
