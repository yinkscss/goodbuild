import "server-only";

import { eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { githubAccounts, githubRepos } from "@/server/db/github-schema";
import { projectFiles, projects } from "@/server/db/schema";
import { createCommit, createRepo, createTree, getBranchHead, getViewer, GithubApiError, moveBranch } from "./api";
import { decryptToken } from "./crypto";
import { buildTree, repoName } from "./tree";

export interface GithubLink {
  fullName: string;
  url: string;
  branch: string;
  status: "synced" | "syncing" | "diverged" | "error";
  error: string | null;
  lastVersion: number | null;
  syncedAt: string | null;
  autoSync: boolean;
}

export type GithubRepoRow = typeof githubRepos.$inferSelect;

export function toLink(row: GithubRepoRow): GithubLink {
  return {
    fullName: row.fullName,
    url: `https://github.com/${row.fullName}`,
    branch: row.branch,
    status: row.status,
    error: row.error,
    lastVersion: row.lastVersion,
    syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
    autoSync: row.autoSync,
  };
}

async function tokenFor(db: Db, userId: string): Promise<string | null> {
  const [account] = await db.select().from(githubAccounts).where(eq(githubAccounts.userId, userId)).limit(1);
  return account ? decryptToken(account.tokenEnc) : null;
}

async function setState(db: Db, projectId: string, patch: Partial<typeof githubRepos.$inferInsert>) {
  await db.update(githubRepos).set(patch).where(eq(githubRepos.projectId, projectId));
}

/** What a person should read when GitHub refuses. */
function explain(error: unknown): { message: string; lostAccess: boolean } {
  if (error instanceof GithubApiError) {
    if (error.status === 401) return { message: "GitHub no longer accepts GoodBuild's access. Connect GitHub again.", lostAccess: true };
    if (error.status === 403) return { message: `GitHub refused (${error.message}). Check that GoodBuild still has access, then try again.`, lostAccess: false };
    if (error.status === 404) return { message: "The repository isn't there any more, or GoodBuild can't see it.", lostAccess: false };
    return { message: `GitHub said: ${error.message}`, lostAccess: false };
  }
  return { message: "Couldn't reach GitHub. We'll try again after your next change.", lostAccess: false };
}

/**
 * Push the project's current files to the linked repository as one new commit on top of the branch (D93).
 * One way, and never a force push: if the branch has commits GoodBuild didn't write, nothing is pushed and
 * the link is marked `diverged` until the person chooses `overwrite`, which still adds a commit on top, so
 * their history stays on GitHub.
 */
export async function syncProject(db: Db, projectId: string, opts: { overwrite?: boolean } = {}): Promise<GithubLink | null> {
  const [link] = await db.select().from(githubRepos).where(eq(githubRepos.projectId, projectId)).limit(1);
  if (!link) return null;
  const token = await tokenFor(db, link.userId);
  if (!token) {
    await setState(db, projectId, { status: "error", error: "GitHub isn't connected. Connect GitHub again." });
    return toLink({ ...link, status: "error", error: "GitHub isn't connected. Connect GitHub again." });
  }
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;
  try {
    const head = await getBranchHead(token, link.fullName, link.branch);
    if (!head) throw new GithubApiError(404, "branch not found");
    if (link.lastCommitSha && head.commitSha !== link.lastCommitSha && !opts.overwrite) {
      const error = `${link.branch} on GitHub has changes GoodBuild didn't make. Sync is paused so nothing of yours is overwritten.`;
      await setState(db, projectId, { status: "diverged", error });
      return toLink({ ...link, status: "diverged", error });
    }
    if (link.status === "synced" && link.lastCommitSha === head.commitSha && link.lastVersion === project.currentVersion && !opts.overwrite) return toLink(link);

    await setState(db, projectId, { status: "syncing", error: null });
    const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
    const files = Object.fromEntries(rows.map((r) => [r.path, r.content]));
    const { tree } = buildTree(files, project.name);
    const created = await createTree(token, link.fullName, tree);
    const message = `GoodBuild v${project.currentVersion}${opts.overwrite ? " (replaces changes made on GitHub)" : ""}`;
    const commit = await createCommit(token, link.fullName, { message, tree: created.sha, parent: head.commitSha });
    await moveBranch(token, link.fullName, link.branch, commit.sha);
    const done = { status: "synced" as const, error: null, lastCommitSha: commit.sha, lastVersion: project.currentVersion, syncedAt: new Date() };
    await setState(db, projectId, done);
    return toLink({ ...link, ...done });
  } catch (error) {
    // A 422 from the branch move means it changed between our read and our write: someone else pushed.
    if (error instanceof GithubApiError && error.status === 422) {
      const message = `${link.branch} on GitHub changed while GoodBuild was syncing. Sync is paused so nothing of yours is overwritten.`;
      await setState(db, projectId, { status: "diverged", error: message });
      return toLink({ ...link, status: "diverged", error: message });
    }
    const { message, lostAccess } = explain(error);
    if (lostAccess) await db.delete(githubAccounts).where(eq(githubAccounts.userId, link.userId));
    await setState(db, projectId, { status: "error", error: message });
    return toLink({ ...link, status: "error", error: message });
  }
}

export class LinkError extends Error {
  constructor(
    readonly code: "not_connected" | "already_linked" | "github_failed",
    message: string,
  ) {
    super(message);
  }
}

/** Create a public repository for the project in the person's GitHub, link it and push the first version. */
export async function createAndLink(db: Db, userId: string, projectId: string): Promise<GithubLink> {
  const [existing] = await db.select().from(githubRepos).where(eq(githubRepos.projectId, projectId)).limit(1);
  if (existing) throw new LinkError("already_linked", "This app already has a GitHub repository.");
  const token = await tokenFor(db, userId);
  if (!token) throw new LinkError("not_connected", "Connect GitHub first.");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new LinkError("github_failed", "Project not found.");
  // The token may have been revoked on GitHub since it was saved.
  try {
    await getViewer(token);
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 401) {
      await db.delete(githubAccounts).where(eq(githubAccounts.userId, userId));
      throw new LinkError("not_connected", "GitHub no longer accepts GoodBuild's access. Connect GitHub again.");
    }
    throw new LinkError("github_failed", explain(error).message);
  }

  let repo: Awaited<ReturnType<typeof createRepo>> | null = null;
  for (let attempt = 0; attempt < 6 && !repo; attempt++) {
    const name = attempt < 5 ? repoName(project.name, attempt) : `${repoName(project.name)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      repo = await createRepo(token, { name, description: `${project.name}, built with GoodBuild` });
    } catch (error) {
      // 422 is "name already exists on this account" (or a name GitHub won't take): try the next one.
      if (error instanceof GithubApiError && error.status === 422) continue;
      throw new LinkError("github_failed", explain(error).message);
    }
  }
  if (!repo) throw new LinkError("github_failed", "GitHub wouldn't take any repository name for this app.");

  const head = await getBranchHead(token, repo.full_name, repo.default_branch).catch(() => null);
  await db.insert(githubRepos).values({
    projectId,
    userId,
    fullName: repo.full_name,
    branch: repo.default_branch,
    lastCommitSha: head?.commitSha ?? null,
    status: "syncing",
  });
  const link = await syncProject(db, projectId);
  const [row] = await db.select().from(githubRepos).where(eq(githubRepos.projectId, projectId)).limit(1);
  return link ?? toLink(row!);
}

const running = new Map<string, Promise<void>>();
const again = new Set<string>();

/**
 * Called after a new version is saved. Never throws and never waits: a build must not fail or slow down
 * because GitHub is down. Runs of one project are serialized, and changes that arrive during a run cause
 * one more run, which reads the latest files.
 */
export function requestGithubSync(db: Db, projectId: string): void {
  if (running.has(projectId)) {
    again.add(projectId);
    return;
  }
  const run = (async () => {
    try {
      const [link] = await db.select({ autoSync: githubRepos.autoSync, status: githubRepos.status }).from(githubRepos).where(eq(githubRepos.projectId, projectId)).limit(1);
      if (!link?.autoSync || link.status === "diverged") return;
      await syncProject(db, projectId);
    } catch (error) {
      console.error("github sync failed", error instanceof Error ? error.message : error);
    } finally {
      running.delete(projectId);
      if (again.delete(projectId)) requestGithubSync(db, projectId);
    }
  })();
  running.set(projectId, run);
}
