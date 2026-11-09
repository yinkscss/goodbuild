// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAddress, recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import type { Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { MIN_PURCHASE_MICRO, MAX_PURCHASE_MICRO, gdWeiForMicro, BONUS_CAP_MICRO_PER_MONTH, QuoteError, bonusForPack, gdUsdPrice, gdWeiForPack, issueQuote, markQuotePaid, previewPacks, resetPriceCache } from "./quote";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

const KEY = generatePrivateKey();
const CONTRACT = getAddress("0x00000000000000000000000000000000000c0de2");
const ENV = { CREDITS_CONTRACT_42220: CONTRACT, CREDITS_QUOTE_SIGNER_KEY: KEY } as unknown as NodeJS.ProcessEnv;
const price = (usd: number) => (async () => new Response(JSON.stringify({ gooddollar: { usd } }))) as unknown as typeof fetch;
const newWallet = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0").slice(0, 40)}`;
const G = BigInt(10) ** BigInt(18);

describe("G$ pricing", () => {
  beforeEach(resetPriceCache);

  it("prices a pack in whole G$, rounded up, with the buffer", () => {
    // $10 at $0.0001 per G$ is 100,000 G$; the 5% buffer makes it 105,000.
    expect(gdWeiForPack(10, 0.0001, 500)).toBe(BigInt(105_000) * G);
    expect(gdWeiForPack(10, 0.0001, 0)).toBe(BigInt(100_000) * G);
    expect(gdWeiForPack(50, 0.00011309, 500) % G).toBe(BigInt(0));
    expect(gdWeiForPack(50, 0.00011309, 500)).toBeGreaterThanOrEqual((BigInt(50) * BigInt(105) * G) / BigInt(100) / BigInt(113_09) * BigInt(100_000));
  });

  it("pays for itself: the G$ asked is always worth at least the pack plus the buffer", () => {
    for (const usd of [0.00005, 0.0001, 0.00011309, 0.0003]) {
      for (const pack of [10, 50, 100]) {
        const worth = (Number(gdWeiForPack(pack, usd, 500)) / 1e18) * usd;
        expect(worth).toBeGreaterThanOrEqual(pack * 1.05 - 1e-9);
      }
    }
  });

  it("the bonus is 10% of the pack", () => {
    expect(bonusForPack(10)).toBe(1_000_000);
    expect(bonusForPack(100)).toBe(10_000_000);
  });

  it("uses the live price, a stale one if the feed fails, and refuses a wild or missing one", async () => {
    expect(await gdUsdPrice(price(0.00012), 1000, {} as NodeJS.ProcessEnv)).toBe(0.00012);
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await gdUsdPrice(down, 1000 + 5 * 60_000, {} as NodeJS.ProcessEnv)).toBe(0.00012);
    resetPriceCache();
    await expect(gdUsdPrice(down, 1000, {} as NodeJS.ProcessEnv)).rejects.toBeInstanceOf(QuoteError);
    await expect(gdUsdPrice(price(0.5), 1000, {} as NodeJS.ProcessEnv)).rejects.toBeInstanceOf(QuoteError); // 4,000x the expected price
    await expect(gdUsdPrice(price(0), 1000, {} as NodeJS.ProcessEnv)).rejects.toBeInstanceOf(QuoteError);
  });
});

