"use client";

import * as React from "react";

import { useAuth } from "@/lib/auth/context";
import { faceVerificationLink, faceVerificationMessage } from "@/lib/goodid";

/** About 100s: GoodDollar can take a while to register a face check on Celo. */
const CHECKS_AFTER_RETURN = 20;
const CHECK_INTERVAL_MS = 5000;
/** Back from GoodDollar with no "verified" result (it errored, or the tab was closed): look a few times, then let the person press Verify again. */
const CHECKS_WITHOUT_HINT = 3;
/** Set just before leaving for GoodDollar, so coming back is recognised even if the address loses its ?isVerified. */
const PENDING_KEY = "goodbuild:goodid-pending";

interface VerificationAttempt { wallet: string; at: number; path: string }
const ATTEMPT_MAX_AGE_MS = 30 * 60 * 1000;
function pending(action: "get" | "set" | "clear", wallet = "", path = window.location.pathname): VerificationAttempt | null {
  try {
    if (action === "clear") window.sessionStorage.removeItem(PENDING_KEY);
    else if (action === "set") {
      window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ wallet: wallet.toLowerCase(), at: Date.now(), path }));
    } else {
      const attempt = JSON.parse(window.sessionStorage.getItem(PENDING_KEY) ?? "null") as VerificationAttempt | null;
      if (attempt && typeof attempt.wallet === "string" && attempt.wallet === wallet.toLowerCase() && Number.isFinite(attempt.at) && Date.now() >= attempt.at && Date.now() - attempt.at < ATTEMPT_MAX_AGE_MS && attempt.path === window.location.pathname) return attempt;
      window.sessionStorage.removeItem(PENDING_KEY);
    }
  } catch {
    // Old unscoped flags and blocked storage cannot establish a current attempt.
    try { window.sessionStorage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ }
  }
  return null;
}
/** A slow connection or a wallet pop-up that never opened must not leave the button spinning forever. */
const CHECK_TIMEOUT_MS = 15_000;
const WALLET_TIMEOUT_MS = 90_000;

const NO_ANSWER = "That's taking too long. Check your connection and press Verify to try again.";
const WALLET_NO_ANSWER = "We didn't hear back from your wallet. Open it, then press Verify to try again.";

