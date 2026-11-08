// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { encodeAbiParameters, getAddress, encodeDeployData, encodeFunctionData, keccak256, parseEventLogs, toHex, zeroAddress, zeroHash, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { LocalChain } from "@/server/deploy/local-chain";
import { compileCredits, compileTestGd } from "../../../scripts/compile-credits.mjs";

/**
 * GoodBuildCredits v2 on a real EVM running the real compiled bytecode (D56): fixed supply, G$ paid
 * against a server-signed quote, an admin who can withdraw. The money rules the backend relies on are
 * proved here, not assumed.
 */
const ADMIN = getAddress("0x00000000000000000000000000000000000000a1");
const ALICE = getAddress("0x00000000000000000000000000000000000000b1");
const BOB = getAddress("0x00000000000000000000000000000000000000b2");
const OUT = getAddress("0x00000000000000000000000000000000000000c1");
const SUPPLY = BigInt(10_000_000) * BigInt(1_000_000);
const MAX = BigInt(1_000) * BigInt(1_000_000);
const NOW = 1_750_000_000;
const G = BigInt(10) ** BigInt(18);

const signer = privateKeyToAccount(generatePrivateKey());
const QUOTE_TYPES = {
  Quote: [
    { name: "buyer", type: "address" },
    { name: "gdAmount", type: "uint256" },
    { name: "credits", type: "uint256" },
    { name: "bonus", type: "uint256" },
    { name: "ref", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const QUOTE_TUPLE = [{ type: "tuple", components: QUOTE_TYPES.Quote }, { type: "bytes" }] as const;

describe("GoodBuildCredits contract (v2)", () => {
  let chain: LocalChain;
  let abi: Abi;
  let gdAbi: Abi;
  let token: Address;
  let gd: Address;
  let n = 0;

  const call = async (from: Address, to: Address, a: Abi, fn: string, args: unknown[] = [], value = BigInt(0)) => {
    const hash = await chain.send({ from, to, data: encodeFunctionData({ abi: a, functionName: fn, args }), value });
    return chain.receipts.get(hash)!;
  };
  const credits = (from: Address, fn: string, args: unknown[] = []) => call(from, token, abi, fn, args);
  const gdCall = (from: Address, fn: string, args: unknown[] = []) => call(from, gd, gdAbi, fn, args);
  const inventory = () => chain.read<bigint>(token, abi, "balanceOf", [token]);
  const gdBalance = (a: Address) => chain.read<bigint>(gd, gdAbi, "balanceOf", [a]);

  async function quote(over: Partial<{ buyer: Address; gdAmount: bigint; credits: bigint; bonus: bigint; ref: Hex; deadline: bigint }> = {}, signWith = signer) {
    const message = {
      buyer: ALICE,
      gdAmount: BigInt(100) * G,
      credits: BigInt(10_000_000),
      bonus: BigInt(0),
      ref: keccak256(toHex(`q${++n}`)),
      deadline: BigInt(NOW + 300),
      ...over,
    };
    const signature = await signWith.signTypedData({ domain: { name: "GoodBuild Credits", version: "1", chainId: 1, verifyingContract: token }, types: QUOTE_TYPES, primaryType: "Quote", message });
    return { message, signature };
  }

  /** Pay in one signature: G$ transferAndCall into the credits contract with the quote as data. */
  const pay = (from: Address, q: Awaited<ReturnType<typeof quote>>, amount = q.message.gdAmount) =>
    gdCall(from, "transferAndCall", [token, amount, encodeAbiParameters(QUOTE_TUPLE, [q.message, q.signature])]);

  beforeAll(async () => {
    const c = compileCredits() as { abi: Abi; bytecode: Hex };
    const g = compileTestGd() as { abi: Abi; bytecode: Hex };
    abi = c.abi;
    gdAbi = g.abi;
    chain = await LocalChain.start();
    gd = chain.receipts.get(await chain.send({ from: ADMIN, data: encodeDeployData({ abi: gdAbi, bytecode: g.bytecode }) }))!.contractAddress!;
    token = chain.receipts.get(await chain.send({ from: ADMIN, data: encodeDeployData({ abi, bytecode: c.bytecode, args: [ADMIN, gd, signer.address, MAX] }) }))!.contractAddress!;
    for (const who of [ALICE, BOB]) await gdCall(who, "faucet");
  });

  it("starts with a fixed 10,000,000 credits, all held by the contract for sale", async () => {
    expect(await chain.read(token, abi, "decimals")).toBe(6);
    expect(await chain.read(token, abi, "symbol")).toBe("GBC");
    expect(await chain.read(token, abi, "totalSupply")).toBe(SUPPLY);
    expect(await inventory()).toBe(SUPPLY);
    expect(await chain.read(token, abi, "owner")).toBe(ADMIN);
  });

  it("sells credits for G$ against a signed quote: takes the G$, burns inventory, emits one Redeemed", async () => {
    const q = await quote({ bonus: BigInt(1_000_000) });
    const before = await gdBalance(ALICE);
    const r = await pay(ALICE, q);
    expect(r.status).toBe("success");
    expect(before - (await gdBalance(ALICE))).toBe(q.message.gdAmount);
    expect(await gdBalance(token)).toBe(q.message.gdAmount);
    expect(await inventory()).toBe(SUPPLY - BigInt(11_000_000));
    expect(await chain.read(token, abi, "totalSupply")).toBe(SUPPLY - BigInt(11_000_000));
    const logs = parseEventLogs({ abi, eventName: "Redeemed", logs: r.logs as never });
    expect(logs).toHaveLength(1);
    expect(logs[0].args).toMatchObject({ account: ALICE, credits: BigInt(11_000_000), ref: q.message.ref });
    const bought = parseEventLogs({ abi, eventName: "Purchased", logs: r.logs as never });
    expect(bought[0].args).toMatchObject({ account: ALICE, gdPaid: q.message.gdAmount, credits: BigInt(10_000_000), bonus: BigInt(1_000_000) });
  });

  it("also sells through approve then buy, only for the quote's own buyer", async () => {
    const q = await quote({ buyer: BOB });
    await gdCall(BOB, "approve", [token, q.message.gdAmount]);
    expect((await credits(ALICE, "buy", [q.message, q.signature])).status).toBe("reverted");
    expect((await credits(BOB, "buy", [q.message, q.signature])).status).toBe("success");
    expect((await credits(BOB, "buy", [q.message, q.signature])).status).toBe("reverted"); // ref used
  });

  it("refuses a replayed quote, a tampered amount, a wrong signer, an expired quote and a wrong payer", async () => {
    const q = await quote();
    expect((await pay(ALICE, q)).status).toBe("success");
    expect((await pay(ALICE, q)).status).toBe("reverted");

    const cheap = await quote();
    const tampered = { ...cheap, message: { ...cheap.message, gdAmount: BigInt(1) } };
    expect((await pay(ALICE, tampered)).status).toBe("reverted");
    const moreCredits = { ...cheap, message: { ...cheap.message, credits: BigInt(500_000_000) } };
    expect((await pay(ALICE, moreCredits)).status).toBe("reverted");

    const stranger = privateKeyToAccount(generatePrivateKey());
    expect((await pay(ALICE, await quote({}, stranger))).status).toBe("reverted");
    expect((await pay(ALICE, await quote({ deadline: BigInt(NOW - 1) }))).status).toBe("reverted");
    expect((await pay(BOB, await quote({ buyer: ALICE }))).status).toBe("reverted"); // BOB can't spend ALICE's quote
    const q2 = await quote();
    expect((await pay(ALICE, q2, q2.message.gdAmount + BigInt(1))).status).toBe("reverted"); // exact payment only
  });

  it("only the G$ token can call the payment hook", async () => {
    const q = await quote();
    const hook = await call(ALICE, token, [{ type: "function", name: "onTokenTransfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }, { type: "bytes" }], outputs: [{ type: "bool" }] }] as Abi, "onTokenTransfer", [ALICE, q.message.gdAmount, encodeAbiParameters(QUOTE_TUPLE, [q.message, q.signature])]);
    expect(hook.status).toBe("reverted");
  });

  it("caps one quote and never sells more than the inventory", async () => {
    expect((await pay(ALICE, await quote({ credits: MAX + BigInt(1) }))).status).toBe("reverted");
    expect((await pay(ALICE, await quote({ credits: BigInt(0) }))).status).toBe("reverted");
    expect((await pay(ALICE, await quote({ gdAmount: BigInt(0) }))).status).toBe("reverted");
  });

  it("credits cannot be sent between wallets", async () => {
    expect((await credits(ALICE, "transfer", [BOB, BigInt(1)])).status).toBe("reverted");
  });

  it("pause stops buying; the admin can still grant", async () => {
    await credits(ADMIN, "pause");
    expect((await pay(ALICE, await quote())).status).toBe("reverted");
    await credits(ADMIN, "unpause");
    expect((await pay(ALICE, await quote())).status).toBe("success");
  });

  it("the admin can grant credits once per ref, within the cap, to a real wallet", async () => {
    const ref = keccak256(toHex("grant-1"));
    const r = await credits(ADMIN, "grant", [BOB, BigInt(2_000_000), ref]);
    expect(r.status).toBe("success");
    expect(parseEventLogs({ abi, eventName: "Redeemed", logs: r.logs as never })[0].args).toMatchObject({ account: BOB, credits: BigInt(2_000_000), ref });
    expect((await credits(ADMIN, "grant", [BOB, BigInt(1), ref])).status).toBe("reverted");
    expect((await credits(ADMIN, "grant", [zeroAddress, BigInt(1), zeroHash])).status).toBe("reverted");
    expect((await credits(ADMIN, "grant", [BOB, MAX + BigInt(1), zeroHash])).status).toBe("reverted");
    expect((await credits(ALICE, "grant", [ALICE, BigInt(1), keccak256(toHex("x"))])).status).toBe("reverted");
  });

  it("the admin withdraws the G$; nobody else can, and the credits themselves can't be withdrawn", async () => {
    const held = await gdBalance(token);
    expect(held).toBeGreaterThan(BigInt(0));
    expect((await credits(ALICE, "withdraw", [gd, ALICE, held])).status).toBe("reverted");
    expect((await credits(ADMIN, "withdraw", [gd, OUT, held + BigInt(1)])).status).toBe("reverted");
    expect((await credits(ADMIN, "withdraw", [token, OUT, BigInt(1)])).status).toBe("reverted");
    expect((await credits(ADMIN, "withdraw", [gd, OUT, held])).status).toBe("success");
    expect(await gdBalance(OUT)).toBe(held);
    expect(await gdBalance(token)).toBe(BigInt(0));
  });

  it("only the admin sets the signer and cap; ownership is two-step and can't be renounced", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    for (const [fn, args] of [
      ["setQuoteSigner", [other.address]],
      ["setMaxPerQuote", [BigInt(1)]],
      ["pause", []],
      ["unpause", []],
    ] as const) {
      expect((await credits(ALICE, fn, [...args])).status, fn).toBe("reverted");
    }
    expect((await credits(ADMIN, "renounceOwnership")).status).toBe("reverted");
    // Replacing the signer retires every quote the old key signed.
    const stale = await quote();
    await credits(ADMIN, "setQuoteSigner", [other.address]);
    expect((await pay(ALICE, stale)).status).toBe("reverted");
    expect((await pay(ALICE, await quote({}, other))).status).toBe("success");
    await credits(ADMIN, "setQuoteSigner", [signer.address]);
    await credits(ADMIN, "transferOwnership", [BOB]);
    expect(await chain.read(token, abi, "owner")).toBe(ADMIN); // not yet accepted
    await credits(BOB, "acceptOwnership");
    expect(await chain.read(token, abi, "owner")).toBe(BOB);
  });
});
