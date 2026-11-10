import "server-only";

/**
 * GoodCash top-ups (naira in, G$ or CELO out to the user's own wallet), D81. GoodCash's page collects the payer's
 * ID details and shows the bank-transfer details; we never see them. This file only asks for quotes and reads a
 * top-up's status. Docs: https://pay.goodcash.xyz/docs/quickstarts/topups
 *
 * Keys: GOODCASH_PUBLISHABLE_KEY (gc_pk_test_ or gc_pk_live_, safe to give the browser) and optionally
 * GOODCASH_SECRET_KEY (server only). The server prefers the secret key; with only the publishable key it sends our
 * site as the Origin, which GoodCash checks against the sites registered for the key.
 */

export type Asset = "g" | "celo";
export type TopUpStatus = "awaiting_payment" | "paid_in" | "delivered" | "failed" | "expired";

export interface TopUpQuote {
  amountNaira: number;
  asset: Asset;
  mode: "live" | "test";
  youGet: { amount: number; minimum: number };
  fees: Array<{ label: string; usd: number }>;
  minimumNaira: number;
  validForSeconds: number;
}
export interface TopUp {
  id: string;
  mode: "live" | "test";
  status: TopUpStatus;
  amountNaira: number;
  asset: Asset;
  wallet: string;
  txHash?: string;
}

export class GoodCashError extends Error {
  constructor(
    readonly code: "not_configured" | "not_enabled" | "bad_request" | "unavailable",
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export const MIN_NAIRA = 1_000;
export const MAX_NAIRA = 2_000_000;
const API = "https://api.goodcash.xyz";

export interface GoodCashConfig {
  publishableKey?: string;
  secretKey?: string;
  origin: string;
}

export function goodCashConfig(env: NodeJS.ProcessEnv = process.env): GoodCashConfig {
  const domain = env.APP_DOMAIN;
  return {
    publishableKey: env.GOODCASH_PUBLISHABLE_KEY || undefined,
    secretKey: env.GOODCASH_SECRET_KEY || undefined,
    origin: env.GOODCASH_ORIGIN || (domain ? `https://${domain}` : "http://localhost:3000"),
  };
}

export const isTestKey = (key: string | undefined) => Boolean(key && /^gc_(pk|sk)_test_/.test(key));

type Fetch = typeof fetch;

async function call<T>(path: string, config: GoodCashConfig, fetcher: Fetch): Promise<T> {
  const key = config.secretKey ?? config.publishableKey;
  if (!key) throw new GoodCashError("not_configured", "Buying isn't switched on yet.", 503);
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, accept: "application/json" };
  if (!config.secretKey) headers.origin = config.origin;
  let res: Response;
  try {
    res = await fetcher(`${API}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new GoodCashError("unavailable", "We can't reach our payment partner right now. Try again in a minute.", 503);
  }
  if (res.status === 404 || res.status === 403) {
    // Log GoodCash's reason (a wrong origin or key reads the same as "not enabled" to the person).
    const detail = (await res.clone().json().catch(() => null)) as { error?: { code?: string } | string; code?: string } | null;
    console.warn("goodcash: refused", res.status, typeof detail?.error === "object" ? detail.error?.code : (detail?.code ?? detail?.error));
    // GoodCash answers "not found" until it switches top-ups on for a partner (docs: Availability).
    throw new GoodCashError("not_enabled", "Buying isn't switched on yet.", 503);
  }
  const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (res.status >= 400 && res.status < 500) throw new GoodCashError("bad_request", body?.message?.slice(0, 200) ?? "That amount can't be bought.", 400);
  if (!res.ok || !body) throw new GoodCashError("unavailable", "Our payment partner had a problem. Try again in a minute.", 503);
  return body;
}

export async function topUpQuote(input: { amountNaira: number; asset: Asset; wallet?: string }, config = goodCashConfig(), fetcher: Fetch = fetch): Promise<TopUpQuote> {
  const q = new URLSearchParams({ amountNaira: String(input.amountNaira), asset: input.asset });
  if (input.wallet) q.set("wallet", input.wallet);
  return call<TopUpQuote>(`/v1/topup/quote?${q}`, config, fetcher);
}

export async function getTopUp(id: string, config = goodCashConfig(), fetcher: Fetch = fetch): Promise<TopUp> {
  if (!/^tu_[0-9a-f]{24}$/.test(id)) throw new GoodCashError("bad_request", "Unknown top-up.", 404);
  return call<TopUp>(`/v1/topups/${id}`, config, fetcher);
}

/** A top-up may only be shown to the wallet it pays. Anything else looks like it does not exist. */
export const topUpBelongsTo = (topUp: Pick<TopUp, "wallet">, wallet: string) => topUp.wallet.toLowerCase() === wallet.toLowerCase();
