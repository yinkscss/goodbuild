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
    /** GoodCash's own error code, when it gave one (cash-outs). */
    readonly gcCode?: string,
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
  const body = (await res.json().catch(() => null)) as (T & { message?: string; error?: { code?: string; message?: string; detail?: string } | string }) | null;
  if (res.status >= 400 && res.status < 500) {
    // GoodCash errors look like { error: { code, message, detail } }; the message is written for customers.
    const err = body && typeof body.error === "object" ? body.error : undefined;
    console.warn("goodcash: rejected", res.status, err?.code ?? "unknown", err?.detail ?? "");
    throw new GoodCashError("bad_request", (err?.message ?? body?.message)?.slice(0, 200) ?? "That amount can't be bought.", 400);
  }
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

// ── Cash out: G$ to a Nigerian bank (D173). Secret key only, server only. ─────────────────────────────────────────

/** Cash-outs need a secret key (gc_sk_live_ or gc_sk_test_). A publishable key can't create one, so the feature hides itself. */
export function cashOutMode(config = goodCashConfig()): "live" | "test" | null {
  const key = config.secretKey?.trim();
  if (!key) return null;
  if (key.startsWith("gc_sk_live_")) return "live";
  if (key.startsWith("gc_sk_test_")) return "test";
  return null;
}

const CASHOUT_BUSY = "Cashing out is busy right now. Please try again in a moment.";

/** One secret-key call. Errors carry GoodCash's own plain `message` (written for customers) and its `code`. */
async function secretCall<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string; timeoutMs?: number } = {}, config = goodCashConfig(), fetcher: Fetch = fetch): Promise<T> {
  if (!cashOutMode(config)) throw new GoodCashError("not_configured", "Cashing out isn't switched on yet.", 503);
  const headers: Record<string, string> = { authorization: `Bearer ${config.secretKey}`, accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetcher(`${API}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
  } catch {
    throw new GoodCashError("unavailable", CASHOUT_BUSY, 503);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; detail?: string } }) | null;
  if (!res.ok || !body) {
    const err = body?.error;
    console.warn("goodcash cash-out: refused", path, res.status, err?.code ?? "unknown", err?.detail ?? "");
    const client = res.status >= 400 && res.status < 500;
    throw new GoodCashError(client ? "bad_request" : "unavailable", err?.message?.slice(0, 200) ?? CASHOUT_BUSY, client ? 400 : 503, err?.code);
  }
  return body;
}

export interface CashOutLimits { minimumG: number; maximumG: number; feePercent: number }
export interface GcCashOut {
  id: string;
  mode: "live" | "test";
  status: import("@/lib/goodcash/cashout").CashOutStatus;
  wallet: string;
  amountG: string;
  receive?: { naira?: number; minimumNaira?: number };
  txHash?: string | null;
  paidAt?: string | null;
  expiresAt?: string;
}
export interface CreatedCashOut extends GcCashOut {
  fees?: import("@/lib/goodcash/cashout").FeeLine[];
  transaction: import("@/lib/goodcash/cashout").CashOutTx;
  order: import("@/lib/goodcash/cashout").CashOutOrder;
}
export interface NetworkFee { feeCelo: number; needCelo: number; haveCelo: number; enough: boolean }

export const cashOutApi = {
  limits: (config = goodCashConfig(), fetcher: Fetch = fetch) => secretCall<CashOutLimits>("/v1/limits", {}, config, fetcher),
  banks: async (config = goodCashConfig(), fetcher: Fetch = fetch) => (await secretCall<{ data: import("@/lib/goodcash/cashout").Bank[] }>("/v1/banks", {}, config, fetcher)).data ?? [],
  verify: (bankCode: string, accountNumber: string, config = goodCashConfig(), fetcher: Fetch = fetch) => secretCall<{ accountName?: string }>("/v1/banks/verify", { method: "POST", body: { bankCode, accountNumber } }, config, fetcher),
  quote: (amountG: string, config = goodCashConfig(), fetcher: Fetch = fetch) => secretCall<import("@/lib/goodcash/cashout").Quote>(`/v1/quote?amountG=${encodeURIComponent(amountG)}`, {}, config, fetcher),
  networkFee: (wallet: string, config = goodCashConfig(), fetcher: Fetch = fetch) => secretCall<NetworkFee>(`/v1/network-fee?wallet=${wallet}`, {}, config, fetcher),
  create: (body: { wallet: string; amountG: string; recipient: { bankCode: string; accountNumber: string; accountName: string }; partnerRef: string; feePercentShown: number }, idempotencyKey: string, config = goodCashConfig(), fetcher: Fetch = fetch) =>
    secretCall<CreatedCashOut>("/v1/cashouts", { method: "POST", body, idempotencyKey, timeoutMs: 25_000 }, config, fetcher),
  reportTx: (id: string, txHash: string, config = goodCashConfig(), fetcher: Fetch = fetch) => secretCall<GcCashOut>(`/v1/cashouts/${id}/transaction`, { method: "POST", body: { txHash }, timeoutMs: 25_000 }, config, fetcher),
  get: (id: string, config = goodCashConfig(), fetcher: Fetch = fetch) => secretCall<GcCashOut>(`/v1/cashouts/${id}`, {}, config, fetcher),
};
