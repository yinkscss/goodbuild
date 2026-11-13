"use client";

import * as React from "react";

import { BuyDialog } from "@/components/buy/buy-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MICRO_PER_CREDIT, formatCredits, formatCreditsShort } from "@/lib/credits-math";
import { isTxHash, redeemTx, shortHash, type RedeemOutcome } from "./pending-payments";
import { UNITS, estimateGdWei, formatGd, useBuyCredits, useCreditsInfo, type ChainInfo } from "./use-buy-credits";

const PRESET_CREDITS = [100, 500, 1000, 2500];

/**
 * "Add credits" (D56): buy AI credits with G$ in one signature, any amount from 35 credits. One credit is 1 cent
 * of AI builds (100 credits = $1), shown as credits; the ledger and the server stay in micro-USD. The server prices the amount in G$ and signs a quote; the wallet sends that exact G$ to the credits
 * contract; the contract burns the credits out of its fixed supply and the server credits the ledger from the
 * event. People verified with GoodDollar get 10% more credits. The screen never decides the balance.
 */
export function AddCredits({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const { info, pricing, reload } = useCreditsInfo(open);
  const { phase, setPhase, buy, wallet, recoveredMicro } = useBuyCredits(info);
  const [credits, setCredits] = React.useState("100");
  const [buyAsset, setBuyAsset] = React.useState<"g" | "celo" | null>(null);

  const amountMicro = Math.round(Number(credits) * MICRO_PER_CREDIT);
  const min = pricing?.minMicro ?? 350_000;
  const max = pricing?.maxMicro ?? 900 * UNITS;
  const valid = Number.isFinite(amountMicro) && amountMicro >= min && amountMicro <= max;
  const gd = pricing && valid ? estimateGdWei(pricing, amountMicro) : null;
  const bonusMicro = pricing?.verified ? Math.floor(amountMicro / 10) : 0;
  const busy = phase.name === "signing" || phase.name === "crediting";

  // A saved payment from an earlier visit was just credited: show the new balance.
  React.useEffect(() => {
    if (recoveredMicro > 0 && open) reload();
  }, [recoveredMicro, open, reload]);

  return (
    <>
      <Button variant="secondary" className={className} onClick={() => { setPhase({ name: "idle" }); setOpen(true); }}>
        Add credits
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="sm:w-[440px]">
          <DialogTitle className="display text-xl font-bold">Add AI credits</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-grey-600">
            Pay with G$. Each build uses a few credits, and you can add as little as {formatCredits(min)}. Credits pay for AI, not for network fees, and they are not a token you can trade.
          </DialogDescription>
          {(info === undefined || pricing === undefined) && <p className="mt-5 text-sm text-grey-600">Checking…</p>}
          {info === null && <p className="mt-5 text-sm text-grey-600">Credits aren&apos;t switched on yet. Your free AI still works.</p>}
          {info && pricing === null && <p className="mt-5 text-sm text-grey-600">We can&apos;t price G$ right now. Try again in a minute.</p>}
          {info && pricing && (
            <div className="mt-5 space-y-4">
              <div role="radiogroup" aria-label="Amount" className="grid grid-cols-4 gap-2">
                {PRESET_CREDITS.map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={Number(credits) === p} disabled={busy} onClick={() => setCredits(String(p))} className={`rounded-2xl px-2 py-2.5 text-center text-sm font-semibold ${Number(credits) === p ? "bg-violet text-white" : "bg-tint text-ink"}`}>
                    {p.toLocaleString("en-US")}
                  </button>
                ))}
              </div>
              <label className="block text-sm">
                <span className="text-grey-600">Or choose an amount of credits</span>
                <input type="number" inputMode="numeric" min={min / MICRO_PER_CREDIT} max={max / MICRO_PER_CREDIT} step="5" value={credits} disabled={busy} onChange={(e) => setCredits(e.target.value)} className="mt-1 w-full rounded-full bg-tint px-4 py-2.5 text-sm outline-none focus-visible:shadow-focus" />
              </label>
              <p className="text-sm">
                {gd ? (
                  <>
                    You pay about <b>{formatGd(gd)} G$</b> and get <b>{formatCredits(amountMicro)}</b>{bonusMicro > 0 && <>, plus <b>{formatCredits(bonusMicro)}</b> bonus for being verified</>}.
                  </>
                ) : (
                  <span className="text-warning">Pick an amount from {formatCreditsShort(min)} to {formatCreditsShort(max)} credits.</span>
                )}
              </p>
              {!pricing.verified && valid && (
                <p className="rounded-xl bg-tint px-3 py-2 text-xs text-grey-600">
                  Verify with GoodDollar for <b>10% more credits</b> on every purchase, up to 1,000 bonus credits a month per person.{" "}
                  <a className="underline" href="https://goodid.gooddollar.org" target="_blank" rel="noopener noreferrer">Verify</a>
                </p>
              )}
              {phase.name === "error" && (
                <p role="alert" className="text-sm text-warning">
                  {phase.message}{" "}
                  {(phase.needsGd || phase.needsCelo) && (
                    <button type="button" className="font-semibold underline" onClick={() => setBuyAsset(phase.needsGd ? "g" : "celo")}>
                      {phase.needsGd ? "Buy G$" : "Buy CELO"}
                    </button>
                  )}
                </p>
              )}
              {phase.name === "crediting" && <p role="status" className="text-sm text-grey-600">Payment sent. Adding your credit…</p>}
              {phase.name === "paid" && (
                <div role="status" className="space-y-1 rounded-xl bg-tint px-3 py-2 text-sm text-grey-600">
                  <p>
                    <b className="text-ink">Your G$ payment went through.</b> The credit is still being added and usually shows within a few minutes, even if you close this.
                  </p>
                  <p>
                    Transaction: <span className="select-all break-all font-mono text-xs text-ink">{phase.hash}</span>
                  </p>
                  <p>If it hasn&apos;t arrived in an hour, use &ldquo;Missing a payment?&rdquo; below with this transaction.</p>
                </div>
              )}
              {recoveredMicro > 0 && phase.name !== "done" && (
                <p role="status" className="text-sm text-success">
                  We added {formatCredits(recoveredMicro)} from an earlier payment.
                </p>
              )}
              {phase.name === "done" && (
                <p role="status" className="text-sm text-success">
                  Added {formatCredits(phase.addedMicro)}. Your balance is {formatCredits(phase.balanceMicro)}.
                </p>
              )}
              <Button variant="primary" className="w-full" disabled={busy || !valid || !wallet || phase.name === "done" || phase.name === "paid"} onClick={() => void buy(amountMicro)}>
                {phase.name === "signing" ? "Confirm in your wallet…" : phase.name === "crediting" ? "Adding credit…" : "Pay with G$"}
              </Button>
              <p className="text-center text-xs text-grey-600">Price follows the live G$ market price, quoted for 10 minutes. Keep about 0.1 CELO in your wallet for the network fee.</p>
              <MissingPayment key={phase.name === "paid" ? phase.hash : "form"} info={info} onCredited={reload} initialHash={phase.name === "paid" ? phase.hash : ""} />
            </div>
          )}
          <p className="mt-4 text-center text-sm text-grey-600">
            Short on G$ or CELO?{" "}
            <button type="button" className="font-semibold text-ink underline" onClick={() => setBuyAsset("g")}>
              Buy with naira
            </button>
          </p>
        </DialogContent>
      </Dialog>
      <BuyDialog open={buyAsset !== null} onOpenChange={(v) => !v && setBuyAsset(null)} defaultAsset={buyAsset ?? "g"} onDelivered={() => { reload(); setPhase({ name: "idle" }); }} />
    </>
  );
}

