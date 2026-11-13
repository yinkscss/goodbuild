// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, getAddress, pad, type Hex } from "viem";

import type { Db } from "@/server/db/client";
import { onchainCreditEvents } from "@/server/db/onchain-credits-schema";
import { users } from "@/server/db/schema";
import { getBalanceMicro } from "./ledger";
import { CREDITS_ABI, creditPendingForWallet, creditsContract, recordRedemption, redeemFromReceipt, SYNC_REORG_OVERLAP, syncCursor, syncRedemptions } from "./onchain";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

const CONTRACT = getAddress("0x00000000000000000000000000000000000c0de1");
const ENV = { CREDITS_CONTRACT_42220: CONTRACT } as unknown as NodeJS.ProcessEnv;
const newWallet = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0").slice(0, 40)}`;
const tx = () => `0x${randomUUID().replaceAll("-", "").padEnd(64, "0")}` as Hex;

function redeemedLog(wallet: string, units: bigint, logIndex: number, transactionHash: Hex, address = CONTRACT, blockNumber = BigInt(10)) {
  return {
    address,
    topics: encodeEventTopics({ abi: CREDITS_ABI, eventName: "Redeemed", args: { account: getAddress(wallet) } }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [units, pad("0x01")]),
    logIndex,
    blockNumber,
    transactionHash,
  };
}

