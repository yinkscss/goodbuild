// @vitest-environment node
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { encodeFunctionData, parseUnits } from "viem";
import { eq } from "drizzle-orm";
import { GOODDOLLAR_MAINNET } from "@/config/gooddollar";
import { MIGRATIONS, testBackends, type TestDatabase } from "@/server/credits/test-backends";
import { users } from "@/server/db/schema";
import { ambassadorCashouts, ambassadorPayouts } from "@/server/db/ambassador-schema";
import { CELO_CHAIN_ID, GOODCASH_ROUTER, TRANSFER_AND_CALL_ABI, encodeOrderData } from "@/lib/goodcash/cashout";
import { GoodCashError, type CreatedCashOut, type GcCashOut } from "@/server/goodcash/client";
import { applyGoodCash, applyWebhookCashOut, cashOutView, refreshCashOut, startCashOut } from "./cashout";
import { alertPayoutRequested } from "./service";
import { verifyGoodCashSignature } from "@/server/goodcash/webhook";

let database: TestDatabase;
beforeAll(async () => { database = await testBackends()[0].open(); await database.migrate(MIGRATIONS); }, 120000);
afterAll(async () => { delete process.env.GOODCASH_SECRET_KEY; await database?.close(); });
beforeEach(() => { process.env.GOODCASH_SECRET_KEY = "gc_sk_live_test"; });