describe.each(testBackends())("quotes on $name", (backend) => {
  let database: TestDatabase;
  let db: Db;
  beforeAll(async () => {
    database = await backend.open();
    db = database.db;
    await database.migrate(MIGRATIONS);
  }, 120_000);
  afterAll(async () => database?.close());
  beforeEach(resetPriceCache);

  const account = async () => {
    const [u] = await db.insert(users).values({ wallet: newWallet() }).returning();
    return u;
  };
  const opts = { fetcher: price(0.0001), env: ENV };

  it("signs a quote the contract's signer check would accept, and records it", async () => {
    const u = await account();
    const signed = await issueQuote(db, { userId: u.id, wallet: u.wallet, chainId: 42220, amountMicro: 10_000_000, root: null }, opts);
    expect(signed.verified).toBe(false);
    expect(signed.quote).toMatchObject({ buyer: getAddress(u.wallet), credits: "10000000", bonus: "0", gdAmount: (BigInt(105_000) * G).toString() });
    const recovered = await recoverTypedDataAddress({
      domain: { name: "GoodBuild Credits", version: "1", chainId: 42220, verifyingContract: CONTRACT },
      types: { Quote: [{ name: "buyer", type: "address" }, { name: "gdAmount", type: "uint256" }, { name: "credits", type: "uint256" }, { name: "bonus", type: "uint256" }, { name: "ref", type: "bytes32" }, { name: "deadline", type: "uint256" }] },
      primaryType: "Quote",
      message: { buyer: getAddress(u.wallet), gdAmount: BigInt(signed.quote.gdAmount), credits: BigInt(signed.quote.credits), bonus: BigInt(signed.quote.bonus), ref: signed.quote.ref as Hex, deadline: BigInt(signed.quote.deadline) },
      signature: signed.signature,
    });
    expect(recovered).toBe(privateKeyToAccount(KEY).address);
  });

  it("sells any amount from $0.35 with the bonus scaled to it, and refuses less or more", async () => {
    const u = await account();
    const small = await issueQuote(db, { userId: u.id, wallet: u.wallet, chainId: 42220, amountMicro: MIN_PURCHASE_MICRO, root: newWallet() }, opts);
    expect(small.quote).toMatchObject({ credits: "350000", bonus: "35000", gdAmount: gdWeiForMicro(350_000, 0.0001, 500).toString() });
    await expect(issueQuote(db, { userId: u.id, wallet: u.wallet, chainId: 42220, amountMicro: MIN_PURCHASE_MICRO - 1 }, opts)).rejects.toMatchObject({ code: "bad_amount" });
    await expect(issueQuote(db, { userId: u.id, wallet: u.wallet, chainId: 42220, amountMicro: MAX_PURCHASE_MICRO + 1 }, opts)).rejects.toMatchObject({ code: "bad_amount" });
  });

  it("refuses a bad amount, an unconfigured signer and a chain with no contract", async () => {
    const u = await account();
    await expect(issueQuote(db, { userId: u.id, wallet: u.wallet, chainId: 42220, amountMicro: 100 }, opts)).rejects.toMatchObject({ code: "bad_amount" });
    await expect(issueQuote(db, { userId: u.id, wallet: u.wallet, chainId: 42220, amountMicro: 10_000_000 }, { ...opts, env: { CREDITS_CONTRACT_42220: CONTRACT } as unknown as NodeJS.ProcessEnv })).rejects.toMatchObject({ code: "signer_not_configured" });
    await expect(issueQuote(db, { userId: u.id, wallet: u.wallet, chainId: 11142220, amountMicro: 10_000_000 }, opts)).rejects.toMatchObject({ code: "not_live" });
  });

  it("adds the bonus for a verified person and stops at the monthly cap, counted per person", async () => {
    const root = newWallet();
    const a = await account();
    const b = await account(); // a second wallet of the same person
    const first = await issueQuote(db, { userId: a.id, wallet: a.wallet, chainId: 42220, amountMicro: 100_000_000, root }, opts);
    expect(first.quote.bonus).toBe("10000000");
    expect(first.verified).toBe(true);
    // The cap is $10 a month: the first quote used it all while it can still be paid.
    const second = await issueQuote(db, { userId: b.id, wallet: b.wallet, chainId: 42220, amountMicro: 50_000_000, root }, opts);
    expect(second.quote.bonus).toBe("0");
    expect(BONUS_CAP_MICRO_PER_MONTH).toBe(10_000_000);
    const view = await previewPacks(db, { root, ...opts });
    expect(view.verifiedRoom).toBe(0);
  });

  it("gives the unused bonus back once an unpaid quote expires", async () => {
    const root = newWallet();
    const u = await account();
    const t0 = new Date();
    const q = await issueQuote(db, { userId: u.id, wallet: u.wallet, chainId: 42220, amountMicro: 100_000_000, root }, { ...opts, now: t0 });
    expect(q.quote.bonus).toBe("10000000");
    const later = new Date(t0.getTime() + 11 * 60_000);
    const again = await issueQuote(db, { userId: u.id, wallet: u.wallet, chainId: 42220, amountMicro: 100_000_000, root }, { ...opts, now: later });
    expect(again.quote.bonus).toBe("10000000");
  });

  it("a paid quote keeps its bonus counted after it expires", async () => {
    const root = newWallet();
    const u = await account();
    const t0 = new Date();
    const q = await issueQuote(db, { userId: u.id, wallet: u.wallet, chainId: 42220, amountMicro: 100_000_000, root }, { ...opts, now: t0 });
    await markQuotePaid(db, q.quote.ref, "0xabc");
    const later = new Date(t0.getTime() + 11 * 60_000);
    const again = await issueQuote(db, { userId: u.id, wallet: u.wallet, chainId: 42220, amountMicro: 100_000_000, root }, { ...opts, now: later });
    expect(again.quote.bonus).toBe("0");
  });
});
