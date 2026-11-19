"use client";

import * as React from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AddCredits } from "./add-credits";
import { FreeCreditsCard } from "./free-credits-card";

const SEEN_KEY = "gb:start-credits:seen";

/**
 * Greets someone on home who has no credits and has never bought any (D131). Two ways to start: add credits, or get
 * free ones, where the card shows only the step this person still has left (verify, then "support our project by
 * voting"). It comes back until they close it (verify goes to GoodDollar and back, and the vote step must still be
 * there), then stays closed for the browser session. Once credits land, home stops rendering it.
 */
export function StartCredits({ freeCredits }: { freeCredits: boolean }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // Storage blocked: show it.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser storage, which only exists after mount
    if (!seen) setOpen(true);
  }, []);
  const close = (next: boolean) => {
    setOpen(next);
    if (next) return;
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Storage blocked: it shows again next time, which is harmless.
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle className="pr-10 text-xl font-semibold">Get credits to start building</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-grey-600">Credits pay for the AI that builds your app. Pick one to begin.</DialogDescription>
        <div className="mt-5 grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-block bg-tint p-4 text-sm">
            <p className="min-w-0 flex-1">
              <b>Add credits</b> <span className="text-grey-600">and start right away.</span>
            </p>
            <AddCredits />
          </div>
          {freeCredits && <FreeCreditsCard compact />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
