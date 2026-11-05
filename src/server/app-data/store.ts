import "server-only";

import { randomBytes, randomUUID, createHash } from "node:crypto";

import { and, desc, eq, gt, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";

import { accessFor } from "@/lib/app-data";
import type { Db } from "@/server/db/client";
import { appDataNonces, appDataRecords, appDataSessions, appDataUsage } from "@/server/db/app-data-schema";
import { publications } from "@/server/db/publish-schema";
import type { AppDataLimits } from "./limits";

/** Every function here takes the project from the caller, which derives it from the Host. Never from input. */
export interface LiveApp {
  projectId: string;
  clientId: string;
  rules: Record<string, unknown>;
}

const PROJECT_TOTAL = "*";

export class AppDataError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** The app on this slug, only while it is live. Keyed to the project, so a later owner of the slug starts empty. */
export async function liveApp(db: Db, slug: string): Promise<LiveApp | null> {
  const [row] = await db
    .select({ projectId: publications.projectId, clientId: publications.clientId, rules: publications.dataRules, unpublishedAt: publications.unpublishedAt, disabledAt: publications.disabledAt })
    .from(publications)
    .where(eq(publications.slug, slug))
    .limit(1);
  if (!row || row.unpublishedAt || row.disabledAt) return null;
  return { projectId: row.projectId, clientId: row.clientId, rules: row.rules };
}

// ---------------------------------------------------------------------------
// Sign-in

const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createNonce(db: Db, projectId: string, now = new Date()): Promise<{ nonce: string; expiresAt: Date }> {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  await db.insert(appDataNonces).values({ nonce, projectId, expiresAt });
  return { nonce, expiresAt };
}

/** The nonce, if it is this app's, unused and unexpired. Checked before any signature work. */
export async function usableNonce(db: Db, projectId: string, nonce: string, now = new Date()): Promise<string | null> {
  const [row] = await db
    .select({ nonce: appDataNonces.nonce })
    .from(appDataNonces)
    .where(and(eq(appDataNonces.nonce, nonce), eq(appDataNonces.projectId, projectId), isNull(appDataNonces.usedAt), gt(appDataNonces.expiresAt, now)))
    .limit(1);
  return row?.nonce ?? null;
}

/** Marks the nonce used. Exactly one caller gets true, however many arrive together. */
export async function consumeNonce(db: Db, projectId: string, nonce: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(appDataNonces)
    .set({ usedAt: now })
    .where(and(eq(appDataNonces.nonce, nonce), eq(appDataNonces.projectId, projectId), isNull(appDataNonces.usedAt), gt(appDataNonces.expiresAt, now)))
    .returning({ nonce: appDataNonces.nonce });
  return rows.length === 1;
}

export async function createSession(db: Db, projectId: string, wallet: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(appDataSessions).values({ projectId, wallet: wallet.toLowerCase(), tokenHash: hashToken(token), expiresAt, createdAt: now });
  // Sign-in is rate limited, so this is a cheap place to keep both tables small.
  await db.delete(appDataNonces).where(lt(appDataNonces.expiresAt, now));
  await db.delete(appDataSessions).where(lt(appDataSessions.expiresAt, now));
  return { token, expiresAt };
}

/** The wallet behind a token, only for the app it was issued in. */
export async function sessionWallet(db: Db, projectId: string, token: string | undefined, now = new Date()): Promise<string | null> {
  if (!token) return null;
  const [row] = await db
    .select({ wallet: appDataSessions.wallet })
    .from(appDataSessions)
    .where(and(eq(appDataSessions.tokenHash, hashToken(token)), eq(appDataSessions.projectId, projectId), gt(appDataSessions.expiresAt, now)))
    .limit(1);
  return row?.wallet ?? null;
}

export async function endSession(db: Db, projectId: string, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(appDataSessions).where(and(eq(appDataSessions.tokenHash, hashToken(token)), eq(appDataSessions.projectId, projectId)));
}

// ---------------------------------------------------------------------------
// Records

export interface PublicRecord {
  key: string;
  owner: string;
  value: unknown;
  public: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toPublic(row: typeof appDataRecords.$inferSelect): PublicRecord {
  return { key: row.key, owner: row.ownerWallet, value: JSON.parse(row.value), public: row.isPublic, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** Who may see a row: anyone if it was written public, otherwise its owner. Checked on every read. */
function readable(viewer: string | null): SQL {
  return viewer ? (or(eq(appDataRecords.isPublic, true), eq(appDataRecords.ownerWallet, viewer)) as SQL) : eq(appDataRecords.isPublic, true);
}

export async function getRecord(db: Db, app: LiveApp, collection: string, owner: string, key: string, viewer: string | null): Promise<PublicRecord | null> {
  const [row] = await db
    .select()
    .from(appDataRecords)
    .where(and(eq(appDataRecords.projectId, app.projectId), eq(appDataRecords.collection, collection), eq(appDataRecords.ownerWallet, owner), eq(appDataRecords.key, key), readable(viewer)))
    .limit(1);
  return row ? toPublic(row) : null;
}

export async function listRecords(
  db: Db,
  app: LiveApp,
  collection: string,
  viewer: string | null,
  options: { owner?: string; limit: number; cursor?: number },
): Promise<{ records: PublicRecord[]; nextCursor: string | null }> {
  const rows = await db
    .select()
    .from(appDataRecords)
    .where(
      and(
        eq(appDataRecords.projectId, app.projectId),
        eq(appDataRecords.collection, collection),
        readable(viewer),
        options.owner ? eq(appDataRecords.ownerWallet, options.owner) : undefined,
        options.cursor ? lt(appDataRecords.id, options.cursor) : undefined,
      ),
    )
    .orderBy(desc(appDataRecords.id))
    .limit(options.limit + 1);
  const page = rows.slice(0, options.limit);
  return { records: page.map(toPublic), nextCursor: rows.length > options.limit ? String(page[page.length - 1].id) : null };
}

export const newRecordKey = () => randomUUID();

/** Add or replace the wallet's own record. Totals change in the same transaction, under a lock per project. */
export async function putRecord(
  db: Db,
  app: LiveApp,
  input: { collection: string; owner: string; key: string; json: string },
  limits: AppDataLimits,
  now = new Date(),
): Promise<PublicRecord> {
  const size = Buffer.byteLength(input.json) + input.collection.length + input.key.length;
  const isPublic = accessFor(app.rules, input.collection) === "public-read";
  return db.transaction(async (tx) => {
    await tx.insert(appDataUsage).values([{ projectId: app.projectId, wallet: PROJECT_TOTAL }, { projectId: app.projectId, wallet: input.owner }]).onConflictDoNothing();
    // Always the project row first: it serialises this project's writes, so totals can't race or deadlock.
    const [project] = await tx.select().from(appDataUsage).where(and(eq(appDataUsage.projectId, app.projectId), eq(appDataUsage.wallet, PROJECT_TOTAL))).for("update");
    const [mine] = await tx.select().from(appDataUsage).where(and(eq(appDataUsage.projectId, app.projectId), eq(appDataUsage.wallet, input.owner))).for("update");
    const recordKey = and(eq(appDataRecords.projectId, app.projectId), eq(appDataRecords.collection, input.collection), eq(appDataRecords.ownerWallet, input.owner), eq(appDataRecords.key, input.key));
    const [existing] = await tx.select({ size: appDataRecords.sizeBytes }).from(appDataRecords).where(recordKey);
    const addedRows = existing ? 0 : 1;
    const addedBytes = size - (existing?.size ?? 0);

    if (addedRows && mine.rows + 1 > limits.maxRowsPerWallet) {
      throw new AppDataError("wallet_quota_exceeded", 507, `This wallet has reached its limit of ${limits.maxRowsPerWallet} records in this app. Delete some and try again.`);
    }
    if (addedBytes > 0 && mine.bytes + addedBytes > limits.maxBytesPerWallet) {
      throw new AppDataError("wallet_quota_exceeded", 507, "This wallet has used all its storage in this app. Delete some records and try again.");
    }
    if ((addedRows && project.rows + 1 > limits.maxRowsPerProject) || (addedBytes > 0 && project.bytes + addedBytes > limits.maxBytesPerProject)) {
      throw new AppDataError("project_quota_exceeded", 507, "This app has used all its storage, so it can't save anything new right now.");
    }

    const [row] = await tx
      .insert(appDataRecords)
      .values({ projectId: app.projectId, collection: input.collection, ownerWallet: input.owner, key: input.key, value: input.json, isPublic, sizeBytes: size, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [appDataRecords.projectId, appDataRecords.collection, appDataRecords.ownerWallet, appDataRecords.key],
        set: { value: input.json, isPublic, sizeBytes: size, updatedAt: now },
      })
      .returning();
    await bumpUsage(tx, app.projectId, input.owner, addedRows, addedBytes);
    return toPublic(row);
  });
}

async function bumpUsage(tx: Pick<Db, "update">, projectId: string, wallet: string, rows: number, bytes: number) {
  await tx
    .update(appDataUsage)
    .set({ rows: sql`${appDataUsage.rows} + ${rows}`, bytes: sql`${appDataUsage.bytes} + ${bytes}` })
    .where(and(eq(appDataUsage.projectId, projectId), or(eq(appDataUsage.wallet, PROJECT_TOTAL), eq(appDataUsage.wallet, wallet))));
}

export async function deleteRecord(db: Db, app: LiveApp, collection: string, owner: string, key: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.select({ rows: appDataUsage.rows }).from(appDataUsage).where(and(eq(appDataUsage.projectId, app.projectId), eq(appDataUsage.wallet, PROJECT_TOTAL))).for("update");
    const [gone] = await tx
      .delete(appDataRecords)
      .where(and(eq(appDataRecords.projectId, app.projectId), eq(appDataRecords.collection, collection), eq(appDataRecords.ownerWallet, owner), eq(appDataRecords.key, key)))
      .returning({ size: appDataRecords.sizeBytes });
    if (!gone) return false;
    await bumpUsage(tx, app.projectId, owner, -1, -gone.size);
    return true;
  });
}

/** Everything one wallet stored in one app, and its sessions there. */
export async function eraseWallet(db: Db, projectId: string, wallet: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.select({ rows: appDataUsage.rows }).from(appDataUsage).where(and(eq(appDataUsage.projectId, projectId), eq(appDataUsage.wallet, PROJECT_TOTAL))).for("update");
    const gone = await tx.delete(appDataRecords).where(and(eq(appDataRecords.projectId, projectId), eq(appDataRecords.ownerWallet, wallet))).returning({ size: appDataRecords.sizeBytes });
    if (gone.length) await bumpUsage(tx, projectId, wallet, -gone.length, -gone.reduce((sum, r) => sum + r.size, 0));
    await tx.delete(appDataUsage).where(and(eq(appDataUsage.projectId, projectId), eq(appDataUsage.wallet, wallet)));
    await tx.delete(appDataSessions).where(and(eq(appDataSessions.projectId, projectId), eq(appDataSessions.wallet, wallet)));
    return gone.length;
  });
}

