import "server-only";

import { readFileSync } from "node:fs";
import { and, asc, eq, inArray, isNotNull, isNull, lt, like, sql } from "drizzle-orm";
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

import { CELO_MAINNET_ID, goodDollarAddress } from "@/config/gooddollar";
import type { Db } from "@/server/db/client";
import { registryEvents } from "@/server/db/registry-schema";
import { deployments } from "@/server/db/deploy-schema";
import { publications } from "@/server/db/publish-schema";
import { projects, users } from "@/server/db/schema";

/** Matches GoodBuildRegistry.Kind (D156). */
export const KIND = { BuilderJoined: 0, AppGenerated: 1, ProjectDeployed: 2, AppPublished: 3, AppUnpublished: 4, GdollarIntegrated: 5 } as const;
export type RegistryKind = keyof typeof KIND;

const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const ZERO20 = "0x0000000000000000000000000000000000000000";
const BATCH = 50;
const STUCK_MS = 10 * 60 * 1000;

/** Opaque id for a builder or app: keccak256(salt + ":" + id). Without the salt nobody can reverse or confirm a guess. */
export function opaqueId(kind: "builder" | "app", id: string, salt = process.env.REGISTRY_SALT ?? ""): Hex {
  return keccak256(stringToHex(`${salt}:${kind}:${id}`));
}

export interface RegistryEventInput {
  kind: RegistryKind;
  /** Unique per event and subject, e.g. `deployed:<tx>`. A repeat is ignored. */
  key: string;
  userId?: string;
  projectId?: string;
  target?: string;
  txHash?: string;
  /** When it happened. Defaults to now; backfill passes the source row's own time. */
  at?: Date;
}

/** The registry is on only when its salt is set, so dev and tests record nothing. Mainnet only (D156). */
export function registryEnabled(env = process.env): boolean {
  return Boolean(env.REGISTRY_SALT && env.REGISTRY_ADDRESS);
}

/**
 * Queue one event. Never throws and never blocks the caller: a registry problem must not break signing up,
 * deploying or publishing. A repeated key is ignored.
 */
export async function enqueueRegistryEvent(db: Db, e: RegistryEventInput): Promise<void> {
  if (!registryEnabled()) return;
  try {
    await db
      .insert(registryEvents)
      .values({
        key: e.key,
        kind: KIND[e.kind],
        builder: e.userId ? opaqueId("builder", e.userId) : ZERO32,
        app: e.projectId ? opaqueId("app", e.projectId) : ZERO32,
        target: (e.target ?? ZERO20).toLowerCase(),
        txHash: e.txHash ?? ZERO32,
        ...(e.at ? { occurredAt: e.at } : {}),
      })
      .onConflictDoNothing({ target: registryEvents.key });
  } catch (error) {
    console.warn(`[registry] couldn't queue ${e.key}: ${(error as Error).message}`);
  }
}

/** Only Celo mainnet counts: callers pass the deployment's chain. */
export const isRegistryChain = (chainId: number) => chainId === CELO_MAINNET_ID;

const ABI = parseAbi(["function recordBatch((uint8 kind, bytes32 builder, bytes32 app, address target, bytes32 txHash)[] entries)"]);

export function loadRecorderKey(path = process.env.RECORDER_KEY_FILE || "/run/secrets/recorder_key"): Hex | null {
  try {
    const key = readFileSync(path, "utf8").trim();
    return /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as Hex) : null;
  } catch {
    return null;
  }
}

export interface FlushDeps {
  send: (entries: { kind: number; builder: Hex; app: Hex; target: Hex; txHash: Hex; at: bigint }[]) => Promise<Hex>;
  /** The batch's outcome: true mined, false reverted, null no receipt yet. Never waits long. */
  receipt: (hash: Hex) => Promise<boolean | null>;
  now?: () => Date;
}

