import "server-only";

import { and, eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { githubAccounts, githubRepos } from "@/server/db/github-schema";
import { projectFiles, projects } from "@/server/db/schema";
import { createCommit, createRef, createRepo, createTree, getBranchHead, getViewer, GithubApiError, moveBranch, setDefaultBranch } from "./api";
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
  /** A push that began a long time ago and never finished: the process was probably restarted. Safe to try again. */
  stale: boolean;
}

/** Longer than any push should take. */
const STALE_AFTER_MS = 5 * 60_000;

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
    stale: row.status === "syncing" && !!row.syncingSince && Date.now() - row.syncingSince.getTime() > STALE_AFTER_MS,
  };
}

/** The person's token, and the sealed value it came from, so a 401 can drop exactly that account row and no newer one. */
async function tokenFor(db: Db, userId: string): Promise<{ token: string; enc: string } | null> {
  const [account] = await db.select().from(githubAccounts).where(eq(githubAccounts.userId, userId)).limit(1);
  const token = account ? decryptToken(account.tokenEnc) : null;
  return account && token ? { token, enc: account.tokenEnc } : null;
}

/** GitHub refused a token: forget it, unless the person has connected again since (a newer token must survive an old request's 401). */
async function dropRefusedAccount(db: Db, userId: string, enc: string) {
  await db.delete(githubAccounts).where(and(eq(githubAccounts.userId, userId), eq(githubAccounts.tokenEnc, enc)));
}

/** One GitHub operation at a time per project, so an automatic push, a manual one and an unlink never interleave (D93). */
const locks = new Map<string, Promise<unknown>>();
function exclusive<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const next = (locks.get(projectId) ?? Promise.resolve()).catch(() => undefined).then(fn);
  locks.set(projectId, next);
  void next
    .finally(() => {
      if (locks.get(projectId) === next) locks.delete(projectId);
    })
    .catch(() => undefined);
  return next;
}

/**
 * Write sync state, but only onto the link this run started with. The link id changes whenever a project is unlinked
 * and linked again, so a push that outlives its link (in any process: the lock above is per process) can't write
 * its commit and version onto the next link, even one to a repository with the same name.
 */
