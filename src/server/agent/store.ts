import "server-only";

import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { messages, projectFiles, projects, usageEvents, versions, type Version } from "@/server/db/schema";
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
  const next = await checkpoint(db, { projectId, files: v.files, summary: `Reverted to v${number}`, revertedFrom: number });
  await db.insert(messages).values({
    projectId,
    role: "system",
    content: `Reverted to v${number}. Files are back to that version; your chat and any deployed contracts are unchanged.`,
    status: "done",
    meta: { kind: "revert", from: number, version: next },
  });
  return next;
}

/** Claim the project's single turn slot. Stale locks (crashed turns) expire after 10 minutes. */
export async function claimTurn(db: Db, projectId: string, ownerId: string, now = new Date()): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - 10 * 60_000);
  const rows = await db
    .update(projects)
    .set({ turnStartedAt: now, status: "building" })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.ownerId, ownerId),
        or(isNull(projects.turnStartedAt), lt(projects.turnStartedAt, staleBefore)),
      ),
    )
    .returning({ id: projects.id });
  return rows.length === 1;
}

export async function releaseTurn(db: Db, projectId: string, status: string): Promise<void> {
  await db.update(projects).set({ turnStartedAt: null, status, updatedAt: sql`now()` }).where(eq(projects.id, projectId));
}

/** Record one model call's usage, priced with our table (D13). Idempotent on callId. */
export async function recordUsage(
  db: Db,
  args: {
    userId: string;
    projectId: string;
    messageId: string;
    callId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  },
): Promise<{ providerCostMicro: number; chargedMicro: number }> {
  const provider = costMicro(args.model, args);
  const charged = chargedMicro(provider);
  await db
    .insert(usageEvents)
    .values({ ...args, providerCostMicro: provider, chargedMicro: charged, markupBps: MARKUP_BPS })
    .onConflictDoNothing({ target: usageEvents.callId });
  return { providerCostMicro: provider, chargedMicro: charged };
}
