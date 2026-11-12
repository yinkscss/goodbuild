"use client";

import * as React from "react";

import { useAuth } from "@/lib/auth/context";
import { faceVerificationLink, faceVerificationMessage } from "@/lib/goodid";

const CHECKS_AFTER_RETURN = 6;
const CHECK_INTERVAL_MS = 3000;

async function checkOnChain(): Promise<boolean> {
  const res = await fetch("/api/account/goodid", { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { verified?: boolean; message?: string };
  if (!res.ok) throw new Error(body.message ?? "We couldn't check that. Try again.");
  return Boolean(body.verified);
}

export interface GoodIdVerify {
  busy: boolean;
  note: string | null;
  /** GoodDollar said no: the wallet may be verified under another address that needs linking. */
  showLinkGuide: boolean;
  verify: () => Promise<void>;
}

/**
 * GoodDollar face verification for the signed-in wallet (D30). The server re-reads the Identity
 * contract; GoodDollar's redirect result is only a hint. Shared by the workspace's VerifyCard and
 * the hackathon page. `returnTo` is where GoodDollar sends the person back (default: this page).
 */
export function useGoodIdVerify(onVerified: () => unknown, returnTo?: () => string): GoodIdVerify {
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
          setBusy(false);
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
        setBusy(false);
        await onVerified();
        return;
      }
      const client = await auth.getWalletClient();
      const [address] = await client.getAddresses();
      if (!address || address.toLowerCase() !== auth.user?.wallet.toLowerCase()) {
        throw new Error("Switch to the wallet you signed in with, then try again.");
      }
      const signature = await client.signMessage({ account: address, message: faceVerificationMessage(address) });
      window.location.assign(faceVerificationLink(address, signature, returnTo ? returnTo() : window.location.href));
    } catch (error) {
      setNote(error instanceof Error && !/reject|denied/i.test(error.message) ? error.message : "Verification was cancelled. Press Verify to try again.");
      setBusy(false);
    }
  }

  return { busy, note, showLinkGuide, verify };
}
