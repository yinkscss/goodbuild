"use client";

import * as React from "react";

import type { AuthApi, WalletState } from "./types";

const AuthContext = React.createContext<AuthApi | null>(null);

export function AuthContextProvider({ value, children }: { value: AuthApi; children: React.ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Session, sign-in and sign-out. The only auth API UI components should use. */
export function useAuth(): AuthApi {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <Providers>.");
  return ctx;
}

export interface UseWallet {
  wallet: WalletState | null;
  /** True when a wallet is connected on a chain other than `expectedChainId`. */
  isWrongNetwork: (expectedChainId: number) => boolean;
  switchChain: (chainId: number) => Promise<void>;
}

/** The connected wallet and network helpers (wrong-network pill, deploy gating). */
export function useWallet(): UseWallet {
  const { wallet, switchChain } = useAuth();
  return React.useMemo(
    () => ({
      wallet,
      switchChain,
      isWrongNetwork: (expected: number) => Boolean(wallet && wallet.chainId !== null && wallet.chainId !== expected),
    }),
    [wallet, switchChain],
  );
}

/** Used when no provider is configured: the app still renders and explains why sign-in is off. */
export const unconfiguredAuth: AuthApi = {
  configured: false,
  ready: true,
  user: null,
  wallet: null,
  phase: "idle",
  error: null,
  detected: {},
  sendEmailCode: async () => {},
  verifyEmailCode: async () => {},
  connectWallet: async () => {},
  signInWithConnectedWallet: async () => {},
  reset: () => {},
  signOut: async () => {},
  switchChain: async () => {},
};
