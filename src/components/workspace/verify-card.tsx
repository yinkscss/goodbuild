"use client";

import { BadgeCheck, Loader2 } from "lucide-react";

import { useGoodIdVerify } from "@/components/auth/use-goodid-verify";
import { Button } from "@/components/ui/button";
import { LINK_WALLET_GUIDE } from "@/lib/goodid";

/** Shown when an account has used its free AI: GoodDollar verification unlocks more (D30). */
export function VerifyCard({ onVerified }: { onVerified: () => unknown }) {
  const { busy, note, showLinkGuide, verify } = useGoodIdVerify(onVerified);

  return (
    <div className="rounded-block bg-tint p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-violet-ink">
        <BadgeCheck className="size-4 shrink-0 text-violet" aria-hidden />
        Verify to keep building
      </p>
      <p className="mt-1 text-grey-600">You&apos;ve used your free 20 credits of AI. Verify with GoodDollar, a quick face check, to get 50 more credits.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void verify()}>
          {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
          Verify with GoodDollar
        </Button>
        <a href={LINK_WALLET_GUIDE} target="_blank" rel="noreferrer" className="text-xs text-violet hover:underline">
          Already verified on another wallet?
        </a>
      </div>
      {note && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {note}
          {showLinkGuide && " If you verified on another wallet, link this one to it, then press Verify."}
        </p>
      )}
    </div>
  );
}
