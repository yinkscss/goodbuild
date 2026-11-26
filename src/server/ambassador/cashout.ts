import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { parseUnits } from "viem";
import type { Db } from "@/server/db/client";
import { ambassadorAudit as audit, ambassadorCashouts as cashouts, ambassadorPayouts as payouts } from "@/server/db/ambassador-schema";
import { cashOutApi, cashOutMode, GoodCashError, type GcCashOut } from "@/server/goodcash/client";
import { checkCashOutTx, isFinalStatus } from "@/lib/goodcash/cashout";
import { AmbassadorError } from "@/server/ambassador/service";

/**
 * Ambassador cash-out to a Nigerian bank (D173). Flow: the admin has sent the G$ to the person's wallet (payout status
 * `paid`), then the person gives a bank and account number, sees the live Naira amount, and signs ONE transfer in their
 * own wallet. GoodCash pays the bank. We never hold keys, and keep only the bank name, account name and last 4 digits.
 */

export type CashOutRow = typeof cashouts.$inferSelect;
type Api = typeof cashOutApi;

/** An unsigned attempt blocks a new one for this long (GoodCash orders close after about 15 minutes). */
const OPEN_ATTEMPT_MS = 20 * 60_000;
export const ATTEMPT_KEY = /^[A-Za-z0-9_-]{8,48}$/;
export const ACCOUNT_NUMBER = /^\d{10}$/;

const UNSAFE = "Something didn't look right with this cash out, so we stopped it. Nothing was sent. Please try again.";

/** What the person and the admin see. Never the full account number (we never keep it). */
export function cashOutView(r: CashOutRow) {
  return {
    id: r.id, payoutId: r.payoutId, status: r.status, amountG: r.amountG, naira: r.naira, bankName: r.bankName, accountName: r.accountName,
    accountLast4: r.accountLast4, txHash: r.txHash, createdAt: r.createdAt, paidAt: r.paidAt,
  };
}
export type CashOutView = ReturnType<typeof cashOutView>;

async function ownPayout(db: Db, userId: string, payoutId: string) {
  const [p] = await db.select().from(payouts).where(and(eq(payouts.id, payoutId), eq(payouts.userId, userId)));
  if (!p) throw new AmbassadorError("We couldn't find that payout.");
  return p;
}

/** Everything the cash-out screen needs: banks, the least a person can cash out, and the live amount in Naira. */
export async function cashOutInfo(db: Db, user: { id: string; wallet: string }, payoutId: string, api: Api = cashOutApi) {
  if (!cashOutMode()) throw new AmbassadorError("Cashing out isn't switched on yet.");
  const p = await ownPayout(db, user.id, payoutId);
  if (p.status !== "paid") throw new AmbassadorError("This payout isn't ready to cash out yet.");
  const [banks, limits, quote, fee] = await Promise.all([api.banks(), api.limits(), api.quote(String(p.amountG)), api.networkFee(p.wallet).catch(() => null)]);
  return { amountG: p.amountG, wallet: p.wallet, banks, limits, quote, networkFee: fee ? { enough: fee.enough } : null };
}

export async function verifyAccount(bankCode: string, accountNumber: string, api: Api = cashOutApi) {
  const r = await api.verify(bankCode, accountNumber);
  if (!r.accountName) throw new AmbassadorError("We couldn't find that account. Check the bank and the number.");
  return r.accountName;
}

