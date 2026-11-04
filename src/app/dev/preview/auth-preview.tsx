"use client";

import * as React from "react";

import { ConnectModal } from "@/components/auth/connect-modal";
import { WalletButton } from "@/components/auth/wallet-button";
import { Logo } from "@/components/brand/logo";
import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import type { AuthApi } from "@/lib/auth/types";

const noop = async () => {};
const base: AuthApi = { ...unconfiguredAuth, configured: true, ready: true, detected: { metamask: true }, reset: () => {} };
const wallet = { address: "0x7a3c91d0b5e2f4a6c8e0d2b4f6a8c0e2d4b6e41c" as const, kind: "external" as const, label: "MetaMask" };
const user = { id: "u1", wallet: wallet.address, walletKind: "external" as const, verified: false };

const STATES: Record<string, AuthApi> = {
  modal: base,
  code: { ...base, phase: "awaiting-code" },
  connecting: { ...base, phase: "connecting" },
  error: { ...base, phase: "error", error: "You cancelled the signature in your wallet." },
  connected: { ...base, user, wallet: { ...wallet, chainId: 11142220 } },
  "wrong-network": { ...base, user, wallet: { ...wallet, chainId: 1 } },
};

export function AuthPreview({ state }: { state: string }) {
  const auth = { ...(STATES[state] ?? base), sendEmailCode: noop, verifyEmailCode: noop, connectWallet: noop };
  const showModal = ["modal", "code", "connecting", "error"].includes(state);
  return (
    <AuthContextProvider value={auth}>
      <header className="mx-auto flex h-20 max-w-[1360px] items-center justify-between px-8">
        <Logo />
        <WalletButton />
      </header>
      <ConnectModal open={showModal} onOpenChange={() => {}} hasPendingPrompt />
    </AuthContextProvider>
  );
}