// ---------------------------------------------------------------------------
// The project as a whole

/** Bytes stored across every app, for the whole-site limit. */
export async function totalStoredBytes(db: Db): Promise<number> {
  const [row] = await db.select({ bytes: sql<string | null>`sum(${appDataUsage.bytes})` }).from(appDataUsage).where(eq(appDataUsage.wallet, PROJECT_TOTAL));
  return Number(row?.bytes ?? 0);
}

export interface ProjectDataStats {
  records: number;
  wallets: number;
  bytes: number;
}

export async function projectDataStats(db: Db, projectId: string): Promise<ProjectDataStats> {
  const usage = await db.select().from(appDataUsage).where(eq(appDataUsage.projectId, projectId));
  const total = usage.find((u) => u.wallet === PROJECT_TOTAL);
  return { records: total?.rows ?? 0, bytes: total?.bytes ?? 0, wallets: usage.filter((u) => u.wallet !== PROJECT_TOTAL && u.rows > 0).length };
}

/** Everything visitors stored in this project, plus their sessions. Used by the owner and by takedowns. */
export async function deleteProjectData(db: Db, projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(appDataRecords).where(eq(appDataRecords.projectId, projectId));
    await tx.delete(appDataUsage).where(eq(appDataUsage.projectId, projectId));
    await tx.delete(appDataSessions).where(eq(appDataSessions.projectId, projectId));
    await tx.delete(appDataNonces).where(eq(appDataNonces.projectId, projectId));
  });
}

/** Publishing with a stricter rule hides existing records at once. A looser rule only applies to new writes. */
export async function hideRecordsNoLongerPublic(tx: Pick<Db, "update">, projectId: string, rules: Record<string, string>): Promise<void> {
  const open = Object.entries(rules).filter(([, access]) => access === "public-read").map(([name]) => name);
  await tx
    .update(appDataRecords)
    .set({ isPublic: false })
    .where(and(eq(appDataRecords.projectId, projectId), eq(appDataRecords.isPublic, true), ...open.map((name) => ne(appDataRecords.collection, name))));
}