export async function startCashOut(
  db: Db,
  user: { id: string; wallet: string },
  input: { payoutId: string; bankCode: string; accountNumber: string; feePercentShown: number; attemptKey: string },
  api: Api = cashOutApi,
) {
  const mode = cashOutMode();
  if (!mode) throw new AmbassadorError("Cashing out isn't switched on yet.");
  const p = await ownPayout(db, user.id, input.payoutId);
  if (p.status !== "paid") throw new AmbassadorError("This payout isn't ready to cash out yet.");
  // The G$ was sent to this wallet; only this wallet can sign for it.
  if (p.wallet.toLowerCase() !== user.wallet.toLowerCase()) throw new AmbassadorError("Sign in with the wallet that received this payout.");
  const rows = await db.select().from(cashouts).where(eq(cashouts.payoutId, p.id)).orderBy(desc(cashouts.createdAt));
  if (rows.some(r => r.status === "sent" || r.status === "processing" || r.status === "paid")) throw new AmbassadorError("This payout is already being cashed out.");
  for (const open of rows.filter(r => r.status === "awaiting_signature")) {
    // An earlier attempt that was never signed: GoodCash's view decides; one still open after its time is released.
    const gc = await api.get(open.goodcashId).catch(() => null);
    const latest = gc ? await applyGoodCash(db, open, gc) : open;
    if (latest.status === "sent" || latest.status === "processing" || latest.status === "paid") throw new AmbassadorError("This payout is already being cashed out.");
    if (latest.status === "awaiting_signature") {
      if (Date.now() - latest.createdAt.getTime() < OPEN_ATTEMPT_MS) throw new AmbassadorError("Your last attempt is still open. Give it a few minutes, then try again.");
      await db.update(cashouts).set({ status: "expired", updatedAt: new Date() }).where(eq(cashouts.id, latest.id));
    }
  }

  const accountName = await verifyAccount(input.bankCode, input.accountNumber, api);
  const [limits, banks] = await Promise.all([api.limits(), api.banks().catch(() => [])]);
  if (p.amountG < limits.minimumG) throw new AmbassadorError(`The least you can cash out is ${limits.minimumG.toLocaleString("en-US")} G$.`);
  if (p.amountG > limits.maximumG) throw new AmbassadorError(`The most you can cash out at once is ${limits.maximumG.toLocaleString("en-US")} G$. Message us on Telegram and we'll help.`);

  const attempt = `gb_${input.attemptKey}`;
  let created;
  try {
    created = await api.create({ wallet: p.wallet, amountG: String(p.amountG), recipient: { bankCode: input.bankCode, accountNumber: input.accountNumber, accountName }, partnerRef: attempt, feePercentShown: input.feePercentShown }, attempt);
  } catch (e) {
    if (e instanceof GoodCashError && e.gcCode === "fee_mismatch") throw new AmbassadorError("The price just changed. Go back and look at the new amount.");
    if (e instanceof GoodCashError && e.gcCode === "insufficient_balance") throw new AmbassadorError("The G$ isn't in your wallet any more. Check your wallet balance.");
    throw e;
  }
  const check = checkCashOutTx(created.transaction, created.order, parseUnits(String(p.amountG), 18), { testMode: mode === "test" });
  if (!check.ok) {
    console.error(`[ambassador cashout] refused GoodCash transaction ${created.id}: ${check.reason}`);
    throw new AmbassadorError(UNSAFE);
  }
  const naira = Math.floor(created.receive?.naira ?? 0);
  const bankName = banks.find(b => b.code === input.bankCode)?.name ?? input.bankCode;
  const row = await db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ambassador-accounting'))`);
    const [existing] = await tx.select().from(cashouts).where(eq(cashouts.goodcashId, created.id));
    if (existing) return existing;
    const [inserted] = await tx.insert(cashouts).values({ payoutId: p.id, userId: user.id, wallet: p.wallet, goodcashId: created.id, mode, amountG: p.amountG, naira, status: created.status, bankName, accountName, accountLast4: input.accountNumber.slice(-4) }).onConflictDoNothing().returning();
    if (!inserted) throw new AmbassadorError("This payout is already being cashed out.");
    await tx.insert(audit).values({ actorId: user.id, payoutId: p.id, action: "cashout_started", detail: JSON.stringify({ cashOutId: inserted.id, amountG: p.amountG, naira, bankName, last4: inserted.accountLast4 }) });
    return inserted;
  });
  return { cashOut: cashOutView(row), fees: created.fees ?? [], transaction: created.transaction, order: created.order, testMode: mode === "test" };
}

/** Moves our row to GoodCash's view. A paid cash out never goes back; a final one only moves to paid. */
export async function applyGoodCash(db: Db, row: CashOutRow, gc: GcCashOut): Promise<CashOutRow> {
  if (row.status === "paid") return row;
  if (isFinalStatus(row.status) && gc.status !== "paid") return row;
  if (row.status === gc.status && (row.txHash ?? null) === (gc.txHash ?? null)) return row;
  const naira = Math.floor(gc.receive?.naira ?? row.naira) || row.naira;
  const [next] = await db.update(cashouts).set({ status: gc.status, txHash: gc.txHash?.toLowerCase() ?? row.txHash, naira, updatedAt: new Date(), paidAt: gc.status === "paid" ? new Date(gc.paidAt ?? Date.now()) : row.paidAt }).where(eq(cashouts.id, row.id)).returning();
  if (gc.status === "paid") await db.insert(audit).values({ actorId: row.userId, payoutId: row.payoutId, action: "cashout_paid", detail: JSON.stringify({ cashOutId: row.id, naira }) });
  return next ?? row;
}

async function ownCashOut(db: Db, userId: string, id: string) {
  const [row] = await db.select().from(cashouts).where(and(eq(cashouts.id, id), eq(cashouts.userId, userId)));
  if (!row) throw new AmbassadorError("We couldn't find that cash out.");
  return row;
}

/** The person's wallet has sent the transfer: tell GoodCash which one, then return the new status. */
export async function reportCashOutTx(db: Db, userId: string, id: string, txHash: string, api: Api = cashOutApi) {
  const row = await ownCashOut(db, userId, id);
  const gc = await api.reportTx(row.goodcashId, txHash);
  return cashOutView(await applyGoodCash(db, row, gc));
}

/** Ask GoodCash for the latest (works without a webhook). */
export async function refreshCashOut(db: Db, userId: string, id: string, api: Api = cashOutApi) {
  const row = await ownCashOut(db, userId, id);
  if (isFinalStatus(row.status)) return cashOutView(row);
  const gc = await api.get(row.goodcashId);
  return cashOutView(await applyGoodCash(db, row, gc));
}

/** From a verified webhook. Unknown ids are not ours; ignore them. */
export async function applyWebhookCashOut(db: Db, gc: GcCashOut) {
  const [row] = await db.select().from(cashouts).where(eq(cashouts.goodcashId, gc.id));
  if (!row) return false;
  await applyGoodCash(db, row, gc);
  return true;
}
