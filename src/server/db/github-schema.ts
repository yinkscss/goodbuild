import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { projects, users } from "./schema";

/**
 * A person's connected GitHub account (D93). The access token is encrypted at rest
 * (src/server/github/crypto.ts) and never sent to the browser.
 */
export const githubAccounts = pgTable("github_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  githubId: text("github_id").notNull(),
  login: text("login").notNull(),
  /** AES-256-GCM, "v1.<iv>.<tag>.<ciphertext>" in base64url. */
  tokenEnc: text("token_enc").notNull(),
  scope: text("scope").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const GITHUB_SYNC_STATUSES = ["synced", "syncing", "diverged", "error"] as const;
export type GithubSyncStatus = (typeof GITHUB_SYNC_STATUSES)[number];

/** The repository a project syncs to. One per project. Unlinking deletes the row and leaves the repository alone. */
export const githubRepos = pgTable("github_repos", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** The account that owns the token used to push. */
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Names this link, not the project or the repository: unlinking and linking again makes a new one, so a push that outlives its link can't write onto the next (D93). */
  linkId: uuid("link_id").notNull().defaultRandom(),
  /** "owner/name". */
  fullName: text("full_name").notNull(),
  /** The GitHub account id (not the name, which people can change) that owns the repository. */
  ownerId: text("owner_id"),
  branch: text("branch").notNull().default("main"),
  /** Head commit GoodBuild last wrote. If the branch is anywhere else, someone else committed (D93). */
  lastCommitSha: text("last_commit_sha"),
  /** The project version that commit holds. */
  lastVersion: integer("last_version"),
  /** A commit GoodBuild made on the branch but may not have recorded yet; if the branch head is this, it is ours, not someone else's. */
  pendingSha: text("pending_sha"),
  /** When the current push began, so a push that never finished (a restart) can be told from one still running. */
  syncingSince: timestamp("syncing_since", { withTimezone: true }),
  status: text("status", { enum: GITHUB_SYNC_STATUSES }).notNull().default("syncing"),
  error: text("error"),
  autoSync: boolean("auto_sync").notNull().default(true),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