export function liveFlushDeps(): FlushDeps | null {
  const registry = process.env.REGISTRY_ADDRESS as Hex | undefined;
  const key = loadRecorderKey();
  if (!registry) return null;
  if (!key) {
    // On but unable to send: say so, or events would pile up unseen.
    console.warn("[registry] REGISTRY_ADDRESS is set but the recorder key can't be read (RECORDER_KEY_FILE); nothing is being sent");
    return null;
  }
  const transport = http(process.env.CELO_RPC_URL || undefined);
  const pub = createPublicClient({ chain: celo, transport });
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: celo, transport });
  return {
    send: (entries) => wallet.writeContract({ address: registry, abi: ABI, functionName: "recordBatch", args: [entries] }),
    receipt: async (hash) => {
      try {
        return (await pub.getTransactionReceipt({ hash })).status === "success";
      } catch {
        return null;
      }
    },
  };
}

/**
 * Send pending events as one transaction. Run from the worker only, one sweep at a time, with its own recorder key,
 * so nonces can't collide with the gas wallet.
 *
 * The batch's hash is saved the moment it is broadcast. A later sweep asks the chain about that hash and never
 * sends the same rows again, so a slow RPC or a crash can't write events twice. Rows marked `sending` with no hash
 * (a crash before broadcast) go back to pending after 10 minutes.
 */
export async function flushRegistry(db: Db, deps: FlushDeps | null = liveFlushDeps()): Promise<{ sent: number; failed: number }> {
  if (!deps) return { sent: 0, failed: 0 };
  const now = (deps.now ?? (() => new Date()))();
  let sent = 0;
  let failed = 0;

  // 1. Settle batches already broadcast.
  const inFlight = await db.select().from(registryEvents).where(and(eq(registryEvents.status, "sending"), isNotNull(registryEvents.batchTx)));
  for (const hash of new Set(inFlight.map((r) => r.batchTx as Hex))) {
    const ok = await deps.receipt(hash);
    if (ok === null) continue;
    const n = inFlight.filter((r) => r.batchTx === hash).length;
    await db.update(registryEvents).set({ status: ok ? "sent" : "failed", error: ok ? null : "The batch reverted." }).where(and(eq(registryEvents.batchTx, hash), eq(registryEvents.status, "sending")));
    if (ok) sent += n;
    else failed += n;
  }
  // A batch that is still unknown blocks the next one: the recorder's nonce must not race itself.
  const stillOut = await db.select({ id: registryEvents.id }).from(registryEvents).where(and(eq(registryEvents.status, "sending"), isNotNull(registryEvents.batchTx))).limit(1);
  if (stillOut.length) return { sent, failed };

  // 2. Rows stuck before broadcast.
  await db.update(registryEvents).set({ status: "pending" }).where(and(eq(registryEvents.status, "sending"), isNull(registryEvents.batchTx), lt(registryEvents.sentAt, new Date(now.getTime() - STUCK_MS))));

  // 3. A new batch.
  const rows = await db.select().from(registryEvents).where(eq(registryEvents.status, "pending")).orderBy(asc(registryEvents.createdAt)).limit(BATCH);
  if (!rows.length) return { sent, failed };
  const ids = rows.map((r) => r.id);
  await db.update(registryEvents).set({ status: "sending", sentAt: now }).where(inArray(registryEvents.id, ids));
  let hash: Hex;
  try {
    hash = await deps.send(rows.map((r) => ({ kind: r.kind, builder: r.builder as Hex, app: r.app as Hex, target: r.target as Hex, txHash: r.txHash as Hex, at: BigInt(Math.floor(r.occurredAt.getTime() / 1000)) })));
  } catch (error) {
    // Refused before it left (bad key, no funds, node down): nothing is on chain, so the rows can go again.
    for (const r of rows) {
      await db
        .update(registryEvents)
        .set({ status: r.attempts + 1 >= 5 ? "failed" : "pending", attempts: r.attempts + 1, error: (error as Error).message.slice(0, 300) })
        .where(eq(registryEvents.id, r.id));
    }
    return { sent, failed: failed + rows.length };
  }
  await db.update(registryEvents).set({ batchTx: hash }).where(inArray(registryEvents.id, ids));
  return { sent, failed };
}

