import { isAddress, isHex, type Hex } from "viem";

/**
 * Host signing for GoodCash top-ups (D122). Our page, not GoodCash's widget, holds the customer's wallet (a Magic
 * email wallet or a connected external one), so the widget asks our page to sign the one permit a top-up needs: a
 * USDC `ReceiveWithAuthorization` (EIP-3009) on Base that moves at most this order's dollars to one of Relay's
 * approval contracts. Relay then delivers G$ or CELO to the same wallet on Celo. Facts from GoodCash (18 Nov 2026)
 * and widget.js 0.4.0. This file is the check our page runs before it asks the wallet to sign anything. It never
 * signs what it was handed: it rebuilds the permit from the fields it checked, so nothing unchecked can be signed.
 */

export const BASE_CHAIN_ID = 8453;
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
/** Relay's two approval contracts on Base (GoodCash docs; they give 7 days' notice of a change). */
export const RELAY_APPROVAL_CONTRACTS = ["0xccc88a9d1b4ed6b0eaba998850414b24f1c315be", "0x5567954cd026cebfe486062cb75848e0f1c12e58"] as const;
/** GoodCash's signing request carries `maxUsdc` from this widget version on. */
export const MIN_WIDGET_VERSION = "0.4.0";
/** A permit is valid for about 30 minutes. The extra 10 allow for a phone clock that is a little off. */
const MAX_VALID_SECONDS = 40 * 60;
const CLOCK_SKEW_SECONDS = 5 * 60;

const PERMIT_FIELDS = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

export interface TopUpPermit {
  domain: { name: "USD Coin"; version: "2"; chainId: typeof BASE_CHAIN_ID; verifyingContract: typeof BASE_USDC };
  types: { ReceiveWithAuthorization: typeof PERMIT_FIELDS };
  primaryType: "ReceiveWithAuthorization";
  message: { from: Hex; to: Hex; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex };
}

export type PermitCheck = { ok: true; permit: TopUpPermit } | { ok: false; reason: string };

const lower = (v: unknown) => String(v ?? "").toLowerCase();

function toUint(v: unknown): bigint | null {
  if (typeof v === "bigint") return v >= BigInt(0) ? v : null;
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
  if (typeof v === "string" && /^(0|[1-9]\d{0,77})$/.test(v)) return BigInt(v);
  return null;
}

function sameFields(fields: unknown): boolean {
  if (!Array.isArray(fields) || fields.length !== PERMIT_FIELDS.length) return false;
  return PERMIT_FIELDS.every((f, i) => fields[i]?.name === f.name && fields[i]?.type === f.type);
}

/**
 * Checks a signing request from GoodCash's widget against what a top-up permit must be. `wallet` is the session
 * wallet (server-verified), `signer` the wallet connected in the browser; both must be the permit's `from`.
 */