const addr = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}`;
const PAY_TO = "0x1111111111111111111111111111111111111111" as const;
async function paidPayout(amountG = 25000) {
  const [u] = await database.db.insert(users).values({ wallet: addr(), goodidRoot: addr(), verifiedAt: new Date() }).returning();
  const [p] = await database.db.insert(ambassadorPayouts).values({ userId: u.id, wallet: u.wallet, amountG, status: "paid", txHash: addr(), logIndex: 0 }).returning();
  return { u, p };
}
function created(wallet: string, amountG: number, over: { amountWei?: bigint; payTo?: `0x${string}` } = {}): CreatedCashOut {
  const wei = over.amountWei ?? parseUnits(String(amountG), 18);
  const inner = encodeOrderData({ route: 0, minOut: BigInt(100), deadline: BigInt(Math.floor(Date.now() / 1000) + 900), payTo: over.payTo ?? PAY_TO, payAmount: BigInt(90), ref: `0x${"00".repeat(32)}` });
  const data = encodeFunctionData({ abi: TRANSFER_AND_CALL_ABI, functionName: "transferAndCall", args: [GOODCASH_ROUTER, wei, inner] });
  return {
    id: randomUUID(), mode: "live", status: "awaiting_signature", wallet, amountG: String(amountG), receive: { naira: 2487.9, minimumNaira: 2400 }, fees: [],
    transaction: { chainId: CELO_CHAIN_ID, to: GOODDOLLAR_MAINNET, data, value: "0x0" },
    order: { router: GOODCASH_ROUTER, payTo: PAY_TO, payAmount: "90", amountWei: wei.toString(), minOut: "100", validUntil: new Date(Date.now() + 900_000).toISOString() },
  };
}
function fakeApi(make: (wallet: string, amountG: number) => CreatedCashOut = (w, g) => created(w, g)) {
  return {
    limits: vi.fn(async () => ({ minimumG: 1000, maximumG: 500000, feePercent: 1 })),
    banks: vi.fn(async () => [{ code: "058", name: "GTBank" }]),
    verify: vi.fn(async () => ({ accountName: "ADA OBI" })),
    quote: vi.fn(),
    networkFee: vi.fn(),
    create: vi.fn(async (b: { wallet: string; amountG: string }) => make(b.wallet, Number(b.amountG))),
    reportTx: vi.fn(),
    get: vi.fn(),
  };
}
const input = (payoutId: string, key = "attempt-key-1") => ({ payoutId, bankCode: "058", accountNumber: "0123456789", feePercentShown: 1, attemptKey: key });

it("starts a cash out for a paid payout, keeps only the last four digits, and blocks a second one", async () => {
  const { u, p } = await paidPayout();
  const api = fakeApi();
  const r = await startCashOut(database.db, u, input(p.id), api as never);
  expect(r.cashOut).toMatchObject({ status: "awaiting_signature", naira: 2487, bankName: "GTBank", accountName: "ADA OBI", accountLast4: "6789" });
  expect(JSON.stringify(await database.db.select().from(ambassadorCashouts))).not.toContain("0123456789");
  expect(api.create.mock.calls[0][1]).toBe("gb_attempt-key-1");
  api.get.mockResolvedValue({ ...r.transaction, id: "x" });
  await expect(startCashOut(database.db, u, input(p.id, "attempt-key-2"), { ...api, get: vi.fn(async () => ({ status: "processing" })) } as never)).rejects.toThrow(/already being cashed out|still open/);
});

it("refuses a payout that is not paid, someone else's payout, and another wallet's session", async () => {
  const { u, p } = await paidPayout();
  const other = await paidPayout();
  await expect(startCashOut(database.db, u, input(other.p.id), fakeApi() as never)).rejects.toThrow(/couldn't find/);
  await expect(startCashOut(database.db, { id: u.id, wallet: addr() }, input(p.id), fakeApi() as never)).rejects.toThrow(/wallet that received/);
  await database.db.update(ambassadorPayouts).set({ status: "processing" }).where(eq(ambassadorPayouts.id, p.id));
  await expect(startCashOut(database.db, u, input(p.id), fakeApi() as never)).rejects.toThrow(/isn't ready/);
});

it("refuses a GoodCash transaction that does not match the payout, and saves nothing", async () => {
  const { u, p } = await paidPayout();
  const api = fakeApi((w, g) => created(w, g, { amountWei: parseUnits("1", 18) }));
  await expect(startCashOut(database.db, u, input(p.id), api as never)).rejects.toThrow(/stopped it/);
  expect(await database.db.select().from(ambassadorCashouts).where(eq(ambassadorCashouts.payoutId, p.id))).toHaveLength(0);
});

it("turns GoodCash's own errors into plain words", async () => {
  const { u, p } = await paidPayout();
  const api = fakeApi(); api.create.mockRejectedValue(new GoodCashError("bad_request", "x", 400, "insufficient_balance"));
  await expect(startCashOut(database.db, u, input(p.id), api as never)).rejects.toThrow(/isn't in your wallet/);
  const small = await paidPayout(25000);
  const strict = fakeApi(); strict.limits.mockResolvedValue({ minimumG: 30000, maximumG: 500000, feePercent: 1 });
  await expect(startCashOut(database.db, small.u, input(small.p.id), strict as never)).rejects.toThrow(/least you can cash out is 30,000/);
});

it("follows GoodCash's status, never moves a paid cash out back, and allows a retry after a failure", async () => {
  const { u, p } = await paidPayout();
  const api = fakeApi();
  const r = await startCashOut(database.db, u, input(p.id), api as never);
  const gc = (status: GcCashOut["status"], extra: Partial<GcCashOut> = {}): GcCashOut => ({ id: "", mode: "live", status, wallet: u.wallet, amountG: "25000", receive: { naira: 2490 }, ...extra });
  api.get.mockResolvedValueOnce(gc("processing", { txHash: `0x${"ab".repeat(32)}` }));
  expect((await refreshCashOut(database.db, u.id, r.cashOut.id, api as never)).status).toBe("processing");
  const [row] = await database.db.select().from(ambassadorCashouts).where(eq(ambassadorCashouts.id, r.cashOut.id));
  const paid = await applyGoodCash(database.db, row, gc("paid", { paidAt: new Date().toISOString() }));
  expect(paid.status).toBe("paid"); expect(paid.naira).toBe(2490);
  expect((await applyGoodCash(database.db, paid, gc("failed"))).status).toBe("paid");
  expect(await applyWebhookCashOut(database.db, { ...gc("paid"), id: "not-ours" })).toBe(false);

  const again = await paidPayout();
  const first = await startCashOut(database.db, again.u, input(again.p.id), api as never);
  api.get.mockResolvedValueOnce(gc("failed"));
  await refreshCashOut(database.db, again.u.id, first.cashOut.id, api as never);
  const second = await startCashOut(database.db, again.u, input(again.p.id, "attempt-key-9"), api as never);
  expect(second.cashOut.id).not.toBe(first.cashOut.id);
  expect(cashOutView((await database.db.select().from(ambassadorCashouts).where(eq(ambassadorCashouts.id, second.cashOut.id)))[0]).status).toBe("awaiting_signature");
});

it("alerts the owner on Telegram with the amount, wallet and admin link, and survives a failure", async () => {
  const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
  await alertPayoutRequested(30000, "0xabc", { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_SUPPORT_CHAT_ID: "1", APP_DOMAIN: "example.com" }, fetcher as never);
  const sent = JSON.parse((fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body).text as string;
  expect(sent).toContain("30,000 G$"); expect(sent).toContain("0xabc"); expect(sent).toContain("https://example.com/home/referrals/admin");
  expect(await alertPayoutRequested(1, "0x", {}, fetcher as never)).toBe(false);
  expect(await alertPayoutRequested(1, "0x", { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_SUPPORT_CHAT_ID: "1" }, vi.fn(async () => { throw new Error("down"); }) as never)).toBe(false);
});

it("verifies the webhook signature and its five-minute window", () => {
  const raw = '{"id":"e1"}'; const t = 1_800_000_000;
  const sig = (s: string) => `t=${t},v1=${createHmac("sha256", s).update(`${t}.${raw}`).digest("hex")}`;
  expect(verifyGoodCashSignature(raw, sig("whsec_a"), "whsec_a", t + 10)).toBe(true);
  expect(verifyGoodCashSignature(raw, sig("whsec_b"), "whsec_a", t + 10)).toBe(false);
  expect(verifyGoodCashSignature(raw, sig("whsec_a"), "whsec_a", t + 301)).toBe(false);
  expect(verifyGoodCashSignature(`${raw} `, sig("whsec_a"), "whsec_a", t)).toBe(false);
  expect(verifyGoodCashSignature(raw, null, "whsec_a", t)).toBe(false);
});
