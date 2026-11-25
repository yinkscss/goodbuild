"use client";

import * as React from "react";
import { ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/context";
import type { Attestation, ExternalWalletId } from "@/lib/auth/types";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

const WALLETS: Array<{ id: ExternalWalletId; name: string; hint: string; tile: string; letter: string }> = [
  { id: "metamask", name: "MetaMask", hint: "Browser extension", tile: "#F6851B", letter: "M" },
  { id: "okx", name: "OKX Wallet", hint: "Extension or OKX app browser", tile: "#000000", letter: "O" },
  { id: "minipay", name: "MiniPay / Valora", hint: "Celo mobile wallets", tile: "#35D07F", letter: "V" },
  { id: "walletconnect", name: "WalletConnect", hint: "Scan with any wallet", tile: "#3B99FC", letter: "W" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * "Sign in to send" (design/app/a-connect-modal.html): email OTP that creates an
 * embedded wallet, or an external wallet; then a gasless SIWE signature. First
 * sign-in requires the 18+ / not-a-US-person attestation (D10).
 */
export function ConnectModal({
  open,
  onOpenChange,
  hasPendingPrompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasPendingPrompt: boolean;
}) {
  const auth = useAuth();
  const busy = ["sending-code", "verifying-code", "connecting", "signing"].includes(auth.phase);

  // Close once signed in; the gate then sends the saved prompt.
  React.useEffect(() => {
    if (open && auth.user) onOpenChange(false);
  }, [open, auth.user, onOpenChange]);

  function handleOpenChange(next: boolean) {
    if (!next) auth.reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:w-[480px]" onInteractOutside={(e) => busy && e.preventDefault()}>
        {/* Form state lives in the body, which unmounts on close, so each open starts fresh. */}
        <ConnectModalBody hasPendingPrompt={hasPendingPrompt} busy={busy} />
      </DialogContent>
    </Dialog>
  );
}

function ConnectModalBody({ hasPendingPrompt, busy }: { hasPendingPrompt: boolean; busy: boolean }) {
  const auth = useAuth();
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [attested, setAttested] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const attestRef = React.useRef<HTMLInputElement>(null);

  const attestation: Attestation = { ageOk: attested, notUsPerson: attested };
  const awaitingCode = auth.phase === "awaiting-code" || auth.phase === "verifying-code";
  const error = localError ?? auth.error;

  function requireAttestation(): boolean {
    if (attested) return true;
    setLocalError("Please confirm you're 18 or older and not a US person.");
    attestRef.current?.focus();
    return false;
  }

  async function onEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!awaitingCode) {
      if (!EMAIL_RE.test(email.trim())) return setLocalError("Enter a valid email address.");
      if (!requireAttestation()) return;
      await auth.sendEmailCode(email.trim());
    } else {
      if (!/^\d{6}$/.test(code)) return setLocalError("Enter the 6-digit code from your email.");
      if (!requireAttestation()) return;
      await auth.verifyEmailCode(code, attestation);
    }
  }

  function onWallet(id: ExternalWalletId) {
    setLocalError(null);
    if (!requireAttestation()) return;
    void auth.connectWallet(id, attestation);
  }

  return (
    <>
        <p className="eyebrow pr-10">{hasPendingPrompt ? "One step before we build" : "Welcome to GoodBuild"}</p>
        <DialogTitle className="display mt-2 pr-10 text-[28px] font-extrabold">Sign in to send</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-grey-600">
          {hasPendingPrompt
            ? "Your prompt is saved. We'll send it as soon as you're in."
            : "Use your email or a wallet. Signing in is free and gasless."}
        </DialogDescription>

        {!auth.configured ? (
          <div className="mt-5 rounded-block bg-tint p-4 text-sm text-violet-ink">
            Sign-in isn&apos;t set up on this deployment yet (no Magic key). Your prompt stays saved in this tab.
          </div>
        ) : (
          <>
            {auth.wallet && !auth.user && auth.phase !== "connecting" && (
              <Button
                variant="secondary"
                className="mt-5 w-full justify-between"
                disabled={busy}
                onClick={() => requireAttestation() && auth.signInWithConnectedWallet(attestation)}
              >
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-pink" aria-hidden />
                  Continue as {shortAddress(auth.wallet.address)}
                </span>
                <span className="text-xs text-grey-600">{auth.wallet.label}</span>
              </Button>
            )}

            <form onSubmit={onEmailSubmit} className="mt-5" noValidate>
              <div className="flex gap-1.5 rounded-block bg-canvas p-1.5 focus-within:shadow-focus">
                {awaitingCode ? (
                  <input
                    key="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    aria-label="6-digit code"
                    placeholder="6-digit code"
                    className="min-w-0 flex-1 bg-transparent px-3 focus-visible:shadow-none font-mono text-sm tracking-[0.3em] outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-grey-400"
                  />
                ) : (
                  <input
                    key="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-label="Email address"
                    placeholder="you@example.com"
                    className="min-w-0 flex-1 bg-transparent px-3 focus-visible:shadow-none text-sm outline-none placeholder:text-grey-400"
                  />
                )}
                <Button type="submit" variant="primary" className="px-5 py-2.5" disabled={busy}>
                  {auth.phase === "sending-code" || auth.phase === "verifying-code" ? (
                    <Loader2 className="animate-spin" aria-label="Working" />
                  ) : null}
                  {awaitingCode ? "Verify code" : "Continue with email"}
                </Button>
              </div>
              <p className="mt-2 px-1 text-[11px] text-grey-400">
                {awaitingCode ? (
                  <>
                    We sent a code to <b className="font-medium text-grey-600">{email}</b>.{" "}
                    <button type="button" className="text-violet hover:underline" onClick={() => auth.reset()}>
                      Use a different email
                    </button>
                  </>
                ) : (
                  "We'll email a 6-digit code and create a wallet for you. You can export the key at any time."
                )}
              </p>
            </form>

            <div className="my-5 flex items-center gap-3 text-[11px] tracking-[.18em] text-grey-400 uppercase">
              <span className="h-px flex-1 bg-hairline" />
              or connect a wallet
              <span className="h-px flex-1 bg-hairline" />
            </div>

            <ul className="space-y-1">
              {WALLETS.map((w) => {
                const isDetected = Boolean(auth.detected[w.id]);
                return (
                  <li key={w.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onWallet(w.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-block px-3 py-3 text-left transition-colors duration-200 ease-gb outline-none hover:bg-tint focus-visible:shadow-focus disabled:opacity-55",
                        isDetected && "bg-[#F7F7F7]",
                      )}
                    >
                      <span
                        className="grid size-9 place-items-center rounded-[12px] text-sm font-bold text-white"
                        style={{ background: w.tile }}
                        aria-hidden
                      >
                        {w.letter}
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-semibold">{w.name}</span>
                        <span className="block text-xs text-grey-600">{w.hint}</span>
                      </span>
                      {isDetected ? (
                        <span className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-violet">Detected</span>
                      ) : (
                        <ChevronRight className="size-4 text-grey-400" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {(auth.phase === "connecting" || auth.phase === "signing") && (
          <p className="mt-4 flex items-center gap-2 rounded-block bg-tint px-4 py-3 text-sm text-violet-ink" role="status">
            <Loader2 className="size-4 animate-spin text-violet" aria-hidden />
            {auth.phase === "connecting" ? "Check your wallet to connect." : "Approve the sign-in message. It's free and sends no transaction."}
          </p>
        )}

        {error && (
          <p className="mt-4 flex items-start gap-2 rounded-block bg-canvas px-4 py-3 text-sm" role="alert">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
            {error}
          </p>
        )}

        {auth.configured && (
        <label className="mt-5 flex cursor-pointer items-start justify-center gap-2 text-[11px] text-grey-600">
          <input
            ref={attestRef}
            type="checkbox"
            checked={attested}
            onChange={(e) => {
              setAttested(e.target.checked);
              if (e.target.checked) setLocalError(null);
            }}
            className="mt-px size-3.5 accent-[#592E81]"
          />
          <span>I&apos;m 18 or older and not a US person. Signing in is free and gasless.</span>
        </label>
        )}
    </>
  );
}