export function checkTopUpPermit(input: { typedData: unknown; context: unknown; wallet: string; signer: string; now?: number }): PermitCheck {
  const no = (reason: string): PermitCheck => ({ ok: false, reason });
  const td = input.typedData as { domain?: Record<string, unknown>; types?: Record<string, unknown>; primaryType?: unknown; message?: Record<string, unknown> } | null;
  const ctx = input.context as { orderId?: unknown; maxUsdc?: unknown; wallet?: unknown } | null;
  const now = input.now ?? Math.floor(Date.now() / 1000);

  if (!isAddress(input.wallet, { strict: false }) || lower(input.wallet) !== lower(input.signer)) return no("The wallet you're signed in with isn't the one connected.");
  if (!td || typeof td !== "object" || !td.domain || !td.message || !td.types) return no("This is not the top-up permit.");
  if (td.primaryType !== "ReceiveWithAuthorization" || !sameFields(td.types.ReceiveWithAuthorization)) return no("This is not the top-up permit.");
  const extraTypes = Object.keys(td.types).filter((k) => k !== "ReceiveWithAuthorization" && k !== "EIP712Domain");
  if (extraTypes.length) return no("This is not the top-up permit.");

  const d = td.domain;
  if (d.name !== "USD Coin" || d.version !== "2" || Number(d.chainId) !== BASE_CHAIN_ID || lower(d.verifyingContract) !== lower(BASE_USDC)) return no("This is not a USDC permit on Base.");

  const m = td.message;
  if (!isAddress(String(m.from), { strict: false }) || lower(m.from) !== lower(input.wallet)) return no("The permit is not from your wallet.");
  if (!ctx || lower(ctx.wallet) !== lower(input.wallet)) return no("The permit is not for your wallet.");
  if (!isAddress(String(m.to), { strict: false }) || !RELAY_APPROVAL_CONTRACTS.some((a) => a === lower(m.to))) return no("The permit doesn't pay a contract we know.");

  const max = toUint(typeof ctx.maxUsdc === "number" ? ctx.maxUsdc : String(ctx.maxUsdc ?? ""));
  if (max === null || max === BigInt(0)) return no("The order's limit is missing, so we didn't sign.");
  if (typeof ctx.orderId !== "string" || !ctx.orderId || ctx.orderId.length > 64) return no("The order is missing, so we didn't sign.");
  const value = toUint(m.value);
  if (value === null || value === BigInt(0)) return no("The amount is not readable.");
  if (value > max) return no("The amount is above what this order may convert.");

  const validAfter = toUint(m.validAfter);
  const validBefore = toUint(m.validBefore);
  if (validAfter === null || validBefore === null) return no("The permit time limit is not readable.");
  if (validBefore <= BigInt(now) || validBefore > BigInt(now + MAX_VALID_SECONDS)) return no("The permit time limit is not what is expected.");
  if (validAfter > BigInt(now + CLOCK_SKEW_SECONDS) || validAfter >= validBefore) return no("The permit time limit is not what is expected.");

  const nonce = String(m.nonce ?? "");
  if (!isHex(nonce) || nonce.length !== 66) return no("The permit is not readable.");

  return {
    ok: true,
    permit: {
      domain: { name: "USD Coin", version: "2", chainId: BASE_CHAIN_ID, verifyingContract: BASE_USDC },
      types: { ReceiveWithAuthorization: PERMIT_FIELDS },
      primaryType: "ReceiveWithAuthorization",
      message: { from: input.wallet as Hex, to: lower(m.to) as Hex, value, validAfter, validBefore, nonce: nonce as Hex },
    },
  };
}

/** True when the loaded widget.js is at least `min` (plain x.y.z). Anything unreadable is treated as too old. */
export function widgetAtLeast(version: unknown, min = MIN_WIDGET_VERSION): boolean {
  const parse = (v: unknown) => (typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
  const a = parse(version);
  const b = parse(min)!;
  if (!a) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/** A 65-byte hex signature, the only answer the widget gets back. */
export const isSignature = (s: unknown): s is Hex => typeof s === "string" && /^0x[0-9a-fA-F]{130}$/.test(s);

/**
 * The `signTypedData` our page hands GoodCash's widget. It checks the request first and only then asks the wallet to
 * sign the rebuilt permit. A refusal throws, which widget.js passes back to GoodCash's panel as an error: nothing is
 * signed and nothing moves. `signer` is read at call time, so an account switched in the wallet is caught.
 */
export function makeTopUpSigner(deps: { wallet: string; signer: () => string | null | undefined; sign: (permit: TopUpPermit) => Promise<string>; now?: () => number }) {
  return async (typedData: unknown, context: unknown): Promise<Hex> => {
    const check = checkTopUpPermit({ typedData, context, wallet: deps.wallet, signer: deps.signer() ?? "", now: deps.now?.() });
    if (!check.ok) throw new Error(check.reason);
    const signature = await deps.sign(check.permit);
    if (!isSignature(signature)) throw new Error("The wallet didn't return a signature.");
    return signature;
  };
}

/**
 * Whether to let our page sign for this top-up: the switch is on, the widget is new enough to send `maxUsdc`, and the
 * connected wallet is the session wallet. Otherwise the widget shows its own connect screen, as before.
 */
export function canHostSign(input: { enabled: boolean | undefined; widgetVersion: unknown; sessionWallet: string | null | undefined; connectedWallet: string | null | undefined }): boolean {
  return Boolean(input.enabled && widgetAtLeast(input.widgetVersion) && input.sessionWallet && input.connectedWallet && lower(input.sessionWallet) === lower(input.connectedWallet));
}