async function setState(db: Db, link: GithubRepoRow, patch: Partial<typeof githubRepos.$inferInsert>) {
  await db.update(githubRepos).set(patch).where(and(eq(githubRepos.projectId, link.projectId), eq(githubRepos.linkId, link.linkId)));
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
export function syncProject(db: Db, projectId: string, opts: { overwrite?: boolean } = {}): Promise<GithubLink | null> {
  return exclusive(projectId, () => syncLocked(db, projectId, opts));
}

/** Stop syncing a project. Waits for a push in flight in this process; one in another process is cut off by the link id instead. The repository stays on GitHub. */
export function unlinkProject(db: Db, projectId: string): Promise<void> {
  return exclusive(projectId, async () => {
    await db.delete(githubRepos).where(eq(githubRepos.projectId, projectId));
  });
}

async function syncLocked(db: Db, projectId: string, opts: { overwrite?: boolean }): Promise<GithubLink | null> {
  const [link] = await db.select().from(githubRepos).where(eq(githubRepos.projectId, projectId)).limit(1);
  if (!link) return null;
  const credentials = await tokenFor(db, link.userId);
  if (!credentials) {
    await setState(db, link, { status: "error", error: "GitHub isn't connected. Connect GitHub again." });
    return toLink({ ...link, status: "error", error: "GitHub isn't connected. Connect GitHub again." });
  }
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;
  const { token, enc } = credentials;
  let stage: "read" | "write" | "move" = "read";
  let parent: string | null = null;
  try {
    const head = await getBranchHead(token, link.fullName, link.branch);
    if (!head) throw new GithubApiError(404, "branch not found");
    parent = head.commitSha;
    // A commit we made and moved the branch to, whose result we then failed to record, is ours.
    const known = link.pendingSha && head.commitSha === link.pendingSha ? link.pendingSha : link.lastCommitSha;
    if (known && head.commitSha !== known && !opts.overwrite) {
      const error = `${link.branch} on GitHub has changes GoodBuild didn't make. Sync is paused so nothing of yours is overwritten.`;
      await setState(db, link, { status: "diverged", error });
      return toLink({ ...link, status: "diverged", error });
    }
    if (link.status === "synced" && known === head.commitSha && link.lastVersion === project.currentVersion && !opts.overwrite) return toLink(link);

    await setState(db, link, { status: "syncing", error: null, syncingSince: new Date() });
    const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
    const files = Object.fromEntries(rows.map((r) => [r.path, r.content]));
    const { tree } = buildTree(files, project.name);
    stage = "write";
    const created = await createTree(token, link.fullName, tree);
    const message = `GoodBuild v${project.currentVersion}${opts.overwrite ? " (replaces changes made on GitHub)" : ""}`;
    const commit = await createCommit(token, link.fullName, { message, tree: created.sha, parent: head.commitSha });
    // Written before the branch moves, so if the move lands but recording it fails, the next sync still knows the commit is ours.
    await setState(db, link, { pendingSha: commit.sha });
    stage = "move";
    await moveBranch(token, link.fullName, link.branch, commit.sha);
    const done = { status: "synced" as const, error: null, lastCommitSha: commit.sha, pendingSha: null, syncingSince: null, lastVersion: project.currentVersion, syncedAt: new Date() };
    await setState(db, link, done);
    return toLink({ ...link, ...done });
  } catch (error) {
    // GitHub answers 409 or 422 when the branch can't be fast-forwarded. Only call it someone else's push
    // when the move was what failed and the branch has really moved on since we read it: a 422 from the
    // tree or commit (validation, abuse limits) is not a divergence, and "Replace" couldn't fix it.
    if (stage === "move" && error instanceof GithubApiError && (error.status === 409 || error.status === 422)) {
      const now = await getBranchHead(token, link.fullName, link.branch).catch(() => null);
      if (now && now.commitSha !== parent) {
        const message = `${link.branch} on GitHub changed while GoodBuild was syncing. Sync is paused so nothing of yours is overwritten.`;
        await setState(db, link, { status: "diverged", error: message });
        return toLink({ ...link, status: "diverged", error: message });
      }
    }
    const { message, lostAccess } = explain(error);
    if (lostAccess) await dropRefusedAccount(db, link.userId, enc);
    await setState(db, link, { status: "error", error: message });
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
export function createAndLink(db: Db, userId: string, projectId: string): Promise<GithubLink> {
  return exclusive(projectId, () => createLocked(db, userId, projectId));
}

async function createLocked(db: Db, userId: string, projectId: string): Promise<GithubLink> {
  const [existing] = await db.select().from(githubRepos).where(eq(githubRepos.projectId, projectId)).limit(1);
  if (existing) throw new LinkError("already_linked", "This app already has a GitHub repository.");
  const credentials = await tokenFor(db, userId);
  if (!credentials) throw new LinkError("not_connected", "Connect GitHub first.");
  const { token, enc } = credentials;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new LinkError("github_failed", "Project not found.");
  // The token may have been revoked on GitHub since it was saved.
  let viewer: Awaited<ReturnType<typeof getViewer>>;
  try {
    viewer = await getViewer(token);
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 401) {
      await dropRefusedAccount(db, userId, enc);
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
  // People can choose another default branch name for new repositories ("master"). The promise to them is
  // `main`, so make it, and make it the default, in this repository GoodBuild just created. If that fails,
  // keep syncing the default branch the repository has; the dialog shows the branch name it uses.
  let branch = repo.default_branch;
  if (head && branch !== "main") {
    try {
      await createRef(token, repo.full_name, "main", head.commitSha);
      await setDefaultBranch(token, repo.full_name, "main");
      branch = "main";
    } catch (error) {
      console.error("github: couldn't switch the new repository to main", error instanceof Error ? error.message : error);
    }
  }
  await db.insert(githubRepos).values({
    projectId,
    userId,
    fullName: repo.full_name,
    ownerId: String(viewer.id),
    branch,
    lastCommitSha: head?.commitSha ?? null,
    status: "syncing",
    syncingSince: new Date(),
  });
  const link = await syncLocked(db, projectId, {});
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

/**
 * Repositories of this person's apps that belong to a GitHub account other than `viewer`. Reconnecting as someone
 * else would leave them unable to sync. Compared by account id, which survives a rename; a link without one
 * (none are made now) falls back to the owner name.
 */
export async function linksOwnedByOthers(db: Db, userId: string, viewer: { id: number | string; login: string }): Promise<string[]> {
  const rows = await db.select({ fullName: githubRepos.fullName, ownerId: githubRepos.ownerId }).from(githubRepos).where(eq(githubRepos.userId, userId));
  return rows
    .filter((r) => (r.ownerId ? r.ownerId !== String(viewer.id) : r.fullName.split("/")[0]?.toLowerCase() !== viewer.login.toLowerCase()))
    .map((r) => r.fullName);
}
