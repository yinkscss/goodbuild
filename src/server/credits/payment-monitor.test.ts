// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { onchainCreditEvents, creditsSyncCursor } from "@/server/db/onchain-credits-schema";
import { users } from "@/server/db/schema";
import { creditQuotes } from "@/server/db/credit-quotes-schema";
import { createPaymentMonitor, paymentHealth } from "./payment-monitor";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";
let database: TestDatabase;
let db: Db;
beforeAll(async () => { database = await testBackends()[0].open(); db = database.db; await database.migrate(MIGRATIONS); });
afterAll(async () => database?.close());
it("warns for aged unsettled payments, excludes no-account and unpaid quotes, throttles and reports recovery", async () => {
  const now = new Date();
  const old = new Date(now.getTime() - 11 * 60 * 1000);
  const wallet = `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}`;
  const [user] = await db.insert(users).values({ wallet }).returning();
  const ref = `0x${"a".repeat(64)}`;
  const hash = `0x${"b".repeat(64)}`;
  const [event] = await db.insert(onchainCreditEvents).values({ chainId: 42220, txHash: hash, logIndex: 0, blockNumber: 10, wallet, amountMicro: 1_000_000, ref, createdAt: old }).returning();
  await db.insert(onchainCreditEvents).values({ chainId: 42220, txHash: `0x${"c".repeat(64)}`, logIndex: 0, blockNumber: 10, wallet: "0xnoaccount", amountMicro: 1_000_000, createdAt: old });
  await db.insert(creditQuotes).values({ ref: `0x${"d".repeat(64)}`, userId: user.id, chainId: 42220, wallet, pack: 100, creditsMicro: 1_000_000, gdWei: "100", gdUsd: "0.01", deadline: old, createdAt: old });
  await db.insert(creditsSyncCursor).values({ chainId: 42220, lastBlock: 2000 });
  const log = { warn: vi.fn(), info: vi.fn() };
  const monitor = createPaymentMonitor(log);
  expect(await monitor(db, 42220, BigInt(4000), now)).toMatchObject({ awaitingCredits: [{ txHash: hash, ref }], scannerBehind: false });
  await monitor(db, 42220, BigInt(4000), now);
  expect(log.warn).toHaveBeenCalledOnce();
  await db.update(onchainCreditEvents).set({ userId: user.id, ledgerEntryId: randomUUID(), creditedAt: now }).where(eq(onchainCreditEvents.id, event.id));
  await monitor(db, 42220, BigInt(4000), now);
  expect(log.info).toHaveBeenCalledWith("[credits] payment_health_recovered", { chainId: 42220 });
  expect(await paymentHealth(db, 42220, BigInt(6001), now)).toMatchObject({ scannerBehind: true, awaitingCredits: [] });
  const missingRef = `0x${"e".repeat(64)}`;
  await db.insert(creditQuotes).values({ ref: missingRef, userId: user.id, chainId: 42220, wallet, pack: 100, creditsMicro: 1_000_000, gdWei: "100", gdUsd: "0.01", deadline: old, createdAt: old, paidAt: old, paidTx: hash });
  expect(await paymentHealth(db, 42220, BigInt(4000), now)).toMatchObject({ awaitingCredits: [{ txHash: hash, ref: missingRef }] });

});
