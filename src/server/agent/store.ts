import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { messages, projectFiles, projects, usageEvents, versions, type FundingSource, type Version } from "@/server/db/schema";
import { withCurrentAddresses } from "@/server/deploy/addresses";
import { withCurrentWalletHelpers } from "@/server/agent/wallet-template";
import { recordPaidUsage } from "@/server/credits/holds";
import { MARKUP_BPS } from "@/config/model-pricing";
import { chargedMicro, costMicro } from "@/lib/pricing";

export async function loadFiles(db: Db, projectId: string): Promise<Record<string, string>> {
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  return Object.fromEntries(rows.map((r) => [r.path, r.content]));
}

/** Replace the project's files with `files` (deletes anything not in it). */
export async function saveFiles(db: Db, projectId: string, files: Record<string, string>): Promise<void> {
  await db.delete(projectFiles).where(eq(projectFiles.projectId, projectId));
  const rows = Object.entries(files).map(([path, content]) => ({ projectId, path, content }));
  if (rows.length) await db.insert(projectFiles).values(rows);
}

/** Save files and record a checkpoint. Returns the new version number. */
export async function checkpoint(
  db: Db,
  args: { projectId: string; files: Record<string, string>; summary: string; messageId?: string; revertedFrom?: number },
): Promise<number> {
  await saveFiles(db, args.projectId, args.files);
  const [latest] = await db
    .select({ n: versions.number })
    .from(versions)
    .where(eq(versions.projectId, args.projectId))
    .orderBy(desc(versions.number))
    .limit(1);
  const number = (latest?.n ?? 0) + 1;
  await db.insert(versions).values({
    projectId: args.projectId,
    number,
    messageId: args.messageId,
    summary: args.summary.slice(0, 500),
    files: args.files,
    revertedFrom: args.revertedFrom,
  });
  await db.update(projects).set({ currentVersion: number }).where(eq(projects.id, args.projectId));
  return number;
}

export async function listVersions(db: Db, projectId: string): Promise<Array<Pick<Version, "number" | "summary" | "createdAt" | "revertedFrom">>> {
  return db
    .select({ number: versions.number, summary: versions.summary, createdAt: versions.createdAt, revertedFrom: versions.revertedFrom })
    .from(versions)
    .where(eq(versions.projectId, projectId))
    .orderBy(desc(versions.number));
}

/**
 * Restore files from an older version as a new version (AI_AGENT.md §4). The chat
 * stays and logs it. Deployed contracts are never touched (M5 keeps them listed).
 */
export async function revertTo(db: Db, projectId: string, number: number): Promise<number | null> {
  const [v] = await db
    .select()
    .from(versions)
    .where(and(eq(versions.projectId, projectId), eq(versions.number, number)))
    .limit(1);
  if (!v) return null;
  // Contracts stay deployed after a revert, so addresses that fit the restored ABIs go back in (M5).
  const files = await withCurrentAddresses(db, projectId, v.files);
  const next = await checkpoint(db, { projectId, files, summary: `Reverted to v${number}`, revertedFrom: number });
  await db.insert(messages).values({
    projectId,
    role: "system",
    content: `Reverted to v${number}. Files are back to that version; your chat and any deployed contracts are unchanged.`,
    status: "done",
    meta: { kind: "revert", from: number, version: next },
  });
  return next;
}

/**
 * Move a project to another Celo network (mainnet or Sepolia). The project's chain decides where it deploys
 * and which network its app connects to, so the wallet layer's chain helper is re-rendered for it and the
 * addresses already deployed on that network go back in. Saved as a new version, so it can be reverted.
 * Returns the new version, or null when the project is already on that chain.
 */
export async function switchProjectChain(db: Db, projectId: string, chainId: number, label: string): Promise<number | null> {
  const [project] = await db.select({ chainId: projects.chainId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.chainId === chainId) return null;
  await db.update(projects).set({ chainId }).where(eq(projects.id, projectId));
  const files = await withCurrentAddresses(db, projectId, withCurrentWalletHelpers(await loadFiles(db, projectId), chainId));
  const next = await checkpoint(db, { projectId, files, summary: `Switched to ${label}` });
  await db.insert(messages).values({
    projectId,
    role: "system",
    content: `Switched this project to ${label}. Your app now connects to ${label}, and deploys go there.`,
    status: "done",
    meta: { kind: "chain_switch", chainId, version: next },
  });
  return next;
}

/**
 * Claim the project's turn slot for a turn run directly (tests, scripts). Background jobs don't
 * use this: their lease is the lock and the worker sets turnStartedAt from it (P18). No stale
 * expiry any more: a crashed job is resumed by the next worker, not timed out.
 */
export async function claimTurn(db: Db, projectId: string, ownerId: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(projects)
    .set({ turnStartedAt: now, status: "building" })
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId), isNull(projects.turnStartedAt)))
    .returning({ id: projects.id });
  return rows.length === 1;
}

export async function releaseTurn(db: Db, projectId: string, status: string): Promise<void> {
  await db.update(projects).set({ turnStartedAt: null, status, updatedAt: sql`now()` }).where(eq(projects.id, projectId));
}

/**
 * Record one model call's usage, priced with our table (D13). Idempotent on callId. `funding` is
 * required: a turn's calls take their job's (D48), and calls outside a turn decide it when they run.
 * A `paid` call is charged to the ledger in the same transaction, only if its row was really inserted
 * (D49). `jobId` says whose hold it comes out of. The cost is returned even for a duplicate: `inserted`
 * says whether this call recorded it.
 */
export async function recordUsage(
  db: Db,
  args: {
    userId: string;
    projectId: string;
    /** Null for calls outside a turn (e.g. describing an uploaded image). */
    messageId: string | null;
    callId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    funding: FundingSource;
    /** The paid job this call belongs to. */
    jobId?: string | null;
  },
): Promise<{ providerCostMicro: number; chargedMicro: number; inserted: boolean }> {
  const { jobId, ...row } = args;
  const provider = costMicro(args.model, args);
  const charged = chargedMicro(provider);
  const insertUsage = async (tx: Db) => {
    const rows = await tx
      .insert(usageEvents)
      .values({ ...row, providerCostMicro: provider, chargedMicro: charged, markupBps: MARKUP_BPS })
      .onConflictDoNothing({ target: usageEvents.callId })
      .returning({ id: usageEvents.id });
    return rows.length > 0;
  };
  const inserted = args.funding === "paid" ? await recordPaidUsage(db, { userId: args.userId, jobId, callId: args.callId, chargedMicro: charged, insertUsage }) : await insertUsage(db);
  return { providerCostMicro: provider, chargedMicro: charged, inserted };
}
