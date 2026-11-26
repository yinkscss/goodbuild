import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi, type Hex } from "viem";
import { GOODDOLLAR_MAINNET } from "@/config/gooddollar";

/**
 * Cash out G$ to a Nigerian bank through GoodCash (D179). The person's own wallet signs ONE transaction,
 * `G$.transferAndCall(router, amount, data)`; GoodCash's router pays the bank partner and sends any surplus back.
 * Addresses and the call shape are from GoodCash's OpenAPI (api docs at pay.goodcash.xyz/docs, read 26 Nov 2026) and
 * the GoodDrops reference code. GoodCash's server decides the order, so `checkCashOutTx` checks it before any wallet is
 * asked to sign: right token, right router, exactly the amount we asked for, no CELO, an order that is still open.
 * Safe to import in the browser: no secrets here.
 */

/** GoodCashRouterV2 on Celo. Fixed in code on purpose: never taken from an API answer. */
export const GOODCASH_ROUTER = "0x546698368a246539Df5e641EdC2b79c5782ea359" as const;
export const CELO_CHAIN_ID = 42220;

export const TRANSFER_AND_CALL_ABI = parseAbi(["function transferAndCall(address to, uint256 value, bytes data) returns (bool)"]);

/** abi.encode(uint8 route, uint256 minOut, uint256 deadline, address payTo, uint256 payAmount, bytes32 ref) */
const ORDER_PARAMS = [
  { type: "uint8", name: "route" },
  { type: "uint256", name: "minOut" },
  { type: "uint256", name: "deadline" },
  { type: "address", name: "payTo" },
  { type: "uint256", name: "payAmount" },
  { type: "bytes32", name: "ref" },
] as const;

export interface CashOutTx { chainId: number; to: string; data: string; value: string }
export interface CashOutOrder { router: string; payTo: string; payAmount: string; amountWei: string; minOut: string; validUntil: string }

export type CashOutStatus = "awaiting_signature" | "sent" | "processing" | "paid" | "failed" | "refunded" | "expired";
export const isFinalStatus = (s: string) => s === "paid" || s === "failed" || s === "refunded" || s === "expired";
/** Statuses where the person's G$ has gone, or is about to, so the payout can't be cashed out again. */
export const isActiveStatus = (s: string) => s === "awaiting_signature" || s === "sent" || s === "processing" || s === "paid";

export type CheckResult = { ok: true; amountWei: bigint; data: Hex } | { ok: false; reason: string };

/**
 * Returns the exact call to send, rebuilt from decoded values, so what the wallet signs is byte for byte what was
 * checked. `amountWei` is what the person's payout is for (computed by us), never GoodCash's figure.
 */
export function checkCashOutTx(tx: CashOutTx, order: CashOutOrder, amountWei: bigint, opts: { testMode?: boolean; nowMs?: number } = {}): CheckResult {
  const now = opts.nowMs ?? Date.now();
  try {
    if (tx.chainId !== CELO_CHAIN_ID) return { ok: false, reason: "wrong_chain" };
    if (tx.to.toLowerCase() !== GOODDOLLAR_MAINNET.toLowerCase()) return { ok: false, reason: "wrong_token" };
    if (BigInt(tx.value || "0x0") !== BigInt(0)) return { ok: false, reason: "sends_celo" };
    if (order.router.toLowerCase() !== GOODCASH_ROUTER.toLowerCase()) return { ok: false, reason: "wrong_router" };

    const outer = decodeFunctionData({ abi: TRANSFER_AND_CALL_ABI, data: tx.data as Hex });
    if (outer.functionName !== "transferAndCall") return { ok: false, reason: "wrong_function" };
    const [to, value, inner] = outer.args;
    if (to.toLowerCase() !== GOODCASH_ROUTER.toLowerCase()) return { ok: false, reason: "wrong_router" };
    if (value !== amountWei || BigInt(order.amountWei) !== amountWei) return { ok: false, reason: "wrong_amount" };

    const [route, minOut, deadline, payTo, payAmount] = decodeAbiParameters(ORDER_PARAMS, inner);
    if (route !== 0 && route !== 1) return { ok: false, reason: "unknown_route" };
    if (payTo.toLowerCase() !== order.payTo.toLowerCase()) return { ok: false, reason: "wrong_pay_to" };
    if (payAmount !== BigInt(order.payAmount)) return { ok: false, reason: "wrong_pay_amount" };
    if (payAmount <= BigInt(0) || payAmount > minOut) return { ok: false, reason: "bad_minimum" };
    if (BigInt(order.minOut) !== minOut) return { ok: false, reason: "bad_minimum" };
    if (!opts.testMode) {
      const deadlineMs = Number(deadline) * 1000;
      const closesMs = Date.parse(order.validUntil);
      if (!(deadlineMs > now)) return { ok: false, reason: "expired" };
      if (Number.isFinite(closesMs) && deadlineMs > closesMs + 1000) return { ok: false, reason: "deadline_after_order" };
    }

    // Rebuild and compare: no trailing bytes, nothing we didn't read.
    const rebuilt = encodeFunctionData({ abi: TRANSFER_AND_CALL_ABI, functionName: "transferAndCall", args: [to, value, inner] });
    if (rebuilt.toLowerCase() !== tx.data.toLowerCase()) return { ok: false, reason: "extra_data" };
    return { ok: true, amountWei: value, data: inner };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** Builds the inner order data the router decodes. Used by tests. */
export function encodeOrderData(o: { route: number; minOut: bigint; deadline: bigint; payTo: Hex; payAmount: bigint; ref: Hex }): Hex {
  return encodeAbiParameters(ORDER_PARAMS, [o.route, o.minOut, o.deadline, o.payTo, o.payAmount, o.ref]);
}

export interface FeeLine { type: string; label: string; percent?: number; amountG?: string; naira?: number }
export interface Quote {
  amountG: string;
  receive: { naira: number; minimumNaira: number };
  feePercent: number;
  fees: FeeLine[];
  minimumG: number;
  enough: boolean;
  nairaPerDollar: number;
  expiresAt: string;
}
export interface Bank { code: string; name: string; popular?: boolean }

/** Whole naira, e.g. "₦2,490" (no kobo). */
export const formatNaira = (n: number) => `₦${Math.floor(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

/** What the person reads for each status. Plain words, no jargon. */
export function cashOutStatusText(status: string): string {
  switch (status) {
    case "awaiting_signature": return "Waiting for your confirmation";
    case "sent":
    case "processing": return "On its way to your bank";
    case "paid": return "In your bank account";
    case "failed": return "Didn't go through";
    case "refunded": return "Sent back";
    case "expired": return "Timed out before you confirmed";
    default: return status;
  }
}
