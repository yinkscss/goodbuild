"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { UNITS, estimateGdWei, formatGd, useBuyCredits, useCreditsInfo } from "./use-buy-credits";

/** What one build reserves (RESERVED_PER_BUILD_MICRO in server/credits/cap.ts): the amount a person needs on hand to start one. */
const BUILD_RESERVE_MICRO = 350_000;

/**
 * Shown in the chat when a build can't run because the AI credit is used up. It says the exact amount that would
 * cover the build (the build reserve less what is left, never under the $0.35 minimum), prices it in G$, and one click
 * signs the payment. When the credit lands, `onPaid` retries the build.
 */
export function TopUpPill({ onPaid }: { onPaid?: () => void }) {
  const { info, pricing } = useCreditsInfo(true);
  const { phase, buy, wallet } = useBuyCredits(info);

  const min = pricing?.minMicro ?? 350_000;
  const shortfall = Math.max(BUILD_RESERVE_MICRO - (pricing?.balanceMicro ?? 0), 0);
  const amountMicro = Math.min(Math.max(Math.ceil(shortfall / 50_000) * 50_000, min), pricing?.maxMicro ?? 900 * UNITS);
  const gd = pricing ? estimateGdWei(pricing, amountMicro) : null;
  const busy = phase.name === "signing" || phase.name === "crediting";

  if (info === null || pricing === null) return null; // not switched on, or G$ can't be priced: the plain message above is all there is
  if (info === undefined || pricing === undefined) return <p className="flex items-center gap-2 text-sm text-grey-600" role="status"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Checking the price…</p>;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-block bg-tint px-4 py-3 text-sm" role="status">
      <p className="min-w-0 flex-1">
        {phase.name === "done" ? (
          <b>Added ${(phase.addedMicro / UNITS).toFixed(2)}. You can keep building.</b>
        ) : phase.name === "error" ? (
          <span className="text-warning">{phase.message}</span>
        ) : (
          <>
            Add <b>${(amountMicro / UNITS).toFixed(2)}</b> to keep building{gd ? <> (about <b>{formatGd(gd)} G$</b>)</> : null}.{" "}
            <span className="text-grey-600">Keep about 0.1 CELO in your wallet for the network fee.</span>
          </>
        )}
      </p>
      <Button
        variant="primary"
        size="sm"
        disabled={busy || !wallet || !gd}
        onClick={() => {
          if (phase.name === "done") return onPaid?.();
          void buy(amountMicro).then((ok) => ok && onPaid?.());
        }}
      >
        {phase.name === "signing" ? "Confirm in your wallet…" : phase.name === "crediting" ? "Adding credit…" : phase.name === "done" ? "Continue" : "Pay with G$"}
      </Button>
    </div>
  );
}
