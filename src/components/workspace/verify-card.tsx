"use client";

import * as React from "react";
import { BadgeCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/context";
import { LINK_WALLET_GUIDE, faceVerificationLink, faceVerificationMessage } from "@/lib/goodid";

const CHECKS_AFTER_RETURN = 6;
const CHECK_INTERVAL_MS = 3000;

async function checkOnChain(): Promise<boolean> {
  const res = await fetch("/api/account/goodid", { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { verified?: boolean; message?: string };
  if (!res.ok) throw new Error(body.message ?? "We couldn't check that. Try again.");
  return Boolean(body.verified);
}

/** Shown when an account has used its free AI: GoodDollar verification unlocks more (D30). */
export function VerifyCard({ onVerified }: { onVerified: () => unknown }) {
  const auth = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [showLinkGuide, setShowLinkGuide] = React.useState(false);

  // Back from GoodDollar. Its result is only a hint, so confirm on-chain, allowing time to register.
  React.useEffect(() => {
    let stopped = false;
    void Promise.resolve().then(async () => {
      const url = new URL(window.location.href);
      const result = url.searchParams.get("isVerified");
      if (result === null) return;
      const reason = url.searchParams.get("reason");
      url.searchParams.delete("isVerified");
      url.searchParams.delete("reason");
      window.history.replaceState(null, "", url);
      if (result !== "true") {
        setShowLinkGuide(true);
        setNote(reason ? `GoodDollar couldn't verify you: ${reason.slice(0, 200)}` : "GoodDollar couldn't verify you.");
        return;
      }
      setBusy(true);
      for (let i = 0; i < CHECKS_AFTER_RETURN && !stopped; i++) {
        const verified = await checkOnChain().catch(() => false);
        if (verified) {
          await onVerified();
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, CHECK_INTERVAL_MS));
      }
      if (!stopped) {
        setBusy(false);
        setNote("GoodDollar hasn't confirmed it yet. Wait a minute and press Verify again.");
      }
    });
    return () => {
      stopped = true;
    };
    // Runs once, on the return from GoodDollar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify() {
    setBusy(true);
    setNote(null);
    setShowLinkGuide(false);
    try {
      // Already verified with GoodDollar? No signature or face scan needed.
      if (await checkOnChain()) {
        await onVerified();
        return;
      }
      const client = await auth.getWalletClient();
      const [address] = await client.getAddresses();
      if (!address || address.toLowerCase() !== auth.user?.wallet.toLowerCase()) {
        throw new Error("Switch to the wallet you signed in with, then try again.");
      }
      const signature = await client.signMessage({ account: address, message: faceVerificationMessage(address) });
      window.location.assign(faceVerificationLink(address, signature, window.location.href));
    } catch (error) {
      setNote(error instanceof Error && !/reject|denied/i.test(error.message) ? error.message : "Verification was cancelled. Press Verify to try again.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-block bg-tint p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-violet-ink">
        <BadgeCheck className="size-4 shrink-0 text-violet" aria-hidden />
        Verify to keep building
      </p>
      <p className="mt-1 text-grey-600">You&apos;ve used your free $0.20 of AI. Verify with GoodDollar, a quick face check, to get $0.50 more.</p>
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
