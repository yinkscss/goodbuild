import "server-only";

import { randomBytes, randomUUID, createHash } from "node:crypto";

import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import { grantOf, ruleFor, type CollectionRule, type DataRole, type RecordGrant } from "@/lib/app-data";
import type { Db } from "@/server/db/client";
import { appDataNonces, appDataRecords, appDataSessions, appDataUsage } from "@/server/db/app-data-schema";
import { publications } from "@/server/db/publish-schema";
import { projects, users } from "@/server/db/schema";
import type { AppDataLimits } from "./limits";

/** Every function here takes the project from the caller, which derives it from the Host. Never from input. */
export interface LiveApp {
  projectId: string;
  clientId: string;
  rules: Record<string, unknown>;
  /** The project owner's wallet, lowercase: the "owner" role (D34). From GoodBuild's own records, never the app. */
  ownerWallet: string;
}

const PROJECT_TOTAL = "*";
/** Running total of records from visitors who didn't sign in, so spam can't fill the whole app (D34). */
const ANON_TOTAL = "anon:*";

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
    .select({ projectId: publications.projectId, clientId: publications.clientId, rules: publications.dataRules, unpublishedAt: publications.unpublishedAt, disabledAt: publications.disabledAt, ownerWallet: users.wallet })
    .from(publications)
    .innerJoin(projects, eq(projects.id, publications.projectId))
    .innerJoin(users, eq(users.id, projects.ownerId))
    .where(eq(publications.slug, slug))
    .limit(1);
  if (!row || row.unpublishedAt || row.disabledAt) return null;
  return { projectId: row.projectId, clientId: row.clientId, rules: row.rules, ownerWallet: row.ownerWallet.toLowerCase() };
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
  /** Who saved it. Null when the viewer only sees the record's public fields. */
  owner: string | null;
  value: unknown;
  public: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Who is asking (D34). `subject` is a wallet, or "anon:<id>" for a visitor who didn't sign in. */
export interface Viewer {
  subject: string;
  signedIn: boolean;
  isOwner: boolean;
}

export const ANON_PREFIX = "anon:";
export const isAnonymous = (subject: string) => subject.startsWith(ANON_PREFIX);
/** Reserved for email sign-in, so a subject can never be mistaken for another kind. */
export const EMAIL_PREFIX = "email:";

export function viewerFor(app: LiveApp, subject: string | null): Viewer | null {
  if (!subject) return null;
  return { subject, signedIn: !isAnonymous(subject), isOwner: subject === app.ownerWallet };
}

/** Records saved before D34 have no grant: public ones were readable by anyone, the rest by their writer only. */
function savedGrant(row: typeof appDataRecords.$inferSelect): RecordGrant {
  return row.access ?? { read: row.isPublic ? ["anyone"] : ["writer"], public: [] };
}

function hasRole(roles: DataRole[], viewer: Viewer | null, writer: string): boolean {
  return roles.some((role) =>
    role === "anyone" ? true : role === "signed-in" ? Boolean(viewer?.signedIn) : role === "writer" ? viewer?.subject === writer : Boolean(viewer?.isOwner),
  );
}

/** Fields a grant shows to everyone. A grant everyone could read showed every field. */
function openFields(grant: RecordGrant): string[] | "all" {
  return grant.read.includes("anyone") ? "all" : grant.public;
}

/**
 * What this viewer may see of one row: all of it, only its public fields, or nothing. The viewer
 * must pass both the grant the record was saved under and the rule now, so a looser rule never
 * shows more than the writer agreed to, and a stricter one applies at once.
 */
