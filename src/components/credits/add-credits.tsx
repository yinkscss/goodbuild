"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { UNITS, estimateGdWei, formatGd, useBuyCredits, useCreditsInfo } from "./use-buy-credits";

const PRESET_DOLLARS = [1, 5, 10, 25];

/**
 * "Add credits" (D56): buy AI credits with G$ in one signature, any amount from $0.25. One credit is $1 of AI
 * builds. The server prices the amount in G$ and signs a quote; the wallet sends that exact G$ to the credits
 * contract; the contract burns the credits out of its fixed supply and the server credits the ledger from the
 * event. People verified with GoodDollar get 10% more credits. The screen never decides the balance.
 */
export function AddCredits({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const { info, pricing } = useCreditsInfo(open);
  const { phase, setPhase, buy, wallet } = useBuyCredits(info);
  const [dollars, setDollars] = React.useState("1");

  const amountMicro = Math.round(Number(dollars) * UNITS);
  const min = pricing?.minMicro ?? 250_000;
  const max = pricing?.maxMicro ?? 900 * UNITS;
  const valid = Number.isFinite(amountMicro) && amountMicro >= min && amountMicro <= max;
  const gd = pricing && valid ? estimateGdWei(pricing, amountMicro) : null;
  const bonusMicro = pricing?.verified ? Math.floor(amountMicro / 10) : 0;
  const busy = phase.name === "signing" || phase.name === "crediting";

  return (
    <>
      <Button variant="secondary" className={className} onClick={() => { setPhase({ name: "idle" }); setOpen(true); }}>
        Add credits
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogTitle className="display text-xl font-bold">Add AI credits</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-grey-600">
            Pay with G$. $1 of credit is $1 of AI builds, and you can add as little as ${min / UNITS}. Credits pay for AI, not for network fees, and they are not a token you can trade.
          </DialogDescription>
          {(info === undefined || pricing === undefined) && <p className="mt-5 text-sm text-grey-600">Checking…</p>}
          {info === null && <p className="mt-5 text-sm text-grey-600">Credits aren&apos;t switched on yet. Your free AI still works.</p>}
          {info && pricing === null && <p className="mt-5 text-sm text-grey-600">We can&apos;t price G$ right now. Try again in a minute.</p>}
          {info && pricing && (
            <div className="mt-5 space-y-4">
              <div role="radiogroup" aria-label="Amount" className="grid grid-cols-4 gap-2">
                {PRESET_DOLLARS.map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={Number(dollars) === p} disabled={busy} onClick={() => setDollars(String(p))} className={`rounded-2xl px-2 py-2.5 text-center text-sm font-semibold ${Number(dollars) === p ? "bg-violet text-white" : "bg-tint text-ink"}`}>
                    ${p}
                  </button>
                ))}
              </div>
              <label className="block text-sm">
                <span className="text-grey-600">Or choose an amount (USD)</span>
                <input type="number" inputMode="decimal" min={min / UNITS} max={max / UNITS} step="0.05" value={dollars} disabled={busy} onChange={(e) => setDollars(e.target.value)} className="mt-1 w-full rounded-full bg-tint px-4 py-2.5 text-sm outline-none focus-visible:shadow-focus" />
              </label>
              <p className="text-sm">
                {gd ? (
                  <>
                    You pay about <b>{formatGd(gd)} G$</b> and get <b>${(amountMicro / UNITS).toFixed(2)}</b> of credit{bonusMicro > 0 && <>, plus <b>${(bonusMicro / UNITS).toFixed(2)}</b> bonus for being verified</>}.
                  </>
                ) : (
                  <span className="text-warning">Pick an amount from ${min / UNITS} to ${max / UNITS}.</span>
                )}
              </p>
              {!pricing.verified && valid && (
                <p className="rounded-xl bg-tint px-3 py-2 text-xs text-grey-600">
                  Verify with GoodDollar for <b>10% more credits</b> on every purchase, up to $10 of bonus a month per person.{" "}
                  <a className="underline" href="https://goodid.gooddollar.org" target="_blank" rel="noopener noreferrer">Verify</a>
                </p>
              )}
              {phase.name === "error" && (
                <p role="alert" className="text-sm text-warning">
                  {phase.message}{" "}
                  {phase.needsGd && (
                    <a className="underline" href="https://www.gooddollar.org" target="_blank" rel="noopener noreferrer">
                      Get G$
                    </a>
                  )}
                </p>
              )}
              {phase.name === "crediting" && <p role="status" className="text-sm text-grey-600">Payment sent. Adding your credit…</p>}
              {phase.name === "done" && (
                <p role="status" className="text-sm text-success">
                  Added ${(phase.addedMicro / UNITS).toFixed(2)}. Your balance is ${(phase.balanceMicro / UNITS).toFixed(2)}.
                </p>
              )}
              <Button variant="primary" className="w-full" disabled={busy || !valid || !wallet || phase.name === "done"} onClick={() => void buy(amountMicro)}>
                {phase.name === "signing" ? "Confirm in your wallet…" : phase.name === "crediting" ? "Adding credit…" : "Pay with G$"}
              </Button>
              <p className="text-center text-xs text-grey-600">Price follows the live G$ market price, quoted for 10 minutes. Keep about 0.1 CELO in your wallet for the network fee.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
