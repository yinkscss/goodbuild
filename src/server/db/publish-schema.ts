import { sql } from "drizzle-orm";
import { boolean, customType, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { projects } from "./schema";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => new Uint8Array(v),
});

/** A project's public app. One per project; republishing replaces its files. */
export const publications = pgTable(
  "publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The subdomain. Stays with the project after unpublishing, so nobody else can take over its address. */
    slug: text("slug").notNull(),
    /** The project version these files were built from. */
    versionNumber: integer("version_number").notNull(),
    /** The app's contracts weren't all deployed for this code, so the page shows a demo notice. */
    hasUndeployedContracts: boolean("has_undeployed_contracts").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    unpublishedAt: timestamp("unpublished_at", { withTimezone: true }),
    /** Admin takedown. The owner can't publish again while this is set. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    /** Public id the built app sends with data requests. Not a secret and never grants access (docs/APP_DATA.md). */
    clientId: text("client_id")
      .notNull()
      .default(sql`'gbc_' || replace(gen_random_uuid()::text, '-', '')`),
    /** Access rule per collection, snapshotted from the app's rules file when it is published. */
    dataRules: jsonb("data_rules").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex("publications_project_idx").on(t.projectId), uniqueIndex("publications_slug_idx").on(t.slug), uniqueIndex("publications_client_idx").on(t.clientId)],
);

/** The immutable built snapshot: later builds or deleted assets can't change a live app. */
export const publicationFiles = pgTable(
  "publication_files",
  {
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    mime: text("mime").notNull(),
    bytes: bytea("bytes").notNull(),
  },
  (t) => [primaryKey({ columns: [t.publicationId, t.path] })],
);

export type Publication = typeof publications.$inferSelect;