describe.each(testBackends())("on-chain credits on $name", (backend) => {
  let database: TestDatabase;
  let db: Db;
  beforeAll(async () => {
    database = await backend.open();
    db = database.db;
    await database.migrate(MIGRATIONS);
  }, 120_000);
  afterAll(async () => database?.close());

  const account = async (wallet = newWallet()) => {
    const [u] = await db.insert(users).values({ wallet }).returning();
    return u;
  };
  const log = (wallet: string, amountMicro: number, over: Partial<Parameters<typeof recordRedemption>[1]> = {}) => ({ chainId: 42220, txHash: tx(), logIndex: 0, blockNumber: 10, wallet, amountMicro, ...over });

  it("credits the wallet's account one-for-one in micro-USD", async () => {
    const u = await account();
    const r = await recordRedemption(db, log(u.wallet, 2_500_000));
    expect(r).toMatchObject({ credited: true, userId: u.id, amountMicro: 2_500_000 });
    expect(await getBalanceMicro(db, u.id)).toBe(2_500_000);
  });

  it("credits once however many times, or how concurrently, the same event is read", async () => {
    const u = await account();
    const l = log(u.wallet, 1_000_000);
    const results = await Promise.all([1, 2, 3, 4].map(() => recordRedemption(db, l)));
    expect(results.filter((r) => r.credited)).toHaveLength(1);
    await recordRedemption(db, l);
    expect(await getBalanceMicro(db, u.id)).toBe(1_000_000);
  });

  it("two events in one transaction are two credits", async () => {
    const u = await account();
    const hash = tx();
    await recordRedemption(db, log(u.wallet, 100, { txHash: hash, logIndex: 0 }));
    await recordRedemption(db, log(u.wallet, 200, { txHash: hash, logIndex: 1 }));
    expect(await getBalanceMicro(db, u.id)).toBe(300);
  });

  it("holds a redemption for a wallet with no account, then credits it when it signs in", async () => {
    const wallet = newWallet();
    const r = await recordRedemption(db, log(wallet, 4_000_000));
    expect(r).toMatchObject({ credited: false, userId: null });
    const u = await account(wallet);
    expect(await creditPendingForWallet(db, wallet)).toBe(4_000_000);
    expect(await creditPendingForWallet(db, wallet)).toBe(0); // the second sign-in adds nothing
    expect(await getBalanceMicro(db, u.id)).toBe(4_000_000);
  });

  it("matches wallets regardless of address case", async () => {
    const u = await account();
    await recordRedemption(db, log(getAddress(u.wallet), 7));
    expect(await getBalanceMicro(db, u.id)).toBe(7);
  });

  it("refuses zero, negative and fractional amounts", async () => {
    for (const amountMicro of [0, -5, 1.5]) await expect(recordRedemption(db, log(newWallet(), amountMicro))).rejects.toThrow();
  });

  describe("from a receipt", () => {
    const receiptClient = (logs: ReturnType<typeof redeemedLog>[], status: "success" | "reverted" = "success") => ({ getTransactionReceipt: async () => ({ status, logs }) }) as never;

    it("credits the account named in the log, not whoever submitted it", async () => {
      const u = await account();
      const hash = tx();
      const out = await redeemFromReceipt(db, receiptClient([redeemedLog(u.wallet, BigInt(3_000_000), 5, hash)]), 42220, hash, ENV);
      expect(out).toEqual({ events: 1, creditedMicro: 3_000_000 });
      expect(await getBalanceMicro(db, u.id)).toBe(3_000_000);
    });

    it("ignores a Redeemed event from any other contract (a forged token can't mint credit)", async () => {
      const u = await account();
      const hash = tx();
      const fake = getAddress("0x00000000000000000000000000000000000bad01");
      const out = await redeemFromReceipt(db, receiptClient([redeemedLog(u.wallet, BigInt(9_000_000), 0, hash, fake)]), 42220, hash, ENV);
      expect(out.events).toBe(0);
      expect(await getBalanceMicro(db, u.id)).toBe(0);
    });

    it("ignores a reverted transaction", async () => {
      const u = await account();
      const hash = tx();
      expect((await redeemFromReceipt(db, receiptClient([redeemedLog(u.wallet, BigInt(1), 0, hash)], "reverted"), 42220, hash, ENV)).events).toBe(0);
    });

    it("says so when no contract is set for the chain", async () => {
      await expect(redeemFromReceipt(db, receiptClient([]), 11142220, tx(), ENV)).rejects.toMatchObject({ code: "credits_not_configured" });
    });
  });

  describe("background sync", () => {
    it("picks up redemptions nobody reported, and a second pass changes nothing", async () => {
      const u = await account();
      const hash = tx();
      const l = redeemedLog(u.wallet, BigInt(1_234_567), 3, hash, CONTRACT, BigInt(500));
      const client = {
        getBlockNumber: async () => BigInt(600),
        getContractEvents: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
          l.blockNumber >= fromBlock && l.blockNumber <= toBlock ? [{ ...l, args: { account: getAddress(u.wallet), credits: BigInt(1_234_567), ref: pad("0x01") } }] : [],
      } as never;
      const env = { ...ENV, CREDITS_START_BLOCK_42220: "400" } as NodeJS.ProcessEnv;
      expect((await syncRedemptions(db, client, 42220, env)).events).toBeGreaterThanOrEqual(1);
      await syncRedemptions(db, client, 42220, env);
      expect(await getBalanceMicro(db, u.id)).toBe(1_234_567);
      const rows = await db.select().from(onchainCreditEvents).where(eq(onchainCreditEvents.wallet, u.wallet));
      expect(rows).toHaveLength(1);
    });

    // GB-01 (Daybreak Blue review): the scan keeps its own checkpoint, so neither an empty stretch nor an
    // out-of-order direct receipt can stop a payment nobody reported from being credited.
    let nextChain = 900_001;
    const chainScan = (events: { wallet: string; units: bigint; block: bigint; hash: Hex; logIndex?: number }[], head: bigint, failFrom?: bigint) => {
      const chainId = nextChain++;
      const env = { [`CREDITS_CONTRACT_${chainId}`]: CONTRACT, [`CREDITS_START_BLOCK_${chainId}`]: "1000" } as unknown as NodeJS.ProcessEnv;
      const ranges: [bigint, bigint][] = [];
      const client = {
        getBlockNumber: async () => head,
        getContractEvents: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
          if (failFrom !== undefined && toBlock >= failFrom) throw new Error("rpc down");
          ranges.push([fromBlock, toBlock]);
          return events
            .filter((e) => e.block >= fromBlock && e.block <= toBlock)
            .map((e) => ({ ...redeemedLog(e.wallet, e.units, e.logIndex ?? 0, e.hash, CONTRACT, e.block), args: { account: getAddress(e.wallet), credits: e.units, ref: pad("0x01") } }));
        },
      } as never;
      return { chainId, env, client, ranges };
    };

    it("crosses an empty stretch longer than one call and reaches a payment after it", async () => {
      const u = await account();
      const late = { wallet: u.wallet, units: BigInt(700_000), block: BigInt(1000 + 120_000), hash: tx() };
      const { chainId, env, client } = chainScan([late], BigInt(1000 + 130_000));
      for (let i = 0; i < 4; i++) await syncRedemptions(db, client, chainId, env);
      expect(await getBalanceMicro(db, u.id)).toBe(700_000);
      expect(await syncCursor(db, chainId)).toBe(1000 + 130_000);
    });

    it("still credits an older unreported payment after a newer one was reported directly", async () => {
      const older = await account();
      const newer = await account();
      const oldPay = { wallet: older.wallet, units: BigInt(300_000), block: BigInt(5_000), hash: tx() };
      const newPay = { wallet: newer.wallet, units: BigInt(400_000), block: BigInt(9_000), hash: tx() };
      const { chainId, env, client } = chainScan([oldPay, newPay], BigInt(10_000));
      // The newer buyer's browser reported first; the older buyer closed the tab.
      await recordRedemption(db, { chainId, txHash: newPay.hash, logIndex: 0, blockNumber: Number(newPay.block), wallet: newer.wallet, amountMicro: 400_000 });
      await syncRedemptions(db, client, chainId, env);
      expect(await getBalanceMicro(db, older.id)).toBe(300_000);
      expect(await getBalanceMicro(db, newer.id)).toBe(400_000);
    });

    it("credits exactly once across overlapping scans, re-reads and a direct receipt", async () => {
      const u = await account();
      const pay = { wallet: u.wallet, units: BigInt(250_000), block: BigInt(1_990), hash: tx() };
      const { chainId, env, client, ranges } = chainScan([pay], BigInt(2_000));
      await syncRedemptions(db, client, chainId, env);
      await recordRedemption(db, { chainId, txHash: pay.hash, logIndex: 0, blockNumber: 1_990, wallet: u.wallet, amountMicro: 250_000 });
      await syncRedemptions(db, client, chainId, env);
      await syncRedemptions(db, client, chainId, env);
      expect(await getBalanceMicro(db, u.id)).toBe(250_000);
      // Later scans step back SYNC_REORG_OVERLAP blocks, so the payment's block is read again.
      expect(ranges.at(-1)).toEqual([BigInt(2_000) + BigInt(1) - SYNC_REORG_OVERLAP, BigInt(2_000)]);
      const rows = await db.select().from(onchainCreditEvents).where(eq(onchainCreditEvents.wallet, u.wallet));
      expect(rows).toHaveLength(1);
    });

    it("keeps the checkpoint at the last chunk fully read when the node fails part-way", async () => {
      const { chainId, env, client } = chainScan([], BigInt(20_000), BigInt(1000 + 6_000));
      await expect(syncRedemptions(db, client, chainId, env)).rejects.toThrow("rpc down");
      // Chunks 1000-2999, 3000-4999 and 5000-6999 were read; the one reaching block 7000 failed.
      expect(await syncCursor(db, chainId)).toBe(6_999);
    });

    it("never moves the checkpoint backward", async () => {
      const ahead = chainScan([], BigInt(30_000));
      await syncRedemptions(db, ahead.client, ahead.chainId, ahead.env);
      const behind = { ...chainScan([], BigInt(5_000)), chainId: ahead.chainId, env: ahead.env };
      await syncRedemptions(db, behind.client, behind.chainId, behind.env);
      expect(await syncCursor(db, ahead.chainId)).toBe(30_000);
    });

    it("does nothing for a chain with no contract", async () => {
      expect(await syncRedemptions(db, {} as never, 11142220, {} as NodeJS.ProcessEnv)).toEqual({ scanned: 0, events: 0 });
    });
  });

  it("reads the contract address only when it is a real address", () => {
    expect(creditsContract(42220, { CREDITS_CONTRACT_42220: "nope" } as never)).toBeNull();
    expect(creditsContract(42220, {} as never)).toBeNull();
    expect(creditsContract(42220, ENV)).toBe(CONTRACT);
  });
});
