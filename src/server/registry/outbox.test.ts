import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type Db } from "@/server/db/client";
import { registryEvents } from "@/server/db/registry-schema";
import { projects, users } from "@/server/db/schema";
import { backfillRegistry, enqueueDeployment, enqueueForProject, enqueueRegistryEvent, flushRegistry, opaqueId } from "./outbox";

vi.mock("server-only", () => ({}));

const GD = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
let db: Db;
let userId: string;
let projectId: string;

beforeEach(async () => {
  vi.stubEnv("REGISTRY_SALT", "salt");
  vi.stubEnv("REGISTRY_ADDRESS", "0x3333333333333333333333333333333333333333");
  db = await createTestDb();
  [{ id: userId }] = await db.insert(users).values({ wallet: "0xabc0000000000000000000000000000000000001" }).returning({ id: users.id });
  [{ id: projectId }] = await db.insert(projects).values({ ownerId: userId, name: "Tips", chainId: 42220 }).returning({ id: projects.id });
});
afterEach(() => vi.unstubAllEnvs());

const all = () => db.select().from(registryEvents);

describe("registry outbox", () => {
  it("hides ids behind the salt", () => {
    expect(opaqueId("builder", userId)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(opaqueId("builder", userId)).not.toBe(opaqueId("builder", userId, "other"));
    expect(opaqueId("builder", userId)).not.toBe(opaqueId("app", userId));
  });
  it("queues once per key and sends no wallet or id on-chain", async () => {
    await enqueueRegistryEvent(db, { kind: "BuilderJoined", key: `builder:${userId}`, userId });
    await enqueueRegistryEvent(db, { kind: "BuilderJoined", key: `builder:${userId}`, userId });
    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows.map(({ kind, builder, app, target, txHash }) => ({ kind, builder, app, target, txHash })))).not.toContain(userId);
  });
  it("does nothing without a salt", async () => {
    vi.stubEnv("REGISTRY_SALT", "");
    await enqueueRegistryEvent(db, { kind: "BuilderJoined", key: "x", userId });
    expect(await all()).toHaveLength(0);
  });
  it("queues a mainnet deploy, plus G$ use, and ignores testnet", async () => {
    const d = { projectId, chainId: 42220, address: "0x4444444444444444444444444444444444444444", txHash: `0x${"a".repeat(64)}`, constructorArgs: `0x${GD.slice(2).toLowerCase().padStart(64, "0")}` };
    await enqueueDeployment(db, d);
    await enqueueDeployment(db, { ...d, chainId: 11142220, txHash: `0x${"b".repeat(64)}` });
    expect((await all()).map((r) => r.kind).sort()).toEqual([2, 5]);
  });
  it("sends pending rows in one batch and marks them sent", async () => {
    await enqueueForProject(db, { kind: "AppGenerated", key: "g", projectId });
    await enqueueForProject(db, { kind: "AppPublished", key: "p", projectId });
    const send = vi.fn().mockResolvedValue(`0x${"c".repeat(64)}`);
    const out = await flushRegistry(db, { send, confirm: async () => true });
    expect(out).toEqual({ sent: 2, failed: 0 });
    expect(send.mock.calls[0][0]).toHaveLength(2);
    expect((await all()).every((r) => r.status === "sent" && r.batchTx === `0x${"c".repeat(64)}`)).toBe(true);
    expect(await flushRegistry(db, { send, confirm: async () => true })).toEqual({ sent: 0, failed: 0 });
  });
  it("puts rows back after a send error and fails a reverted batch", async () => {
    await enqueueForProject(db, { kind: "AppGenerated", key: "g", projectId });
    await flushRegistry(db, { send: async () => { throw new Error("rpc down"); }, confirm: async () => true });
    expect((await all())[0]).toMatchObject({ status: "pending", attempts: 1 });
    await flushRegistry(db, { send: async () => `0x${"d".repeat(64)}`, confirm: async () => false });
    expect((await all())[0].status).toBe("failed");
  });
  it("backfills builders and apps once", async () => {
    await db.update(projects).set({ currentVersion: 1 });
    expect(await backfillRegistry(db)).toBe(2);
    expect(await backfillRegistry(db)).toBe(0);
  });
});
