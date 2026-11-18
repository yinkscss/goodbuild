"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FreeCreditsCard } from "@/components/credits/free-credits-card";
import { TopUpPill } from "@/components/credits/top-up-pill";
import { useCreditsInfo } from "@/components/credits/use-buy-credits";

/** What one build reserves (RESERVED_PER_BUILD_MICRO in server/credits/cap.ts). */
const BUILD_RESERVE_MICRO = 350_000;

/**
 * Opens by itself when a build stops for lack of credits (D129). Two ways on: pay in G$ (the exact amount the build
 * needs, one click, which retries the build when it lands), or the free credits, where the card shows only the step this
 * person still has left (verify, vote, or nothing). "Continue building" appears once the balance covers a build, so it
 * never resends a prompt that would stop again. Closing it leaves the inline Pay with G$ pill in the chat.
 */
export function OutOfCredits({ open, freeCredits, onContinue, onRefresh }: { open: boolean; freeCredits: boolean; onContinue: () => void; onRefresh: () => unknown }) {
  const [dismissed, setDismissed] = React.useState(false);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    // A new out-of-credits stop opens it again even if the last one was closed.
    setWasOpen(open);
    if (open) setDismissed(false);
  }
  const { pricing, reload } = useCreditsInfo(open && !dismissed);
  const enough = (pricing?.balanceMicro ?? 0) >= BUILD_RESERVE_MICRO;

  if (!open) return null;
  // One pill at a time, so a payment can't retry the build twice.
  if (dismissed) return <TopUpPill onPaid={onContinue} />;
  return (
    <Dialog open onOpenChange={(v) => !v && setDismissed(true)}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle className="pr-10 text-xl font-semibold">You&apos;re out of credits</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-grey-600">Add some to keep building. Your project is saved.</DialogDescription>
        <div className="mt-5 grid gap-3">
          <TopUpPill onPaid={onContinue} />
          {freeCredits && (
            <FreeCreditsCard
              compact
              onChange={async () => {
                await onRefresh();
                reload();
              }}
            />
          )}
        </div>
        {enough && (
          <Button variant="primary" className="mt-5 w-full" onClick={onContinue}>
            Continue building
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
