"use client";
import * as React from "react";
import { celo } from "viem/chains";
import { parseUnits, type Address, type Hex } from "viem";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/context";
import { GOODDOLLAR_MAINNET } from "@/config/gooddollar";
import { SUPPORT_TELEGRAM_URL } from "@/config/site-links";
import { TRANSFER_AND_CALL_ABI, checkCashOutTx, cashOutStatusText, formatNaira, isFinalStatus, type Bank, type CashOutOrder, type CashOutTx, type Quote } from "@/lib/goodcash/cashout";

export interface CashOutSummary { id: string; status: string; amountG: number; naira: number; bankName: string; accountName: string; accountLast4: string; txHash: string | null; paidAt: string | null }

interface Info { amountG: number; banks: Bank[]; limits: { minimumG: number; maximumG: number }; quote: Quote; networkFee: { enough: boolean } | null }
interface Started { cashOut: CashOutSummary; transaction: CashOutTx; order: CashOutOrder; testMode: boolean; fees: Quote["fees"] }

class ApiError extends Error {}
async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.message ?? "Something went wrong. Please try again.");
  return data as T;
}

const field = "w-full rounded-block border border-grey-200 bg-surface px-3 py-2 text-sm";
const primary = "rounded-full bg-violet px-5 py-2 text-sm font-medium text-white disabled:opacity-50";

/** Plain-words line under a payout once it has a cash out (D179). */
export function CashOutLine({ c }: { c: CashOutSummary }) {
  return (
    <p className="mt-2 text-sm">
      {formatNaira(c.naira)} to {c.bankName} ····{c.accountLast4} · <span className={c.status === "paid" ? "font-medium text-success" : ""}>{cashOutStatusText(c.status)}</span>
    </p>
  );
}

