// @vitest-environment node
// Run against main at 8a2a7b0 before the fix (with N = 30 and K = 1,800 written in place of the imports), 13 of these 14 failed; see D111.
// GB-13 (security sweep, 14 Nov 2026): the credits scanner and ledger. Each claim in the sweep is a test here.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, like, sql } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex } from "viem";

import type { Db } from "@/server/db/client";
import { onchainCreditEvents } from "@/server/db/onchain-credits-schema";
import { ledgerEntries, users } from "@/server/db/schema";
import { getBalanceMicro } from "./ledger";
import { CREDITS_ABI, creditPendingForWallet, recordRedemption, redeemFromReceipt, SYNC_CHECKPOINT_LAG as K, SYNC_CONFIRMATIONS as N, syncCursor, syncRedemptions } from "./onchain";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

const CONTRACT = getAddress("0x00000000000000000000000000000000000c0de1");
const hex = (bytes: number) => `0x${randomUUID().replaceAll("-", "").repeat(2).slice(0, bytes * 2)}` as Hex;
const newWallet = () => hex(20).toLowerCase();
const tx = () => hex(32);
const ref = () => hex(32).toLowerCase() as Hex;

function rawLog(e: { wallet: string; units: bigint; logIndex: number; hash: Hex; block: bigint; ref: Hex }) {
  return {
    address: CONTRACT,
    topics: encodeEventTopics({ abi: CREDITS_ABI, eventName: "Redeemed", args: { account: getAddress(e.wallet) } }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [e.units, e.ref]),
    logIndex: e.logIndex,
    blockNumber: e.block,
    transactionHash: e.hash,
  };
}