const MISSING_MESSAGES: Record<RedeemOutcome["kind"], string> = {
  credited: "",
  not_credits: "That transaction isn't a completed GoodBuild credits payment on this network, so there is nothing to add.",
  pending: "That transaction isn't confirmed yet. Try again in a minute.",
  failed: "We couldn't check that right now. Try again in a minute.",
};

/**
 * "Missing a payment?" (GB-01): paste the transaction from your wallet's activity and the server reads it
 * on-chain and credits whoever the contract says paid. Safe to use any number of times: a payment credits once,
 * and someone else's transaction can only credit that wallet, never the one asking.
 */
function MissingPayment({ info, onCredited, initialHash }: { info: ChainInfo; onCredited: () => void; initialHash: string }) {
  const [open, setOpen] = React.useState(false);
  const [hash, setHash] = React.useState(initialHash);
  const [checking, setChecking] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const trimmed = hash.trim();
  const check = async () => {
    setChecking(true);
    setResult(null);
    const out = await redeemTx(info.chainId, trimmed);
    setChecking(false);
    if (out.kind === "credited") {
      onCredited();
      setResult({ ok: true, text: out.addedMicro > 0 ? `Added ${formatCredits(out.addedMicro)}. Your balance is ${formatCredits(out.balanceMicro)}.` : `That payment ${shortHash(trimmed)} was already credited. Your balance is ${formatCredits(out.balanceMicro)}.` });
    } else {
      setResult({ ok: false, text: out.kind === "failed" && out.message ? out.message : MISSING_MESSAGES[out.kind] });
    }
  };

  if (!open) {
    return (
      <p className="text-center text-xs text-grey-600">
        Paid but no credit?{" "}
        <button type="button" className="font-semibold text-ink underline" onClick={() => setOpen(true)}>
          Missing a payment?
        </button>
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-xl bg-tint px-3 py-3 text-sm">
      <label className="block">
        <span className="text-grey-600">Transaction from your wallet&apos;s activity (starts with 0x)</span>
        <input value={hash} onChange={(e) => setHash(e.target.value)} spellCheck={false} autoComplete="off" placeholder="0x…" className="mt-1 w-full rounded-full bg-white px-4 py-2.5 font-mono text-xs outline-none focus-visible:shadow-focus" />
      </label>
      <Button variant="secondary" className="w-full" disabled={checking || !isTxHash(trimmed)} onClick={() => void check()}>
        {checking ? "Checking…" : "Check and add credit"}
      </Button>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-success" : "text-warning"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
