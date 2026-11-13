/**
 * Credit purchases the browser has sent but not yet seen credited (GB-01). The wallet hands back a
 * transaction hash the moment the G$ moves; it is saved here before anything else, so closing the tab
 * while the server is still crediting doesn't lose it. The next page load sends it again, and it is
 * dropped once the server has read it. The background scan credits it anyway: this only makes it
 * quicker. Storage can be missing or blocked (private windows), so every read and write is guarded.
 */

const KEY = "gb:credits:pending";
/** Long enough for any slow confirmation; past this the background scan has long since credited it. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingPayment {
  chainId: number;
  hash: string;
  at: number;
}

export const isTxHash = (v: string) => /^0x[0-9a-fA-F]{64}$/.test(v);

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readPending(now = Date.now()): PendingPayment[] {
  try {
    const raw = storage()?.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as PendingPayment[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.chainId === "number" && isTxHash(p.hash) && now - p.at < MAX_AGE_MS) : [];
  } catch {
    return [];
  }
}

function writePending(list: PendingPayment[]) {
  try {
    const s = storage();
    if (!s) return;
    if (list.length) s.setItem(KEY, JSON.stringify(list));
    else s.removeItem(KEY);
  } catch {
    // Nothing to do: the background scan still credits the payment.
  }
}

export function savePending(chainId: number, hash: string, now = Date.now()) {
  const list = readPending(now).filter((p) => p.hash.toLowerCase() !== hash.toLowerCase());
  writePending([...list, { chainId, hash, at: now }]);
}

export function forgetPending(hash: string) {
  writePending(readPending().filter((p) => p.hash.toLowerCase() !== hash.toLowerCase()));
}

/**
 * What the server said about one transaction:
 * - `credited`: credit was added now (`addedMicro` > 0) or had already been added (0).
 * - `not_credits`: the transaction failed on-chain or isn't a GoodBuild credits payment on that network.
 * - `pending`: not confirmed yet; ask again later.
 * - `failed`: the server couldn't answer; ask again later.
 */
export type RedeemOutcome =
  | { kind: "credited"; addedMicro: number; balanceMicro: number }
  | { kind: "not_credits" }
  | { kind: "pending" }
  | { kind: "failed"; message?: string };

export async function redeemTx(chainId: number, hash: string, fetcher: typeof fetch = fetch): Promise<RedeemOutcome> {
  let r: Response;
  try {
    r = await fetcher("/api/credits/redeem", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId, txHash: hash }) });
  } catch {
    return { kind: "failed" };
  }
  if (r.status === 202) return { kind: "pending" };
  const out = (await r.json().catch(() => ({}))) as { events?: number; creditedMicro?: number; balanceMicro?: number; message?: string };
  if (!r.ok) return { kind: "failed", message: out.message };
  if (!out.events) return { kind: "not_credits" };
  return { kind: "credited", addedMicro: out.creditedMicro ?? 0, balanceMicro: out.balanceMicro ?? 0 };
}

/** Send every saved payment again and forget the ones the server has settled. Returns credit added now. */
export async function retryPending(fetcher: typeof fetch = fetch): Promise<number> {
  let added = 0;
  for (const p of readPending()) {
    const out = await redeemTx(p.chainId, p.hash, fetcher);
    if (out.kind === "credited") added += out.addedMicro;
    if (out.kind === "credited" || out.kind === "not_credits") forgetPending(p.hash);
  }
  return added;
}

/** "0x1234…abcd" for showing a transaction in a sentence. */
export const shortHash = (hash: string) => `${hash.slice(0, 6)}…${hash.slice(-4)}`;
