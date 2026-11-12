"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Runs the expiry sweep now, with an in-page confirm step. The worker also runs it every hour. */
export function ExpireButton({ closed }: { closed: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/hackathon/expire", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { expired?: number; removedCredits?: number; skipped?: number; message?: string };
      if (!res.ok) throw new Error(body.message ?? "That didn't work. Try again.");
      setNote(`Expired ${body.expired ?? 0} builders and removed ${body.removedCredits ?? 0} credits.${body.skipped ? ` ${body.skipped} left for the next sweep.` : ""}`);
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!closed) return <p className="text-sm text-grey-600">Unspent credits can be expired once claims close. The worker does it by itself every hour after that.</p>;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {confirming ? (
        <>
          <span className="text-sm">Remove every builder&apos;s unspent hackathon credits now? Credits they bought are kept.</span>
          <Button size="sm" disabled={busy} onClick={() => void run()}>
            {busy && <Loader2 className="animate-spin" />}
            Yes, expire now
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
          Expire unspent credits now
        </Button>
      )}
      {note && (
        <p className="w-full text-sm text-grey-600" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
