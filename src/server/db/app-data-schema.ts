import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { RecordGrant } from "@/lib/app-data";

import { projects } from "./schema";

/**
 * Data that published apps store for their visitors (docs/APP_DATA.md). `project_id` is the tenant
 * and `owner_wallet` is the visitor. The owner is part of the key and only ever comes from the
 * session, so a write can't reach another wallet's record.
 */
export const appDataRecords = pgTable(
  "app_data_records",
  {
    /** Only for paging: newest first, stable while rows are added. */
    id: bigserial("id", { mode: "number" }).notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    /** Who saved it: a lowercase wallet address, or "anon:<id>" for a visitor who didn't sign in (D34). */
    ownerWallet: text("owner_wallet").notNull(),
    key: text("key").notNull(),
    /** JSON text. Plain text so nothing a visitor sends can make Postgres reject or reshape it. */
    value: text("value").notNull(),
    /**
     * Set from the collection's rule when the record is written, and checked on every read. Making
     * a collection public later doesn't expose what visitors wrote while it was private.
     */
    isPublic: boolean("is_public").notNull().default(false),
    /**
     * Who could read the record when it was saved (D34). Reads use the stricter of this and the rule
     * now, so loosening a rule never exposes what was saved under a tighter one. Null on records
     * saved before D34: those follow is_public, and otherwise only their writer reads them.
     */
    access: jsonb("access").$type<RecordGrant>(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.collection, t.ownerWallet, t.key] }),
    index("app_data_records_list_idx").on(t.projectId, t.collection, t.id),
    index("app_data_records_owner_idx").on(t.projectId, t.ownerWallet),
  ],
);

/** Running totals for quotas, updated in the same transaction as the record. Wallet "*" is the whole project. */
export const appDataUsage = pgTable(
  "app_data_usage",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    wallet: text("wallet").notNull(),
    rows: integer("rows").notNull().default(0),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.wallet] })],
);

/** Single-use sign-in nonces, each good for one app. */
export const appDataNonces = pgTable(
  "app_data_nonces",
  {
    nonce: text("nonce").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("app_data_nonces_expiry_idx").on(t.expiresAt)],
);

/** A visitor's session in one app. Only the token's hash is stored. */
export const appDataSessions = pgTable(
  "app_data_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    wallet: text("wallet").notNull(),
    /** The address of a visitor signed in by email, shown only to them (D35). */
    email: text("email"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("app_data_sessions_token_idx").on(t.tokenHash), index("app_data_sessions_wallet_idx").on(t.projectId, t.wallet), index("app_data_sessions_expiry_idx").on(t.expiresAt)],
);

export type AppDataRecord = typeof appDataRecords.$inferSelect;

/**
 * Email sign-in for app visitors (D35). One row per app and address, so a visitor keeps the same
 * id in that app and a different one in every other. The id is random, never derived from a secret
 * that might be rotated, and the address never appears in records anyone else can read.
 */
export const appDataEmailIdentities = pgTable(
  "app_data_email_identities",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Trimmed and lowercased. */
    email: text("email").notNull(),
    /** "email:<uuid>": what records and sessions name as the writer. */
    subject: text("subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.email] }), uniqueIndex("app_data_email_identities_subject_idx").on(t.subject)],
);

/** One-time sign-in codes. Only an HMAC of the code is stored. */
export const appDataEmailCodes = pgTable(
  "app_data_email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    /** A hash of the requesting IP, for the daily cap per IP. */
    ipHash: text("ip_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("app_data_email_codes_lookup_idx").on(t.projectId, t.email, t.createdAt), index("app_data_email_codes_created_idx").on(t.createdAt), index("app_data_email_codes_ip_idx").on(t.ipHash, t.createdAt)],
);