function present(row: typeof appDataRecords.$inferSelect, rule: CollectionRule, viewer: Viewer | null): PublicRecord | null {
  const saved = savedGrant(row);
  const now = grantOf(rule);
  const value = JSON.parse(row.value) as unknown;
  const base = { key: row.key, public: saved.read.includes("anyone") && now.read.includes("anyone"), createdAt: row.createdAt, updatedAt: row.updatedAt };
  if (hasRole(saved.read, viewer, row.ownerWallet) && hasRole(now.read, viewer, row.ownerWallet)) return { ...base, owner: row.ownerWallet, value };
  const a = openFields(saved);
  const b = openFields(now);
  const fields = a === "all" ? (b === "all" ? null : b) : b === "all" ? a : a.filter((f) => b.includes(f));
  if (!fields || !fields.length || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const shown = Object.fromEntries(fields.filter((f) => Object.hasOwn(value, f)).map((f) => [f, (value as Record<string, unknown>)[f]]));
  return { ...base, owner: null, value: shown };
}

/** Whether a viewer might see any row of someone else's in this collection, so the query can't be narrowed to their own. */
function seesOthers(rule: CollectionRule, viewer: Viewer | null): boolean {
  if (rule.public.length) return true;
  return rule.read.some((r) => r === "anyone" || (r === "signed-in" && viewer?.signedIn) || (r === "owner" && viewer?.isOwner));
}

/** Only records this viewer sees in full can be looked up by who wrote them, so a public part never reveals its writer. */
export async function getRecord(db: Db, app: LiveApp, collection: string, owner: string, key: string, viewer: Viewer | null): Promise<PublicRecord | null> {
  const [row] = await db
    .select()
    .from(appDataRecords)
    .where(and(eq(appDataRecords.projectId, app.projectId), eq(appDataRecords.collection, collection), eq(appDataRecords.ownerWallet, owner), eq(appDataRecords.key, key)))
    .limit(1);
  const shown = row ? present(row, ruleFor(app.rules, collection), viewer) : null;
  return shown && shown.owner !== null ? shown : null;
}

export async function listRecords(
  db: Db,
  app: LiveApp,
  collection: string,
  viewer: Viewer | null,
  options: { owner?: string; limit: number; cursor?: number },
): Promise<{ records: PublicRecord[]; nextCursor: string | null }> {
  const rule = ruleFor(app.rules, collection);
  const others = seesOthers(rule, viewer);
  if (!others && !viewer) return { records: [], nextCursor: null };
  const rows = await db
    .select()
    .from(appDataRecords)
    .where(
      and(
        eq(appDataRecords.projectId, app.projectId),
        eq(appDataRecords.collection, collection),
        others ? undefined : eq(appDataRecords.ownerWallet, viewer!.subject),
        options.cursor ? lt(appDataRecords.id, options.cursor) : undefined,
      ),
    )
    .orderBy(desc(appDataRecords.id))
    .limit(options.limit + 1);
  const page = rows.slice(0, options.limit);
  const records = page
    .map((row) => present(row, rule, viewer))
    // Filtering by writer only ever matches records shown in full, which already name their writer.
    .filter((r): r is PublicRecord => r !== null && (!options.owner || r.owner === options.owner));
  return { records, nextCursor: rows.length > options.limit ? String(page[page.length - 1].id) : null };
}

/** May this viewer add a record here? Anonymous visitors only where the rule says anyone. */
export function canCreate(rule: CollectionRule, viewer: Viewer | null): boolean {
  if (rule.create === "anyone") return true;
  if (rule.create === "signed-in") return Boolean(viewer?.signedIn);
  return Boolean(viewer?.isOwner);
}

/** The value checked against the rule's fields. Returns a message a person can read, or null. */
export function fieldProblem(rule: CollectionRule, json: string): string | null {
  if (!rule.fields) return null;
  const value = JSON.parse(json) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Send an object with the fields this collection uses.";
  const fields = rule.fields;
  const extra = Object.keys(value).filter((f) => !Object.hasOwn(fields, f));
  if (extra.length) return `These fields aren't part of this collection: ${extra.join(", ")}.`;
  for (const [field, type] of Object.entries(fields)) {
    const v = (value as Record<string, unknown>)[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== type || (type === "number" && !Number.isFinite(v))) return `"${field}" must be a ${type}.`;
  }
  for (const field of rule.unique) {
    if ((value as Record<string, unknown>)[field] === undefined) return `"${field}" is needed here.`;
  }
  return null;
}

export const newRecordKey = () => randomUUID();

/** Add or replace the wallet's own record. Totals change in the same transaction, under a lock per project. */
export async function putRecord(
  db: Db,
  app: LiveApp,
  input: { collection: string; owner: string; key: string; json: string },
  limits: AppDataLimits,
  now = new Date(),
  viewer: Viewer | null = null,
): Promise<PublicRecord> {
  const size = Buffer.byteLength(input.json) + input.collection.length + input.key.length;
  const rule = ruleFor(app.rules, input.collection);
  const access = grantOf(rule);
  const isPublic = access.read.includes("anyone");
  const anonymous = isAnonymous(input.owner);
  const problem = fieldProblem(rule, input.json);
  if (problem) throw new AppDataError("invalid_value", 400, problem);
  return db.transaction(async (tx) => {
    await tx.insert(appDataUsage).values([{ projectId: app.projectId, wallet: PROJECT_TOTAL }, { projectId: app.projectId, wallet: input.owner }]).onConflictDoNothing();
    // Always the project row first: it serialises this project's writes, so totals can't race or deadlock.
    const [project] = await tx.select().from(appDataUsage).where(and(eq(appDataUsage.projectId, app.projectId), eq(appDataUsage.wallet, PROJECT_TOTAL))).for("update");
    const [mine] = await tx.select().from(appDataUsage).where(and(eq(appDataUsage.projectId, app.projectId), eq(appDataUsage.wallet, input.owner))).for("update");
    const recordKey = and(eq(appDataRecords.projectId, app.projectId), eq(appDataRecords.collection, input.collection), eq(appDataRecords.ownerWallet, input.owner), eq(appDataRecords.key, input.key));
    const [existing] = await tx.select({ size: appDataRecords.sizeBytes }).from(appDataRecords).where(recordKey);
    const addedRows = existing ? 0 : 1;
    const addedBytes = size - (existing?.size ?? 0);

    if (existing && !rule.update.includes("writer")) throw new AppDataError("forbidden", 403, "Records here can't be changed once they're saved.");
    if (!existing && !canCreate(rule, viewer ?? { subject: input.owner, signedIn: !anonymous, isOwner: input.owner === app.ownerWallet })) {
      throw new AppDataError(rule.create === "owner" ? "forbidden" : "unauthenticated", rule.create === "owner" ? 403 : 401, rule.create === "owner" ? "Only this app's owner can add records here." : "Connect your wallet and sign in first.");
    }
    if (anonymous && addedRows) {
      await tx.insert(appDataUsage).values({ projectId: app.projectId, wallet: ANON_TOTAL }).onConflictDoNothing();
      const [anon] = await tx.select().from(appDataUsage).where(and(eq(appDataUsage.projectId, app.projectId), eq(appDataUsage.wallet, ANON_TOTAL)));
      if (anon.rows + 1 > limits.maxAnonRowsPerProject) {
        throw new AppDataError("anon_quota_exceeded", 507, "This app has taken as many entries from visitors who aren't signed in as it can for now. Try again later.");
      }
    }
    if (rule.unique.length) {
      const value = JSON.parse(input.json) as Record<string, unknown>;
      const clash = await tx
        .select({ key: appDataRecords.key })
        .from(appDataRecords)
        .where(
          and(
            eq(appDataRecords.projectId, app.projectId),
            eq(appDataRecords.collection, input.collection),
            existing ? sql`not (${appDataRecords.ownerWallet} = ${input.owner} and ${appDataRecords.key} = ${input.key})` : undefined,
            ...rule.unique.map((f) => sql`(${appDataRecords.value}::jsonb -> ${f}) = ${JSON.stringify(value[f])}::jsonb`),
          ),
        )
        .limit(1);
      if (clash.length) throw new AppDataError("duplicate", 409, `That ${rule.unique.join(" and ")} is already taken.`);
    }

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
      .values({ projectId: app.projectId, collection: input.collection, ownerWallet: input.owner, key: input.key, value: input.json, isPublic, access, sizeBytes: size, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [appDataRecords.projectId, appDataRecords.collection, appDataRecords.ownerWallet, appDataRecords.key],
        // The writer edits their own record, so it takes the rule as it is now.
        set: { value: input.json, isPublic, access, sizeBytes: size, updatedAt: now },
      })
      .returning();
    await bumpUsage(tx, app.projectId, input.owner, addedRows, addedBytes);
    if (anonymous && addedRows) await tx.update(appDataUsage).set({ rows: sql`${appDataUsage.rows} + 1`, bytes: sql`${appDataUsage.bytes} + ${addedBytes}` }).where(and(eq(appDataUsage.projectId, app.projectId), eq(appDataUsage.wallet, ANON_TOTAL)));
    return { key: row.key, owner: row.ownerWallet, value: JSON.parse(row.value), public: row.isPublic, createdAt: row.createdAt, updatedAt: row.updatedAt };
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
    if (isAnonymous(owner)) await tx.update(appDataUsage).set({ rows: sql`greatest(${appDataUsage.rows} - 1, 0)`, bytes: sql`greatest(${appDataUsage.bytes} - ${gone.size}, 0)` }).where(and(eq(appDataUsage.projectId, app.projectId), eq(appDataUsage.wallet, ANON_TOTAL)));
    return true;
  });
}

/** Everything one wallet stored in one app, and its sessions there. */
export async function eraseWallet(db: Db, projectId: string, wallet: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.select({ rows: appDataUsage.rows }).from(appDataUsage).where(and(eq(appDataUsage.projectId, projectId), eq(appDataUsage.wallet, PROJECT_TOTAL))).for("update");
    const gone = await tx.delete(appDataRecords).where(and(eq(appDataRecords.projectId, projectId), eq(appDataRecords.ownerWallet, wallet))).returning({ size: appDataRecords.sizeBytes });
    const bytes = gone.reduce((sum, r) => sum + r.size, 0);
    if (gone.length) await bumpUsage(tx, projectId, wallet, -gone.length, -bytes);
    if (gone.length && isAnonymous(wallet)) await tx.update(appDataUsage).set({ rows: sql`greatest(${appDataUsage.rows} - ${gone.length}, 0)`, bytes: sql`greatest(${appDataUsage.bytes} - ${bytes}, 0)` }).where(and(eq(appDataUsage.projectId, projectId), eq(appDataUsage.wallet, ANON_TOTAL)));
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
  return { records: total?.rows ?? 0, bytes: total?.bytes ?? 0, wallets: usage.filter((u) => u.wallet !== PROJECT_TOTAL && u.wallet !== ANON_TOTAL && u.rows > 0).length };
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

// ---------------------------------------------------------------------------
// The owner's view, inside GoodBuild (D34)

/** The app's rules and owner for its owner's own view, published or not. Null before the first publish. */
export async function ownerApp(db: Db, projectId: string, ownerWallet: string): Promise<LiveApp | null> {
  const [row] = await db.select({ clientId: publications.clientId, rules: publications.dataRules }).from(publications).where(eq(publications.projectId, projectId)).limit(1);
  return row ? { projectId, clientId: row.clientId, rules: row.rules, ownerWallet: ownerWallet.toLowerCase() } : null;
}

/** The collections whose records the owner can read, from the published rules. */
export function ownerCollections(app: LiveApp): string[] {
  return Object.keys(app.rules).filter((name) => ruleFor(app.rules, name).read.some((r) => r === "owner" || r === "anyone" || r === "signed-in"));
}

/** Records the owner may read in one collection, newest first. Each record's own saved grant still applies. */
export async function ownerRecords(db: Db, app: LiveApp, collection: string, options: { limit: number; cursor?: number }) {
  const owner: Viewer = { subject: app.ownerWallet, signedIn: true, isOwner: true };
  const result = await listRecords(db, app, collection, owner, options);
  return { ...result, records: result.records.filter((r) => r.owner !== null) };
}

/** One spreadsheet cell. Entries come from strangers, so a leading = + - @ tab or return can't start a formula. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function recordsCsv(records: PublicRecord[]): string {
  const fields = [...new Set(records.flatMap((r) => (r.value && typeof r.value === "object" && !Array.isArray(r.value) ? Object.keys(r.value) : ["value"])))];
  const header = ["saved", "from", ...fields];
  const rows = records.map((r) => {
    const v = r.value && typeof r.value === "object" && !Array.isArray(r.value) ? (r.value as Record<string, unknown>) : { value: r.value };
    return [r.createdAt.toISOString(), r.owner?.startsWith(ANON_PREFIX) ? "visitor" : r.owner, ...fields.map((f) => v[f])];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
