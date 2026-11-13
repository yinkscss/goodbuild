import { describe, expect, it, vi } from "vitest";
import { getContractAddress, type Address, type Hex } from "viem";

import { checkSentTx, type ReconcileClient } from "./reconcile";

const ME: Address = "0x7a3000000000000000000000000000000000e41c";
const HASH = `0x${"aa".repeat(32)}` as Hex;
const named = (name: string) => Object.assign(new Error(name), { name });

function client(over: Partial<ReconcileClient> = {}): ReconcileClient {
  return {
    getTransactionReceipt: vi.fn(async () => Promise.reject(named("TransactionReceiptNotFoundError"))),
    getTransaction: vi.fn(async () => Promise.reject(named("TransactionNotFoundError"))),
    getTransactionCount: vi.fn(async () => 4),
    getCode: vi.fn(async () => undefined),
    ...over,
  };
}

describe("checkSentTx (GB-03)", () => {
  it("mined: it has a receipt", async () => {
    expect(await checkSentTx(client({ getTransactionReceipt: async () => ({}) }), { hash: HASH, account: ME, nonce: 4, creation: true })).toEqual({ kind: "mined" });
  });

  it("pending: the node knows it but it has no receipt yet", async () => {
    expect(await checkSentTx(client({ getTransaction: async () => ({}) }), { hash: HASH, account: ME, nonce: 4, creation: true })).toEqual({ kind: "pending" });
  });

  it("dropped: unknown, and its nonce is still free", async () => {
    expect(await checkSentTx(client(), { hash: HASH, account: ME, nonce: 4, creation: true })).toEqual({ kind: "dropped", nonce: 4 });
  });

  it("replaced: its nonce was used, and the contract that nonce makes exists (or doesn't)", async () => {
    const made = getContractAddress({ from: ME, nonce: BigInt(4) });
    const getCode = vi.fn(async () => "0x6080" as Hex);
    expect(await checkSentTx(client({ getTransactionCount: async () => 5, getCode }), { hash: HASH, account: ME, nonce: 4, creation: true })).toEqual({ kind: "replaced", contract: made });
    expect(getCode).toHaveBeenCalledWith({ address: made });
    expect(await checkSentTx(client({ getTransactionCount: async () => 5, getCode: async () => "0x" as Hex }), { hash: HASH, account: ME, nonce: 4, creation: true })).toEqual({ kind: "replaced", contract: null });
    expect(await checkSentTx(client({ getTransactionCount: async () => 5 }), { hash: HASH, account: ME, nonce: 4, creation: false })).toEqual({ kind: "replaced", contract: null });
  });

  it("unknown: no nonce saved, so it can't tell", async () => {
    expect(await checkSentTx(client(), { hash: HASH, account: ME, creation: true })).toEqual({ kind: "unknown" });
  });

  it("lets a network failure surface instead of treating it as dropped", async () => {
    await expect(checkSentTx(client({ getTransactionReceipt: async () => Promise.reject(new Error("fetch failed")) }), { hash: HASH, account: ME, nonce: 4, creation: true })).rejects.toThrow("fetch failed");
    await expect(checkSentTx(client({ getTransaction: async () => Promise.reject(new Error("fetch failed")) }), { hash: HASH, account: ME, nonce: 4, creation: true })).rejects.toThrow("fetch failed");
  });
});