describe.each(testBackends())("GB-13 on $name", (backend) => {
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
  const ledgerCount = async (userId: string) => (await db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId))).length;

  let nextChain = 910_001;
  type Ev = { wallet: string; units: bigint; block: bigint; hash: Hex; logIndex?: number; ref: Hex };
  /** A chain whose log node can lag `lag()` blocks behind the head the other node reports. */
  const chain = (events: Ev[], opts: { head: () => bigint; lag?: () => bigint; raw?: (from: bigint, to: bigint) => unknown[]; start?: bigint }) => {
    const chainId = nextChain++;
    const env = { [`CREDITS_CONTRACT_${chainId}`]: CONTRACT, [`CREDITS_START_BLOCK_${chainId}`]: String(opts.start ?? BigInt(1000)) } as unknown as NodeJS.ProcessEnv;
    const client = {
      getBlockNumber: async () => opts.head(),
      getContractEvents: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        const seen = opts.head() - (opts.lag?.() ?? BigInt(0));
        const real = events
          .filter((e) => e.block >= fromBlock && e.block <= toBlock && e.block <= seen)
          .map((e) => ({ ...rawLog({ ...e, logIndex: e.logIndex ?? 0 }), args: { account: getAddress(e.wallet), credits: e.units, ref: e.ref } }));
        return [...(opts.raw?.(fromBlock, toBlock) ?? []), ...real];
      },
    } as never;
    return { chainId, env, client };
  };

  it("(a) a reorg that re-includes one transaction at another log index credits it once", async () => {
    const u = await account();
    const hash = tx();
    const r = ref();
    await recordRedemption(db, { chainId: 42220, txHash: hash, logIndex: 0, blockNumber: 100, wallet: u.wallet, amountMicro: 500_000, ref: r });
    await recordRedemption(db, { chainId: 42220, txHash: hash, logIndex: 3, blockNumber: 101, wallet: u.wallet, amountMicro: 500_000, ref: r });
    expect(await getBalanceMicro(db, u.id)).toBe(500_000);
    expect(await ledgerCount(u.id)).toBe(1);
  });

  it("(b) one quote ref paid by two transactions (the first dropped) credits once", async () => {
    const u = await account();
    const r = ref();
    await recordRedemption(db, { chainId: 42220, txHash: tx(), logIndex: 0, blockNumber: 200, wallet: u.wallet, amountMicro: 800_000, ref: r });
    const second = await recordRedemption(db, { chainId: 42220, txHash: tx(), logIndex: 0, blockNumber: 260, wallet: u.wallet, amountMicro: 800_000, ref: r });
    expect(second.credited).toBe(false);
    expect(await getBalanceMicro(db, u.id)).toBe(800_000);
    expect(await ledgerCount(u.id)).toBe(1);
  });

  it("(b) the same ref arriving with a different amount is not credited again and doesn't throw", async () => {
    const u = await account();
    const r = ref();
    await recordRedemption(db, { chainId: 42220, txHash: tx(), logIndex: 0, blockNumber: 300, wallet: u.wallet, amountMicro: 100, ref: r });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const odd = await recordRedemption(db, { chainId: 42220, txHash: tx(), logIndex: 0, blockNumber: 301, wallet: u.wallet, amountMicro: 999, ref: r });
    warn.mockRestore();
    expect(odd.credited).toBe(false);
    expect(await getBalanceMicro(db, u.id)).toBe(100);
  });

  it("(b) concurrent copies of one ref at different transactions credit once", async () => {
    const u = await account();
    const r = ref();
    const results = await Promise.all([0, 1, 2, 3].map((i) => recordRedemption(db, { chainId: 42220, txHash: tx(), logIndex: i, blockNumber: 400 + i, wallet: u.wallet, amountMicro: 4_000, ref: r })));
    expect(results.filter((x) => x.credited)).toHaveLength(1);
    expect(await getBalanceMicro(db, u.id)).toBe(4_000);
  });

  describe("(c) confirmation depth", () => {
    const receipts = (log: ReturnType<typeof rawLog>, head: () => bigint) => ({ getTransactionReceipt: async () => ({ status: "success", blockNumber: log.blockNumber, logs: [log] }), getBlockNumber: async () => head() }) as never;
    const env = { CREDITS_CONTRACT_42220: CONTRACT } as unknown as NodeJS.ProcessEnv;

    it("a receipt shallower than N blocks is pending and credits nothing; at N it credits", async () => {
      const u = await account();
      const hash = tx();
      const block = BigInt(5_000_000);
      let head = block;
      const client = receipts(rawLog({ wallet: u.wallet, units: BigInt(1_000), logIndex: 0, hash, block, ref: ref() }), () => head);
      const early = await redeemFromReceipt(db, client, 42220, hash, env);
      expect(early).toMatchObject({ pending: true, creditedMicro: 0 });
      expect(await getBalanceMicro(db, u.id)).toBe(0);
      head = block + N - BigInt(1);
      expect(await redeemFromReceipt(db, client, 42220, hash, env)).toMatchObject({ pending: true });
      head = block + N;
      expect(await redeemFromReceipt(db, client, 42220, hash, env)).toEqual({ events: 1, creditedMicro: 1_000 });
      expect(await getBalanceMicro(db, u.id)).toBe(1_000);
    });

    it("the scanner credits only events at least N blocks deep, then credits them once they are", async () => {
      const u = await account();
      let head = BigInt(10_000);
      const pay = { wallet: u.wallet, units: BigInt(2_000), block: head - BigInt(2), hash: tx(), ref: ref() };
      const s = chain([pay], { head: () => head });
      await syncRedemptions(db, s.client, s.chainId, s.env);
      expect(await getBalanceMicro(db, u.id)).toBe(0);
      head = pay.block + N;
      await syncRedemptions(db, s.client, s.chainId, s.env);
      expect(await getBalanceMicro(db, u.id)).toBe(2_000);
    });
  });

  describe("(d) a log node that lags behind head", () => {
    it("can't make the checkpoint skip a payment it hadn't seen yet", async () => {
      const u = await account();
      let head = BigInt(100_000);
      let lag = BigInt(200); // more than the old 64-block overlap, less than K
      const pay = { wallet: u.wallet, units: BigInt(3_000), block: head - BigInt(150), hash: tx(), ref: ref() };
      const s = chain([pay], { head: () => head, lag: () => lag, start: head - BigInt(5_000) });
      await syncRedemptions(db, s.client, s.chainId, s.env);
      expect(await getBalanceMicro(db, u.id)).toBe(0); // the log node hadn't reached it
      head += BigInt(60);
      lag = BigInt(0); // caught up
      await syncRedemptions(db, s.client, s.chainId, s.env);
      expect(await getBalanceMicro(db, u.id)).toBe(3_000);
    });

    it("the checkpoint never passes head - K", async () => {
      const head = BigInt(200_000);
      const s = chain([], { head: () => head });
      for (let i = 0; i < 5; i++) await syncRedemptions(db, s.client, s.chainId, s.env);
      expect(await syncCursor(db, s.chainId)).toBe(Number(head - K));
    });
  });

  it("(e) a malformed log is logged and skipped, and the checkpoint still moves past it", async () => {
    const u = await account();
    const head = BigInt(10_000);
    const good = { wallet: u.wallet, units: BigInt(5_000), block: BigInt(1_500), hash: tx(), ref: ref() };
    const poison = (from: bigint, to: bigint) =>
      BigInt(1_400) >= from && BigInt(1_400) <= to
        ? [{ ...rawLog({ ...good, logIndex: 0, units: BigInt(2) ** BigInt(80), block: BigInt(1_400), hash: tx() }), args: { account: getAddress(newWallet()), credits: BigInt(2) ** BigInt(80), ref: ref() } }]
        : [];
    const s = chain([good], { head: () => head, raw: poison });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await syncRedemptions(db, s.client, s.chainId, s.env);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    expect(await getBalanceMicro(db, u.id)).toBe(5_000);
    expect(await syncCursor(db, s.chainId)).toBe(Number(head - K));
  });

  describe("migration: the ref column", () => {
    it("a row recorded before the ref column (no ref) still credits, on its old key", async () => {
      const wallet = newWallet();
      const hash = tx().toLowerCase();
      await db.insert(onchainCreditEvents).values({ chainId: 42220, txHash: hash, logIndex: 2, blockNumber: 7, wallet, amountMicro: 6_000 });
      const u = await account(wallet);
      expect(await creditPendingForWallet(db, wallet)).toBe(6_000);
      const [entry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, u.id));
      expect(entry.idempotencyKey).toBe(`onchain:42220:${hash}:2`);
    });

    it("an already-credited row with no ref gets its ref filled when seen again, and isn't credited twice", async () => {
      const u = await account();
      const hash = tx().toLowerCase();
      await db.insert(onchainCreditEvents).values({ chainId: 42220, txHash: hash, logIndex: 0, blockNumber: 8, wallet: u.wallet, amountMicro: 7_000 });
      await creditPendingForWallet(db, u.wallet);
      const r = ref();
      const again = await recordRedemption(db, { chainId: 42220, txHash: hash as Hex, logIndex: 0, blockNumber: 8, wallet: u.wallet, amountMicro: 7_000, ref: r });
      expect(again.credited).toBe(false);
      const [row] = await db.select().from(onchainCreditEvents).where(eq(onchainCreditEvents.txHash, hash));
      expect(row.ref).toBe(r);
      expect(await getBalanceMicro(db, u.id)).toBe(7_000);
      expect(await ledgerCount(u.id)).toBe(1);
    });

    it("new credits are keyed on the quote ref", async () => {
      const u = await account();
      const r = ref();
      await recordRedemption(db, { chainId: 42220, txHash: tx(), logIndex: 0, blockNumber: 9, wallet: u.wallet, amountMicro: 1, ref: r });
      expect(await db.select().from(ledgerEntries).where(like(ledgerEntries.idempotencyKey, `onchain:42220:${r}`))).toHaveLength(1);
    });

    it("two event rows can't share a (chain, ref), but rows with no ref and other chains can", async () => {
      const r = ref();
      const row = (over: Record<string, unknown>) => sql`insert into onchain_credit_events (chain_id, tx_hash, log_index, block_number, wallet, amount_micro, ref) values (${over.chain ?? 42220}, ${tx()}, 0, 1, ${newWallet()}, 1, ${over.ref ?? null})`;
      await db.execute(row({ ref: r }));
      await expect(db.execute(row({ ref: r }))).rejects.toThrow();
      await db.execute(row({ ref: r, chain: 11142220 }));
      await db.execute(row({}));
      await db.execute(row({}));
    });
  });

  it("a redemption from the chain must carry a ref", async () => {
    await expect(recordRedemption(db, { chainId: 42220, txHash: tx(), logIndex: 0, blockNumber: 1, wallet: newWallet(), amountMicro: 1 } as never)).rejects.toThrow();
  });
});