/** Rejects with `message` if `promise` hasn't settled in `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function checkOnChain(signal?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const abortTimer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    return await withTimeout(checkOnChainRequest(controller.signal), CHECK_TIMEOUT_MS, NO_ANSWER);
  } finally {
    clearTimeout(abortTimer);
    signal?.removeEventListener("abort", abort);
  }
}

async function checkOnChainRequest(signal: AbortSignal): Promise<boolean> {
  const res = await fetch("/api/account/goodid", { method: "POST", signal });
  const body = (await res.json().catch(() => ({}))) as { verified?: boolean; message?: string };
  if (!res.ok) throw new Error(body.message ?? "We couldn't check that. Try again.");
  return Boolean(body.verified);
}

type ReturnResult = { verified?: boolean; note: string | null; link?: boolean };
interface ReturnJob { promise: Promise<ReturnResult>; controller: AbortController; users: number }
const returns = new Map<string, ReturnJob>();
/** One return check per wallet, shared by every mounted verification surface. */
function verificationReturn(wallet: string): ReturnJob | null {
  const existing = returns.get(wallet);
  if (existing) { existing.users++; return existing; }
  const url = new URL(window.location.href);
  const hint = url.searchParams.get("isVerified");
  const attempt = pending("get", wallet);
  if (hint === null && !attempt) return null;
  const controller = new AbortController();
  let stored: string | null = null;
  try { stored = window.sessionStorage.getItem(PENDING_KEY); } catch { /* storage unavailable */ }
  const clearAttempt = () => {
    if (controller.signal.aborted) return;
    try { if (window.sessionStorage.getItem(PENDING_KEY) === stored) pending("clear"); } catch { /* storage unavailable */ }
  };
  const reason = url.searchParams.get("reason");
  url.searchParams.delete("isVerified");
  url.searchParams.delete("reason");
  window.history.replaceState(null, "", url);
  const job = (async (): Promise<ReturnResult> => {
    if (hint !== null && hint !== "true") {
      clearAttempt();
      return { note: reason ? `GoodDollar couldn't verify you: ${reason.slice(0, 200)}` : "GoodDollar couldn't verify you.", link: true };
    }
    const checks = hint === "true" ? CHECKS_AFTER_RETURN : CHECKS_WITHOUT_HINT;
    for (let i = 0; i < checks && !controller.signal.aborted; i++) {
      try {
        if (await checkOnChain(controller.signal)) {
          if (controller.signal.aborted) return { note: null };
          clearAttempt();
          return { verified: true, note: null };
        }
      } catch (error) {
        return { note: error instanceof Error ? error.message : "We couldn't check verification. Try again." };
      }
      if (i + 1 < checks) await new Promise((resolve) => window.setTimeout(resolve, CHECK_INTERVAL_MS));
    }
    if (hint !== "true") clearAttempt();
    return { note: hint === "true" ? "GoodDollar hasn't confirmed it yet. Wait a minute and press Verify again." : "Verification hasn't been confirmed. Press Verify to continue. Your credit purchase is separate." };
  })();
  const shared = { promise: job, controller, users: 1 };
  returns.set(wallet, shared);
  void job.finally(() => { if (returns.get(wallet) === shared) returns.delete(wallet); });
  return shared;
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

  const wallet = auth.user?.wallet.toLowerCase();
  const generation = React.useRef(0);
  const notifyVerified = React.useEffectEvent(onVerified);
  React.useEffect(() => {
    const activeGeneration = ++generation.current;
    const verifiedElsewhere = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== wallet) return;
      setNote(null);
      setShowLinkGuide(false);
      void notifyVerified();
    };
    window.addEventListener("goodbuild:goodid-verified", verifiedElsewhere);
    let stopped = false;
    let shared: ReturnJob | null = null;
    void Promise.resolve().then(async () => {
      if (stopped) return;
      setNote(null);
      setShowLinkGuide(false);
      setBusy(false);
      if (!wallet) return;
      shared = verificationReturn(wallet);
      if (!shared) return;
      setBusy(true);
      const out = await shared.promise;
      if (stopped) return;
      setBusy(false);
      setNote(out.note);
      setShowLinkGuide(Boolean(out.link));
      if (out.verified) await notifyVerified();
    });
    return () => {
      stopped = true;
      generation.current = activeGeneration + 1;
      window.removeEventListener("goodbuild:goodid-verified", verifiedElsewhere);
      if (shared && --shared.users === 0) {
        shared.controller.abort();
        if (wallet && returns.get(wallet) === shared) returns.delete(wallet);
      }
    };
  }, [wallet]);

  async function verify() {
    const started = generation.current;
    const current = () => started === generation.current;
    setBusy(true);
    setNote(null);
    setShowLinkGuide(false);
    try {
      // Already verified with GoodDollar? No signature or face scan needed.
      const verified = await checkOnChain();
      if (!current()) return;
      if (verified) {
        pending("clear");
        setBusy(false);
        window.dispatchEvent(new CustomEvent("goodbuild:goodid-verified", { detail: wallet }));
        return;
      }
      const client = await withTimeout(auth.getWalletClient(), WALLET_TIMEOUT_MS, WALLET_NO_ANSWER);
      if (!current()) return;
      const [address] = await withTimeout(client.getAddresses(), WALLET_TIMEOUT_MS, WALLET_NO_ANSWER);
      if (!current()) return;
      if (!address || address.toLowerCase() !== auth.user?.wallet.toLowerCase()) {
        throw new Error("Switch to the wallet you signed in with, then try again.");
      }
      const signature = await withTimeout(client.signMessage({ account: address, message: faceVerificationMessage(address) }), WALLET_TIMEOUT_MS, WALLET_NO_ANSWER);
      if (!current()) return;
      const destination = returnTo ? returnTo() : window.location.href;
      pending("set", address, new URL(destination, window.location.href).pathname);
      window.location.assign(faceVerificationLink(address, signature, destination));
    } catch (error) {
      if (!current()) return;
      setNote(error instanceof Error && !/reject|denied/i.test(error.message) ? error.message : "Verification was cancelled. Press Verify to try again.");
      setBusy(false);
    }
  }

  return { busy, note, showLinkGuide, verify };
}
