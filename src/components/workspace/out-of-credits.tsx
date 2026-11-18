"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FreeCreditsCard } from "@/components/credits/free-credits-card";
import { TopUpPill } from "@/components/credits/top-up-pill";

/**
 * Opens by itself when a build stops for lack of credits (D129). Two ways on: pay in G$ (the exact amount the build
 * needs, one click), or the free credits, where the card shows only the step this person still has left (verify,
 * vote, or nothing). Closing it leaves the inline Pay with G$ pill in the chat.
 */
export function OutOfCredits({ open, freeCredits, onContinue, onRefresh }: { open: boolean; freeCredits: boolean; onContinue: () => void; onRefresh: () => unknown }) {
  const [dismissed, setDismissed] = React.useState(false);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    // A new out-of-credits stop opens it again even if the last one was closed.
    setWasOpen(open);
    if (open) setDismissed(false);
  }

  return (
    <Dialog open={open && !dismissed} onOpenChange={(v) => !v && setDismissed(true)}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle className="pr-10 text-xl font-semibold">You&apos;re out of credits</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-grey-600">Add some to keep building. Your project is saved.</DialogDescription>
        <div className="mt-5 grid gap-3">
          <TopUpPill onPaid={onContinue} />
          {freeCredits && <FreeCreditsCard compact onChange={onRefresh} />}
        </div>
        <Button variant="secondary" className="mt-5 w-full" onClick={onContinue}>
          Continue building
        </Button>
      </DialogContent>
    </Dialog>
  );
}
