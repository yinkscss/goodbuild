"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { retryPending } from "./pending-payments";

export function RefreshCredits() {
  const router = useRouter();
  const [checking, setChecking] = React.useState(false);
  const [refreshing, startTransition] = React.useTransition();
  const [note, setNote] = React.useState<string | null>(null);
  const busy = checking || refreshing;
  const locked = React.useRef(false);
  async function refresh() {
    if (locked.current || busy) return;
    locked.current = true;
    setChecking(true);
    setNote(null);
    try {
      await retryPending(fetch, true);
      startTransition(() => router.refresh());
      setNote("Balance and recent top-ups refreshed. Payments awaiting network confirmation may take a little longer.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "We couldn't refresh your credits. Try again.");
      startTransition(() => router.refresh());
    } finally {
      setChecking(false);
      locked.current = false;
    }
  }
  return <span className="inline-flex items-center gap-2">
    <button type="button" aria-label="Refresh credits" title="Refresh credits" disabled={busy} onClick={() => void refresh()} className="inline-flex size-10 items-center justify-center rounded-full text-violet hover:bg-tint focus-visible:shadow-focus disabled:opacity-60">
      <RefreshCw aria-hidden="true" className={`size-5 ${busy ? "animate-spin motion-reduce:[animation-duration:6s]" : ""}`} />
    </button>
    {busy && <progress aria-label="Refreshing credits" className="sr-only" />}
    <span role="status" className={busy || !note ? "sr-only" : "max-w-64 text-xs font-normal normal-case tracking-normal text-grey-600"}>{busy ? "Checking your credits…" : note}</span>
  </span>;
}
