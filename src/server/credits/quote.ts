import "server-only";

import { randomBytes } from "node:crypto";

import { and, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Db } from "@/server/db/client";
import { creditQuotes } from "@/server/db/credit-quotes-schema";
import { creditsContract } from "./contract-address";

/**
 * G$ quotes for GoodBuild Credits (D56). The contract has no price of its own: it accepts a payment only
 * against a quote this server signed (EIP-712), naming the buyer, the exact G$, the credits, any
 * verification bonus, a unique ref and a deadline. That keeps the price in line with G$'s market price
 * (a fixed on-chain rate goes stale in hours) and lets the owner rotate the signer at any time.
 *
 * Pricing: a credit is $1 of AI builds. The ledger already charges AI at cost + 25% (D13), so a credit
 * costs GoodBuild about $0.80 to serve. The G$ price adds a buffer (default 5%) for G$ moving during the
 * quote's 10 minutes and for the cost of turning G$ into dollars. A GoodDollar-verified person gets 10%
 * more credits on a pack, up to $10 of bonus per month per verified person (per GoodID root, so new
 * wallets of the same person don't add up). Even with the bonus, the revenue per credit stays above
 * its cost. The exit cost of G$ itself is UNVERIFIED (not measured on-chain): the buffer is the knob.
 */
export const PACKS = [10, 50, 100] as const;
export type Pack = (typeof PACKS)[number];
export const UNITS = 1_000_000;
export const QUOTE_TTL_SECONDS = 600;
export const BONUS_BPS = 1000;
export const BONUS_CAP_MICRO_PER_MONTH = 10 * UNITS;
const WEI = BigInt(10) ** BigInt(18);
const PRICE_TTL_MS = 60_000;
const PRICE_STALE_MS = 60 * 60_000;

export class QuoteError extends Error {
  constructor(readonly code: "price_unavailable" | "signer_not_configured" | "not_live" | "bad_pack", message: string) {
    super(message);
  }
}

export const isPack = (n: number): n is Pack => (PACKS as readonly number[]).includes(n);

export const bufferBps = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.CREDITS_PRICE_BUFFER_BPS);
  return Number.isInteger(n) && n >= 0 && n <= 5000 ? n : 500;
};

/**
 * G$ in wei for `pack` dollars of credit at `usdPerGd`, plus the buffer, rounded UP to a whole G$ so the
 * contract is never underpaid and the user sees a clean number.
 */
export function gdWeiForPack(pack: number, usdPerGd: number, buffer = 500): bigint {
  if (!(usdPerGd > 0) || !(pack > 0)) throw new RangeError("price and pack must be positive");
  const priceE12 = BigInt(Math.max(1, Math.round(usdPerGd * 1e12)));
  const usdMicro = BigInt(pack) * BigInt(UNITS);
  const withBuffer = (usdMicro * BigInt(10_000 + buffer)) / BigInt(10_000);
  const wei = (withBuffer * BigInt(10) ** BigInt(24)) / priceE12;
  return ((wei + WEI - BigInt(1)) / WEI) * WEI;
}

/** The bonus a pack earns, GBC units, before the monthly cap. */
export const bonusForPack = (pack: number) => Math.floor((pack * UNITS * BONUS_BPS) / 10_000);

let cache: { price: number; at: number } | null = null;

