// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeDeployData, encodeFunctionData, getAddress, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import type { Db } from "@/server/db/client";
import { creditQuotes } from "@/server/db/credit-quotes-schema";
import { users } from "@/server/db/schema";
import { LocalChain } from "@/server/deploy/local-chain";
import { compileCredits, compileTestGd } from "../../../scripts/compile-credits.mjs";
import { getBalanceMicro } from "./ledger";
import { creditsContract } from "./contract-address";
import { redeemFromReceipt, SYNC_CONFIRMATIONS } from "./onchain";
import { issueQuote } from "./quote";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

const ADMIN = getAddress("0x00000000000000000000000000000000000000a1");
const KEY = generatePrivateKey();
const TUPLE = [{ type: "tuple", components: [{ name: "buyer", type: "address" }, { name: "gdAmount", type: "uint256" }, { name: "credits", type: "uint256" }, { name: "bonus", type: "uint256" }, { name: "ref", type: "bytes32" }, { name: "deadline", type: "uint256" }] }, { type: "bytes" }] as const;
const G = BigInt(10) ** BigInt(18);

/** The seam: quote from the server code -> pay on a real EVM running the real contract -> the receipt credits the ledger once. */
describe.each(testBackends())("purchase flow on $name", (backend) => {
  let database: TestDatabase;
  let db: Db;
  beforeAll(async () => {
    database = await backend.open();
    db = database.db;
    await database.migrate(MIGRATIONS);
  }, 120_000);
  afterAll(async () => database?.close());

  it("a quoted G$ purchase credits the ledger exactly once and marks the quote paid", async () => {
    const c = compileCredits() as { abi: Abi; bytecode: Hex };
    const g = compileTestGd() as { abi: Abi; bytecode: Hex };
    const chain = await LocalChain.start();
    const buyer = getAddress(`0x${randomUUID().replaceAll("-", "").padEnd(40, "0").slice(0, 40)}`);
    const gd = chain.receipts.get(await chain.send({ from: ADMIN, data: encodeDeployData({ abi: g.abi, bytecode: g.bytecode }) }))!.contractAddress!;
    const token = chain.receipts.get(await chain.send({ from: ADMIN, data: encodeDeployData({ abi: c.abi, bytecode: c.bytecode, args: [ADMIN, gd, privateKeyToAccount(KEY).address, BigInt(1_000_000_000)] }) }))!.contractAddress!;
    // The test faucet gives 1,000 G$, and a real 10-credit pack costs ~93,000, so price G$ at $0.01: 10 credits is about 1,050 G$.
    // Pay with whatever the faucet gave over a few days: claim, then mint is not possible, so use a priced pack that fits.
    const env = { CREDITS_CONTRACT_1: token, CREDITS_QUOTE_SIGNER_KEY: KEY, CREDITS_PRICE_BUFFER_BPS: "0" } as unknown as NodeJS.ProcessEnv;
    expect(creditsContract(1, env)).toBe(token);
    await chain.send({ from: buyer, to: gd, data: encodeFunctionData({ abi: g.abi, functionName: "faucet" }) });

    const [user] = await db.insert(users).values({ wallet: buyer.toLowerCase() }).returning();
    const price = (async () => new Response(JSON.stringify({ gooddollar: { usd: 0.01 } }))) as unknown as typeof fetch;
    const signed = await issueQuote(db, { userId: user.id, wallet: buyer, chainId: 1, amountMicro: 10_000_000, root: null }, { env: { ...env, GD_USD_FALLBACK: "0.01" } as NodeJS.ProcessEnv, fetcher: price, now: new Date(1_749_999_900_000) });
    expect(BigInt(signed.quote.gdAmount)).toBe(BigInt(1000) * G); // $10 at $0.01 per G$ is 1,000 G$

    const q = { buyer: signed.quote.buyer, gdAmount: BigInt(signed.quote.gdAmount), credits: BigInt(signed.quote.credits), bonus: BigInt(signed.quote.bonus), ref: signed.quote.ref as Hex, deadline: BigInt(signed.quote.deadline) };
    const data = encodeAbiParameters(TUPLE, [q, signed.signature]);
    const hash = await chain.send({ from: buyer, to: gd, data: encodeFunctionData({ abi: g.abi, functionName: "transferAndCall", args: [token as Address, q.gdAmount, data] }) });
    expect(chain.receipts.get(hash)!.status).toBe("success");

    // Report a head SYNC_CONFIRMATIONS past the receipt's block, so it is deep enough to credit (GB-13).
    const shim = { getTransactionReceipt: async ({ hash: h }: { hash: Hex }) => chain.receipts.get(h) as never, getBlockNumber: async () => BigInt(chain.receipts.get(hash)!.blockNumber) + SYNC_CONFIRMATIONS };
    const first = await redeemFromReceipt(db, shim, 1, hash, env);
    expect(first).toEqual({ events: 1, creditedMicro: 10_000_000 });
    expect(await getBalanceMicro(db, user.id)).toBe(10_000_000);
    const again = await redeemFromReceipt(db, shim, 1, hash, env);
    expect(again.creditedMicro).toBe(0);
    expect(await getBalanceMicro(db, user.id)).toBe(10_000_000);
    const [row] = await db.select().from(creditQuotes).where(eq(creditQuotes.ref, signed.quote.ref));
    expect(row.paidAt).not.toBeNull();
    expect(row.paidTx).toBe(hash.toLowerCase());
  });

  it("in production only Celo mainnet can sell credits", () => {
    const env = { NODE_ENV: "production", CREDITS_CONTRACT_42220: "0x00000000000000000000000000000000000c0de3", CREDITS_CONTRACT_11142220: "0x00000000000000000000000000000000000c0de4" } as unknown as NodeJS.ProcessEnv;
    expect(creditsContract(42220, env)).not.toBeNull();
    expect(creditsContract(11142220, env)).toBeNull();
    expect(creditsContract(11142220, { ...env, CREDITS_ALLOW_TESTNET: "1" })).not.toBeNull();
  });
});