/** Queue an event for a project, looking up its owner. Same guarantees as enqueueRegistryEvent. */
export async function enqueueForProject(db: Db, e: Omit<RegistryEventInput, "userId">): Promise<void> {
  if (!registryEnabled() || !e.projectId) return;
  try {
    const [p] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, e.projectId)).limit(1);
    if (p) await enqueueRegistryEvent(db, { ...e, userId: p.ownerId });
  } catch (error) {
    console.warn(`[registry] couldn't queue ${e.key}: ${(error as Error).message}`);
  }
}

/** Events for a mainnet deployment (D156): the deploy, and G$ use when the G$ token is among its constructor arguments. */
export async function enqueueDeployment(db: Db, d: { projectId: string; chainId: number; address: string; txHash: string; constructorArgs: string }, at?: Date): Promise<void> {
  if (!isRegistryChain(d.chainId)) return;
  await enqueueForProject(db, { kind: "ProjectDeployed", key: `deployed:${d.txHash.toLowerCase()}`, projectId: d.projectId, target: d.address, txHash: d.txHash, at });
  const gd = goodDollarAddress(d.chainId);
  if (gd && d.constructorArgs.toLowerCase().includes(gd.slice(2).toLowerCase())) {
    await enqueueForProject(db, { kind: "GdollarIntegrated", key: `gd:${d.address.toLowerCase()}`, projectId: d.projectId, target: d.address, at });
  }
}

/**
 * Queue events for everything that happened before the registry went live (D156): builders, apps with a first
 * version, mainnet deployments (and G$ use), and apps live now. Safe to run twice: keys are the same ones the live
 * hooks use, so nothing is queued again. Returns how many rows were new.
 */
export async function backfillRegistry(db: Db): Promise<number> {
  const before = (await db.select({ n: sql<number>`count(*)::int` }).from(registryEvents))[0].n;
  for (const u of await db.select({ id: users.id, at: users.createdAt }).from(users)) await enqueueRegistryEvent(db, { kind: "BuilderJoined", key: `builder:${u.id}`, userId: u.id, at: u.at });
  for (const p of await db.select({ id: projects.id, ownerId: projects.ownerId, at: projects.createdAt }).from(projects).where(sql`${projects.currentVersion} >= 1`)) {
    await enqueueRegistryEvent(db, { kind: "AppGenerated", key: `generated:${p.id}`, userId: p.ownerId, projectId: p.id, at: p.at });
  }
  for (const d of await db.select().from(deployments).where(eq(deployments.chainId, CELO_MAINNET_ID))) await enqueueDeployment(db, d, d.createdAt);
  for (const p of await db.select({ projectId: publications.projectId, at: publications.publishedAt }).from(publications).where(and(isNull(publications.unpublishedAt), isNull(publications.disabledAt)))) {
    // Live keys carry the publish time, which moves on every publish: skip a project that already has any publish row.
    const has = await db.select({ id: registryEvents.id }).from(registryEvents).where(like(registryEvents.key, `published:${p.projectId}:%`)).limit(1);
    if (!has.length) await enqueueForProject(db, { kind: "AppPublished", key: `published:${p.projectId}:${p.at.getTime()}`, projectId: p.projectId, at: p.at });
  }
  return (await db.select({ n: sql<number>`count(*)::int` }).from(registryEvents))[0].n - before;
}

/**
 * Admin takedowns set `disabled_at` straight in the database (scripts/takedown.mjs), so they are found here, by the
 * worker's sweep, and queued once as AppUnpublished.
 */
export async function enqueueTakedowns(db: Db): Promise<void> {
  if (!registryEnabled()) return;
  for (const p of await db.select({ projectId: publications.projectId, at: publications.disabledAt }).from(publications).where(and(isNotNull(publications.disabledAt), isNull(publications.unpublishedAt)))) {
    await enqueueForProject(db, { kind: "AppUnpublished", key: `taken:${p.projectId}:${p.at!.getTime()}`, projectId: p.projectId, at: p.at! });
  }
}
