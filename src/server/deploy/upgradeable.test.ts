// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getAddress, pad, type Address, type Hex } from "viem";

import { ADMIN_SLOT, IMPLEMENTATION_SLOT } from "@/lib/deploy/upgradeable";
import { DeployError } from "./deploy-error";
import { minedTx, readProxyAt } from "./upgradeable";

/**
 * Celo's public RPC is load-balanced. Right after a transaction is mined, the node that answers may not
 * have that block yet (the Celo Sepolia live test, 6 Nov 2026). These fakes answer like that node.
 */

const PROXY = getAddress("0x0000000000000000000000000000000000000abc");
const CODE = getAddress("0x00000000000000000000000000000000000c0de0");
const OLD = getAddress("0x00000000000000000000000000000000000001d0");
const ADMIN = getAddress("0x0000000000000000000000000000000000000adc");
const OTHER = getAddress("0x0000000000000000000000000000000000000bad");
const word = (a: Address) => pad(a, { size: 32 });
const ZERO = word("0x0000000000000000000000000000000000000000");
const HASH = `0x${"11".repeat(32)}` as Hex;

/** Answers `behind` reads the way a lagging node does (an error, then the state before the block), then the real state. */
function laggingRpc(live: Address, behind: number, stale: Hex = ZERO) {
  const blocks: Array<bigint | undefined> = [];
  let reads = 0;
  const client = {
    getStorageAt: async ({ slot, blockNumber }: { address: Address; slot: Hex; blockNumber?: bigint }) => {
      blocks.push(blockNumber);
      const attempt = Math.floor(reads++ / 2); // impl and admin are read together
      if (attempt < behind) {
        if (attempt % 2 === 0) throw new Error("header not found");
        return slot === IMPLEMENTATION_SLOT ? stale : word(ADMIN);
      }
      return slot === ADMIN_SLOT ? word(ADMIN) : word(live);
    },
  };
  return { client, blocks, attempts: () => Math.ceil(reads / 2) };
}

const instant = { sleep: async () => undefined };

describe("reading a proxy right after its transaction is mined", () => {
  it("reads at the transaction's block and waits until the node has it", async () => {
    const rpc = laggingRpc(CODE, 3);
    const naps: number[] = [];
    const live = await readProxyAt(rpc.client, PROXY, { blockNumber: BigInt(42), expected: CODE }, { sleep: async (ms) => void naps.push(ms) });
    expect(live).toEqual({ implementation: CODE, admin: ADMIN });
    expect(rpc.attempts()).toBe(4);
    expect(new Set(rpc.blocks)).toEqual(new Set([BigInt(42)]));
    expect(naps).toEqual([500, 1000, 2000]); // backs off
  });

  it("treats the old code as not caught up yet during an upgrade", async () => {
    const rpc = laggingRpc(CODE, 2, word(OLD));
    const live = await readProxyAt(rpc.client, PROXY, { blockNumber: BigInt(9), expected: CODE, stale: [OLD] }, instant);
    expect(live.implementation).toBe(CODE);
  });

  it("answers at once when the proxy really points at other code, so a wrong upgrade isn't retried", async () => {
    const rpc = laggingRpc(OTHER, 0);
    const live = await readProxyAt(rpc.client, PROXY, { blockNumber: BigInt(9), expected: CODE, stale: [OLD] }, instant);
    expect(live.implementation).toBe(OTHER);
    expect(rpc.attempts()).toBe(1);
  });

  it("gives up within its bound with a retryable error, not wrong_upgrade", async () => {
    const rpc = laggingRpc(CODE, 1000);
    const naps: number[] = [];
    const error = await readProxyAt(rpc.client, PROXY, { blockNumber: BigInt(9), expected: CODE }, { timeoutMs: 10_000, sleep: async (ms) => void naps.push(ms) }).catch((e) => e);
    expect(error).toBeInstanceOf(DeployError);
    expect((error as DeployError).code).toBe("chain_read_failed");
    expect(naps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10_000 + 4000);
  });
});

describe("a mined transaction on a lagging node", () => {
  const receipt = { status: "success" as const, blockNumber: BigInt(9), contractAddress: null };
  const tx = { hash: HASH, from: ADMIN, to: PROXY, input: "0x" as Hex };

  it("waits for the receipt, then keeps asking for the transaction until the node has it", async () => {
    let misses = 2;
    const client = {
      waitForTransactionReceipt: async () => receipt,
      getTransaction: async () => {
        if (misses-- > 0) throw new Error("Transaction with hash not found");
        return tx;
      },
    };
    await expect(minedTx(client as never, HASH, instant)).resolves.toEqual({ receipt, tx });
  });

  it("says the network doesn't know it yet when it never shows up", async () => {
    const client = { waitForTransactionReceipt: async () => receipt, getTransaction: async () => Promise.reject(new Error("not found")) };
    const error = await minedTx(client as never, HASH, { ...instant, timeoutMs: 2000 }).catch((e) => e);
    expect((error as DeployError).code).toBe("tx_not_found");
  });
});