/** One button, then bank and account number, then the wallet asks to confirm. Money goes straight from the wallet to GoodCash. */
export function CashOutButton({ payoutId, amountG, onChanged }: { payoutId: string; amountG: number; onChanged: () => void }) {
  const auth = useAuth();
  const [open, setOpen] = React.useState(false);
  const [info, setInfo] = React.useState<Info | null>(null);
  const [bank, setBank] = React.useState("");
  const [number, setNumber] = React.useState("");
  const [verified, setVerified] = React.useState<{ key: string; name: string } | null>(null);
  const name = verified && verified.key === `${bank}:${number}` ? verified.name : "";
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [final, setFinal] = React.useState<CashOutSummary | null>(null);
  const attempt = React.useRef("");

  async function begin() {
    setOpen(true); setError(""); setFinal(null); setVerified(null); setInfo(null);
    attempt.current = crypto.randomUUID().replaceAll("-", "");
    try { setInfo(await api<Info>(`/api/ambassador/cashout?payoutId=${payoutId}`)); }
    catch (e) { setError((e as Error).message); }
  }
  // The bank's own name for the account, so a typo never sends money to a stranger.
  React.useEffect(() => {
    if (!bank || !/^\d{10}$/.test(number)) return;
    let stop = false;
    api<{ accountName: string }>("/api/ambassador/cashout", { action: "verify", bankCode: bank, accountNumber: number })
      .then(r => { if (!stop) { setError(""); setVerified({ key: `${bank}:${number}`, name: r.accountName }); } })
      .catch(e => { if (!stop) setError((e as Error).message); });
    return () => { stop = true; };
  }, [bank, number]);

  async function track(id: string) {
    for (let i = 0; i < 90; i++) {
      const { cashOut } = await api<{ cashOut: CashOutSummary }>(`/api/ambassador/cashout/${id}`);
      setFinal(cashOut);
      if (isFinalStatus(cashOut.status)) return;
      await new Promise(r => setTimeout(r, 4000));
    }
  }
  async function confirm() {
    if (!info || !name) return;
    setError(""); setBusy("Getting your cash out ready…");
    try {
      const started = await api<Started>("/api/ambassador/cashout", { action: "start", payoutId, bankCode: bank, accountNumber: number, feePercentShown: info.quote.feePercent, attemptKey: attempt.current });
      const amountWei = parseUnits(String(amountG), 18);
      const check = checkCashOutTx(started.transaction, started.order, amountWei, { testMode: started.testMode });
      if (!check.ok) throw new ApiError("Something didn't look right with this cash out, so we stopped it. Nothing was sent.");
      setFinal(started.cashOut);
      setBusy("Confirm in your wallet…");
      await auth.switchChain(celo.id);
      const client = await auth.getWalletClient();
      const [account] = await client.getAddresses();
      if (!account || !auth.user?.wallet || account.toLowerCase() !== auth.user.wallet.toLowerCase()) throw new ApiError("Switch back to the wallet you signed in with.");
      let hash: Hex;
      try {
        hash = await client.writeContract({ account, chain: celo, address: GOODDOLLAR_MAINNET, abi: TRANSFER_AND_CALL_ABI, functionName: "transferAndCall", args: [started.order.router as Address, check.amountWei, check.data] });
      } catch { throw new ApiError("Nothing was sent. When you're ready, tap Cash out again."); }
      setBusy("Sending to your bank…");
      for (let i = 0; i < 10; i++) {
        try { await api(`/api/ambassador/cashout/${started.cashOut.id}`, { txHash: hash }); break; }
        catch (e) { if (i === 9) throw e; await new Promise(r => setTimeout(r, 3000)); }
      }
      await track(started.cashOut.id);
      onChanged();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }

  const naira = info ? Math.floor(info.quote.receive.naira) : 0;
  const low = info ? amountG < info.limits.minimumG : false;
  return (
    <>
      <button className={primary} onClick={() => void begin()}>Cash out to Naira</button>
      <Dialog open={open} onOpenChange={next => { if (!busy) { setOpen(next); if (!next) onChanged(); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[440px]">
          <DialogTitle className="pr-8 text-xl font-bold">Cash out to your bank</DialogTitle>
          <DialogDescription className="text-sm text-grey-600">Your {amountG.toLocaleString("en-US")} G$ goes to a Nigerian bank account, powered by GoodCash.</DialogDescription>
          {final?.status === "paid" ? <p role="status" className="rounded-block bg-success/10 p-4 text-sm text-success">Done. {formatNaira(final.naira)} is in your {final.bankName} account.</p>
            : final && isFinalStatus(final.status) ? <p role="alert" className="rounded-block bg-danger/10 p-4 text-sm text-danger">{cashOutStatusText(final.status)}. Your G$ is safe in your wallet. Try again, or <a className="underline" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noreferrer">message us on Telegram</a>.</p>
            : final && !busy ? <p role="status" className="rounded-block bg-tint p-4 text-sm">{cashOutStatusText(final.status)}. This usually takes a few minutes. You can close this and come back.</p>
            : !info ? (error ? null : <div className="skeleton h-40 rounded-card motion-reduce:animate-none" />)
            : <div className="space-y-4">
              <div className="rounded-block bg-tint p-4">
                <p className="text-xs text-grey-600">You will receive about</p>
                <p className="display text-3xl font-bold text-violet tabular-nums">{formatNaira(naira)}</p>
                {info.quote.fees.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-grey-600">{info.quote.fees.map(f => <li key={f.type}>{f.label}{typeof f.naira === "number" ? `: ${formatNaira(f.naira)}` : ""}</li>)}</ul>}
                <p className="mt-2 text-xs text-grey-600">The exact amount is confirmed before you sign. It can change a little with the G$ price.</p>
              </div>
              {low && <p role="alert" className="text-sm text-danger">The least you can cash out is {info.limits.minimumG.toLocaleString("en-US")} G$.</p>}
              {info.networkFee && !info.networkFee.enough && <p role="alert" className="text-sm text-danger">Your wallet needs a small network fee (a little CELO) to send this. <a className="underline" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noreferrer">Message us on Telegram</a> and we&apos;ll help.</p>}
              <label className="block text-sm font-medium">Bank
                <select className={`${field} mt-1`} value={bank} onChange={e => setBank(e.target.value)}>
                  <option value="">Choose your bank</option>
                  {info.banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Account number
                <input className={`${field} mt-1`} inputMode="numeric" autoComplete="off" maxLength={10} placeholder="10 digits" value={number} onChange={e => setNumber(e.target.value.replace(/\D/g, ""))} />
              </label>
              {name && <p className="text-sm">Account name: <span className="font-semibold">{name}</span></p>}
              <button className={`${primary} w-full`} disabled={!!busy || !name || low || (!!info.networkFee && !info.networkFee.enough)} onClick={() => void confirm()}>{busy || `Cash out ${formatNaira(naira)}`}</button>
            </div>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <p className="text-center text-[11px] text-grey-600">Powered by GoodCash</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