/** USD per G$. Live from CoinGecko (cached a minute); a stale price up to an hour old if it is down; else refuse. */
export async function gdUsdPrice(fetcher: typeof fetch = fetch, now = Date.now(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (cache && now - cache.at < PRICE_TTL_MS) return cache.price;
  const sane = Number(env.GD_USD_FALLBACK) > 0 ? Number(env.GD_USD_FALLBACK) : 0.00011;
  try {
    const res = await fetcher("https://api.coingecko.com/api/v3/simple/price?ids=gooddollar&vs_currencies=usd", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const price = ((await res.json()) as { gooddollar?: { usd?: number } }).gooddollar?.usd;
    // A price far outside the expected range is a bad feed or a market event: refuse rather than mis-price.
    if (typeof price === "number" && price > sane / 5 && price < sane * 5) {
      cache = { price, at: now };
      return price;
    }
  } catch {
    /* fall through to the stale price */
  }
  if (cache && now - cache.at < PRICE_STALE_MS) return cache.price;
  throw new QuoteError("price_unavailable", "We can't price G$ right now. Try again in a minute.");
}
export const resetPriceCache = () => {
  cache = null;
};

export const monthKey = (d = new Date()) => ({ from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) });

/** Bonus still available to this person this month: the cap, less quotes that were paid or can still be paid. */
export async function bonusRoom(db: Db, root: string, now = new Date()): Promise<number> {
  const { from, to } = monthKey(now);
  const [row] = await db
    .select({ used: sql<number>`coalesce(sum(${creditQuotes.bonusMicro}), 0)::bigint` })
    .from(creditQuotes)
    .where(and(eq(creditQuotes.goodidRoot, root.toLowerCase()), sql`${creditQuotes.createdAt} >= ${from}`, sql`${creditQuotes.createdAt} < ${to}`, or(isNotNull(creditQuotes.paidAt), gt(creditQuotes.deadline, now))));
  return Math.max(0, BONUS_CAP_MICRO_PER_MONTH - Number(row?.used ?? 0));
}

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

export interface SignedQuote {
  quote: { buyer: Address; gdAmount: string; credits: string; bonus: string; ref: Hex; deadline: string };
  signature: Hex;
  pack: Pack;
  gdUsd: number;
  verified: boolean;
}

/** The price and bonus for a pack without signing anything, for the "Add credits" screen. */
export async function previewPacks(db: Db, opts: { root?: string | null; fetcher?: typeof fetch; env?: NodeJS.ProcessEnv; now?: Date } = {}) {
  const env = opts.env ?? process.env;
  const gdUsd = await gdUsdPrice(opts.fetcher, opts.now?.getTime(), env);
  const room = opts.root ? await bonusRoom(db, opts.root, opts.now) : 0;
  return {
    gdUsd,
    packs: PACKS.map((pack) => {
      const bonus = Math.min(bonusForPack(pack), room);
      return { pack, gdWei: gdWeiForPack(pack, gdUsd, bufferBps(env)).toString(), bonusMicro: opts.root ? bonus : 0, bonusIfVerifiedMicro: bonusForPack(pack) };
    }),
    verifiedRoom: room,
  };
}

/** Sign a quote for this user and record it. Everything but the pack comes from the server's own records. */
export async function issueQuote(
  db: Db,
  input: { userId: string; wallet: string; chainId: number; pack: number; root?: string | null },
  opts: { fetcher?: typeof fetch; env?: NodeJS.ProcessEnv; now?: Date } = {},
): Promise<SignedQuote> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  if (!isPack(input.pack)) throw new QuoteError("bad_pack", "Pick 10, 50 or 100 credits.");
  const contract = creditsContract(input.chainId, env);
  if (!contract) throw new QuoteError("not_live", "Credits aren't live on that network yet.");
  const key = env.CREDITS_QUOTE_SIGNER_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new QuoteError("signer_not_configured", "Credits aren't ready to sell yet.");

  const gdUsd = await gdUsdPrice(opts.fetcher, now.getTime(), env);
  const creditsMicro = input.pack * UNITS;
  const room = input.root ? await bonusRoom(db, input.root, now) : 0;
  const bonusMicro = input.root ? Math.min(bonusForPack(input.pack), room) : 0;
  const gdWei = gdWeiForPack(input.pack, gdUsd, bufferBps(env));
  const ref = `0x${randomBytes(32).toString("hex")}` as Hex;
  const deadline = Math.floor(now.getTime() / 1000) + QUOTE_TTL_SECONDS;
  const buyer = getAddress(input.wallet);

  const message = { buyer, gdAmount: gdWei, credits: BigInt(creditsMicro), bonus: BigInt(bonusMicro), ref, deadline: BigInt(deadline) };
  const signature = await privateKeyToAccount(key as Hex).signTypedData({
    domain: { name: "GoodBuild Credits", version: "1", chainId: input.chainId, verifyingContract: contract },
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message,
  });
  await db.insert(creditQuotes).values({
    ref,
    userId: input.userId,
    chainId: input.chainId,
    wallet: buyer.toLowerCase(),
    goodidRoot: bonusMicro > 0 && input.root ? input.root.toLowerCase() : null,
    pack: input.pack,
    creditsMicro,
    bonusMicro,
    gdWei: gdWei.toString(),
    gdUsd: String(gdUsd),
    deadline: new Date(deadline * 1000),
  });
  return {
    quote: { buyer, gdAmount: gdWei.toString(), credits: String(creditsMicro), bonus: String(bonusMicro), ref, deadline: String(deadline) },
    signature,
    pack: input.pack,
    gdUsd,
    verified: bonusMicro > 0,
  };
}

/** Mark a quote paid when the chain shows its ref was redeemed. Unknown refs (grants) change nothing. */
export async function markQuotePaid(db: Db, ref: string, txHash: string) {
  await db
    .update(creditQuotes)
    .set({ paidTx: txHash.toLowerCase(), paidAt: new Date() })
    .where(and(eq(creditQuotes.ref, ref.toLowerCase()), sql`${creditQuotes.paidAt} is null`));
}
