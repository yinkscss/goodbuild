import { describe, expect, it } from "vitest";
import { parseUnits, encodeFunctionData } from "viem";
import { GOODDOLLAR_MAINNET } from "@/config/gooddollar";
import { CELO_CHAIN_ID, GOODCASH_ROUTER, TRANSFER_AND_CALL_ABI, checkCashOutTx, encodeOrderData, cashOutStatusText, isActiveStatus, type CashOutOrder, type CashOutTx } from "./cashout";

const PAY_TO = "0x1111111111111111111111111111111111111111" as const;
const amount = parseUnits("25000", 18);
const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const deadline = BigInt(Math.floor(NOW / 1000) + 900);
function build(over: { value?: bigint; to?: string; router?: string; deadline?: bigint; payAmount?: bigint; minOut?: bigint; payTo?: `0x${string}` } = {}) {
  const inner = encodeOrderData({ route: 0, minOut: over.minOut ?? BigInt(100), deadline: over.deadline ?? deadline, payTo: over.payTo ?? PAY_TO, payAmount: over.payAmount ?? BigInt(90), ref: `0x${"00".repeat(32)}` });
  const data = encodeFunctionData({ abi: TRANSFER_AND_CALL_ABI, functionName: "transferAndCall", args: [(over.router ?? GOODCASH_ROUTER) as `0x${string}`, over.value ?? amount, inner] });
  const tx: CashOutTx = { chainId: CELO_CHAIN_ID, to: over.to ?? GOODDOLLAR_MAINNET, data, value: "0x0" };
  const order: CashOutOrder = { router: GOODCASH_ROUTER, payTo: PAY_TO, payAmount: "90", amountWei: amount.toString(), minOut: "100", validUntil: new Date(NOW + 900_000).toISOString() };
  return { tx, order };
}

describe("checkCashOutTx", () => {
  it("accepts a correct order and returns the checked amount", () => {
    const { tx, order } = build();
    const r = checkCashOutTx(tx, order, amount, { nowMs: NOW });
    expect(r.ok && r.amountWei).toBe(amount);
  });
  it.each([
    ["wrong token", { to: "0x2222222222222222222222222222222222222222" }, "wrong_token"],
    ["wrong router", { router: "0x3333333333333333333333333333333333333333" }, "wrong_router"],
    ["a different amount", { value: amount + BigInt(1) }, "wrong_amount"],
    ["a different recipient", { payTo: "0x4444444444444444444444444444444444444444" as const }, "wrong_pay_to"],
    ["an expired deadline", { deadline: BigInt(5) }, "expired"],
    ["payout above the minimum out", { payAmount: BigInt(101) }, "wrong_pay_amount"],
  ] as const)("refuses %s", (_n, over, reason) => {
    const { tx, order } = build(over as never);
    const r = checkCashOutTx(tx, order, amount, { nowMs: NOW });
    expect(r).toEqual({ ok: false, reason });
  });
  it("refuses an amount other than the payout, wrong chain, CELO value and trailing bytes", () => {
    const { tx, order } = build();
    expect(checkCashOutTx(tx, order, amount - BigInt(1), { nowMs: NOW })).toEqual({ ok: false, reason: "wrong_amount" });
    expect(checkCashOutTx({ ...tx, chainId: 1 }, order, amount, { nowMs: NOW })).toEqual({ ok: false, reason: "wrong_chain" });
    expect(checkCashOutTx({ ...tx, value: "0x1" }, order, amount, { nowMs: NOW })).toEqual({ ok: false, reason: "sends_celo" });
    expect(checkCashOutTx({ ...tx, data: `${tx.data}00` }, order, amount, { nowMs: NOW })).toEqual({ ok: false, reason: "extra_data" });
  });
  it("skips only the time checks in test mode", () => {
    const { tx, order } = build({ deadline: BigInt(5) });
    expect(checkCashOutTx(tx, order, amount, { nowMs: NOW, testMode: true }).ok).toBe(true);
  });
});

it("uses plain words for every status", () => {
  for (const s of ["awaiting_signature", "sent", "processing", "paid", "failed", "refunded", "expired"]) expect(cashOutStatusText(s)).not.toBe(s);
  expect(isActiveStatus("failed")).toBe(false);
  expect(isActiveStatus("paid")).toBe(true);
});
