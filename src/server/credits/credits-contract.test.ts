// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { encodeDeployData, encodeFunctionData, keccak256, parseEventLogs, toHex, zeroHash, type Abi, type Address, type Hex } from "viem";

import { LocalChain } from "@/server/deploy/local-chain";
import { compileCredits } from "../../../scripts/compile-credits.mjs";

/**
 * GoodBuildCredits on a real EVM running the real compiled bytecode (D51): the money rules the
 * backend relies on are proved here, not assumed.
 */
const OWNER = "0x00000000000000000000000000000000000000a1" as Address;
const TREASURY = "0x00000000000000000000000000000000000000a2" as Address;
const MINTER = "0x00000000000000000000000000000000000000a3" as Address;
const ALICE = "0x00000000000000000000000000000000000000b1" as Address;
const BOB = "0x00000000000000000000000000000000000000b2" as Address;
const CAROL = "0x00000000000000000000000000000000000000b3" as Address;
const PER_CELO = BigInt(70_000); // 0.07 credits... units per CELO (6 decimals)
const MAX = BigInt(100_000_000);
const CELO = BigInt(10) ** BigInt(18);

describe("GoodBuildCredits contract", () => {
  let chain: LocalChain;
  let abi: Abi;
  let token: Address;

  const call = async (from: Address, fn: string, args: unknown[] = [], value = BigInt(0)) => {
    const hash = await chain.send({ from, to: token, data: encodeFunctionData({ abi, functionName: fn, args }), value });
    return chain.receipts.get(hash)!;
  };
  const balance = (a: Address) => chain.read<bigint>(token, abi, "balanceOf", [a]);

  beforeAll(async () => {
    const artifact = compileCredits() as { abi: Abi; bytecode: Hex };
    abi = artifact.abi;
    chain = await LocalChain.start();
    const hash = await chain.send({ from: OWNER, data: encodeDeployData({ abi, bytecode: artifact.bytecode, args: [OWNER, TREASURY, PER_CELO, MAX] }) });
    token = chain.receipts.get(hash)!.contractAddress!;
    await call(OWNER, "setMinter", [MINTER, true]);
  });

  it("has 6 decimals and the agreed name", async () => {
    expect(await chain.read(token, abi, "decimals")).toBe(6);
    expect(await chain.read(token, abi, "symbol")).toBe("GBC");
  });

  it("purchase mints at the rate and sends the CELO to the treasury", async () => {
    const r = await call(ALICE, "purchase", [], CELO);
    expect(r.status).toBe("success");
    expect(await balance(ALICE)).toBe(PER_CELO);
    expect(await chain.balance(TREASURY)).toBe(CELO);
    expect(await chain.balance(token)).toBe(BigInt(0)); // the contract never holds money
  });

  it("purchaseAndRedeem credits the ledger in one step: one Redeemed event, no leftover token balance", async () => {
    const before = await balance(CAROL);
    const ref = keccak256(toHex("one-step"));
    const r = await call(CAROL, "purchaseAndRedeem", [ref], CELO);
    expect(r.status).toBe("success");
    expect(await balance(CAROL)).toBe(before);
    const logs = parseEventLogs({ abi, eventName: "Redeemed", logs: r.logs as never });
    expect(logs).toHaveLength(1);
    expect(logs[0].args).toMatchObject({ account: CAROL, credits: PER_CELO, ref });
    expect(await chain.balance(token)).toBe(BigInt(0));
    expect((await call(CAROL, "purchaseAndRedeem", [ref], BigInt(1))).status).toBe("reverted");
  });

  it("refuses a purchase that buys nothing or more than the cap", async () => {
    expect((await call(ALICE, "purchase", [], BigInt(1))).status).toBe("reverted"); // dust rounds to zero
    expect((await call(ALICE, "purchase", [], BigInt(2000) * CELO)).status).toBe("reverted"); // 140,000,000 > cap
  });

  it("cannot be sent between wallets, so a balance stays with its wallet", async () => {
    expect((await call(ALICE, "transfer", [BOB, BigInt(1)])).status).toBe("reverted");
    await call(ALICE, "approve", [BOB, BigInt(10)]);
    expect((await call(BOB, "transferFrom", [ALICE, BOB, BigInt(1)])).status).toBe("reverted");
    expect(await balance(BOB)).toBe(BigInt(0));
  });

  it("only a minter can mint, and the cap applies to it", async () => {
    expect((await call(ALICE, "mint", [ALICE, BigInt(5), zeroHash])).status).toBe("reverted");
    expect((await call(MINTER, "mint", [BOB, MAX + BigInt(1), zeroHash])).status).toBe("reverted");
    const ref = keccak256(toHex("order-1"));
    expect((await call(MINTER, "mint", [BOB, BigInt(2_500_000), ref])).status).toBe("success");
    expect(await balance(BOB)).toBe(BigInt(2_500_000));
    await call(OWNER, "setMinter", [MINTER, false]);
    expect((await call(MINTER, "mint", [BOB, BigInt(1), ref])).status).toBe("reverted");
    await call(OWNER, "setMinter", [MINTER, true]);
  });

  it("redeem burns the balance and emits exactly one Redeemed event for the wallet", async () => {
    const ref = keccak256(toHex("r1"));
    const r = await call(BOB, "redeem", [BigInt(1_000_000), ref]);
    expect(r.status).toBe("success");
    expect(await balance(BOB)).toBe(BigInt(1_500_000));
    const logs = parseEventLogs({ abi, eventName: "Redeemed", logs: r.logs as never });
    expect(logs).toHaveLength(1);
    expect(logs[0].args).toMatchObject({ account: BOB, credits: BigInt(1_000_000), ref });
  });

  it("refuses to redeem more than the wallet holds, or nothing", async () => {
    expect((await call(BOB, "redeem", [BigInt(99_000_000), zeroHash])).status).toBe("reverted");
    expect((await call(BOB, "redeem", [BigInt(0), zeroHash])).status).toBe("reverted");
    expect(await balance(BOB)).toBe(BigInt(1_500_000));
  });

  it("pause stops buying and minting but never traps credit: redeem still works", async () => {
    await call(OWNER, "pause");
    expect((await call(ALICE, "purchase", [], CELO)).status).toBe("reverted");
    expect((await call(MINTER, "mint", [BOB, BigInt(1), zeroHash])).status).toBe("reverted");
    expect((await call(BOB, "redeem", [BigInt(500_000), zeroHash])).status).toBe("success");
    await call(OWNER, "unpause");
    expect((await call(ALICE, "purchase", [], CELO)).status).toBe("success");
  });

  it("only the owner sets the rate, treasury, cap and minters; ownership can't be renounced", async () => {
    for (const [fn, args] of [
      ["setCreditsPerCelo", [BigInt(1)]],
      ["setTreasury", [ALICE]],
      ["setMaxPerMint", [BigInt(1)]],
      ["setMinter", [ALICE, true]],
      ["pause", []],
    ] as const) {
      expect((await call(ALICE, fn, [...args])).status, fn).toBe("reverted");
    }
    expect((await call(OWNER, "renounceOwnership")).status).toBe("reverted");
    expect((await call(OWNER, "setCreditsPerCelo", [BigInt(0)])).status).toBe("reverted");
  });
});
