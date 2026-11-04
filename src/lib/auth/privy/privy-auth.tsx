"use client";

import * as React from "react";
import {
  PrivyProvider,
  useConnectWallet,
  useExportWallet,
  useLoginWithEmail,
  usePrivy,
  useSignMessage,
  useWallets,
  type ConnectedWallet,
  type WalletListEntry,
} from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http } from "wagmi";
import { celo, celoSepolia } from "viem/chains";
import { createWalletClient, custom } from "viem";

import { AuthContextProvider } from "../context";
import {
  SignInError,
  endSession,
  fetchSession,
  parseChainId,
  signInWithEthereum,
} from "../session-client";
import type { Attestation, AuthApi, AuthPhase, ExternalWalletId, SessionUser, WalletState } from "../types";

const wagmiConfig = createConfig({
  chains: [celoSepolia, celo],
  transports: { [celoSepolia.id]: http(), [celo.id]: http() },
});

const WALLET_LIST: Record<ExternalWalletId, WalletListEntry[]> = {
  metamask: ["metamask"],
  // MiniPay injects a provider inside its own browser; Valora connects over WalletConnect.
  minipay: ["detected_ethereum_wallets", "wallet_connect"],
  walletconnect: ["wallet_connect"],
  coinbase: ["coinbase_wallet"],
};

const LABELS: Record<string, string> = {
  privy: "Email wallet",
  metamask: "MetaMask",
  coinbase_wallet: "Coinbase Wallet",
  wallet_connect: "WalletConnect",
};

type InjectedFlags = { isMetaMask?: boolean; isMiniPay?: boolean; isCoinbaseWallet?: boolean };

function detectWallets(): AuthApi["detected"] {
  if (typeof window === "undefined") return {};
  const eth = (window as unknown as { ethereum?: InjectedFlags & { providers?: InjectedFlags[] } }).ethereum;
  if (!eth) return {};
  const all = [eth, ...(eth.providers ?? [])];
  return {
    metamask: all.some((p) => p.isMetaMask && !p.isMiniPay),
    minipay: all.some((p) => p.isMiniPay),
    coinbase: all.some((p) => p.isCoinbaseWallet),
  };
}

function toWalletState(w: ConnectedWallet): WalletState {
  const embedded = w.walletClientType === "privy";
  return {
    address: w.address as `0x${string}`,
    chainId: parseChainId(w.chainId),
    kind: embedded ? "embedded" : "external",
    label: LABELS[w.walletClientType] ?? w.meta?.name ?? "Wallet",
  };
}

/** Most recently connected wallet, preferring the one sign-in is waiting for. */
function pickWallet(wallets: ConnectedWallet[], prefer?: { kind: "embedded" | "external"; address?: string }) {
  const sorted = [...wallets].sort((a, b) => b.connectedAt - a.connectedAt);
  if (prefer?.address) return sorted.find((w) => w.address.toLowerCase() === prefer.address!.toLowerCase());
  if (prefer?.kind === "embedded") return sorted.find((w) => w.walletClientType === "privy");
  if (prefer?.kind === "external") return sorted.find((w) => w.walletClientType !== "privy");
  return sorted[0];
}

interface SignInIntent {
  kind: "embedded" | "external";
  address?: string;
  attestation: Attestation;
}

function PrivyAuthBridge({ children }: { children: React.ReactNode }) {
  const privy = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signMessage } = useSignMessage();
  const { exportWallet } = useExportWallet();

  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [sessionChecked, setSessionChecked] = React.useState(false);
  const [phase, setPhase] = React.useState<AuthPhase>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [intent, setIntent] = React.useState<SignInIntent | null>(null);
  // Read once on the client; the modal that shows it never renders on the server.
  const [detected] = React.useState<AuthApi["detected"]>(() => detectWallets());
  const signingRef = React.useRef(false);

  const fail = React.useCallback((e: unknown) => {
    setIntent(null);
    setPhase("error");
    setError(e instanceof SignInError ? e.message : e instanceof Error && e.message ? e.message : "Something went wrong. Try again.");
  }, []);

  const email = useLoginWithEmail({
    onComplete: () => undefined,
    onError: (e) => fail(new SignInError(String(e) === "invalid_credentials" ? "otp_invalid" : "otp_failed", "That code didn't work. Check it and try again.")),
  });

  const { connectWallet: privyConnect } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      setIntent((current) => (current ? { ...current, address: wallet.address } : current));
      setPhase("signing");
    },
    onError: (e) => fail(new SignInError(String(e).includes("exited") ? "user_rejected" : "connect_failed", "The wallet didn't connect. Try again.")),
  });

  React.useEffect(() => {
    let alive = true;
    fetchSession()
      .then((u) => alive && setUser(u))
      .finally(() => alive && setSessionChecked(true));
    return () => {
      alive = false;
    };
  }, []);

  // Once the wallet sign-in is waiting for shows up, run SIWE exactly once.
  React.useEffect(() => {
    if (!intent || signingRef.current || !walletsReady) return;
    const target = pickWallet(wallets, { kind: intent.kind, address: intent.address });
    if (!target) return;
    if (intent.kind === "external" && !intent.address) return;
    signingRef.current = true;
    const state = toWalletState(target);
    const sign = async (message: string) => {
      if (state.kind === "embedded") {
        // Silent for sign-in only. Deploys keep Privy's confirmation UI (the global default).
        const { signature } = await signMessage({ message }, { address: target.address, uiOptions: { showWalletUIs: false } });
        return signature as `0x${string}`;
      }
      const client = createWalletClient({ account: state.address, transport: custom(await target.getEthereumProvider()) });
      return client.signMessage({ account: state.address, message });
    };
    signInWithEthereum({
      address: state.address,
      walletChainId: state.chainId,
      walletKind: state.kind,
      attestation: intent.attestation,
      sign,
    })
      .then((u) => {
        setUser(u);
        setIntent(null);
        setPhase("idle");
        setError(null);
      })
      .catch(fail)
      .finally(() => {
        signingRef.current = false;
      });
  }, [intent, wallets, walletsReady, signMessage, fail]);

  const activeWallet = React.useMemo(() => {
    const w = user ? pickWallet(wallets, { kind: user.walletKind, address: user.wallet }) : pickWallet(wallets);
    return w ? toWalletState(w) : null;
  }, [wallets, user]);

  const api: AuthApi = React.useMemo(
    () => ({
      configured: true,
      ready: privy.ready && sessionChecked,
      user,
      wallet: activeWallet,
      phase,
      error,
      detected,
      async sendEmailCode(address: string) {
        setError(null);
        setPhase("sending-code");
        try {
          await email.sendCode({ email: address });
          setPhase("awaiting-code");
        } catch {
          fail(new SignInError("otp_send_failed", "We couldn't send the code. Check the address and try again."));
        }
      },
      async verifyEmailCode(code: string, attestation: Attestation) {
        setError(null);
        setPhase("verifying-code");
        setIntent({ kind: "embedded", attestation });
        try {
          await email.loginWithCode({ code });
          setPhase("signing");
        } catch {
          fail(new SignInError("otp_invalid", "That code didn't work. Check it and try again."));
        }
      },
      async connectWallet(id: ExternalWalletId, attestation: Attestation) {
        setError(null);
        setPhase("connecting");
        setIntent({ kind: "external", attestation });
        privyConnect({ walletList: WALLET_LIST[id], description: "" });
      },
      async signInWithConnectedWallet(attestation: Attestation) {
        if (!activeWallet) return;
        setError(null);
        setPhase("signing");
        setIntent({ kind: activeWallet.kind, address: activeWallet.address, attestation });
      },
      reset() {
        setIntent(null);
        setError(null);
        setPhase("idle");
      },
      async signOut() {
        await endSession();
        setUser(null);
        for (const w of wallets) if (w.walletClientType !== "privy") w.disconnect();
        if (privy.authenticated) await privy.logout();
      },
      async switchChain(chainId: number) {
        const w = pickWallet(wallets, activeWallet ? { kind: activeWallet.kind, address: activeWallet.address } : undefined);
        await w?.switchChain(chainId);
      },
      exportKey: activeWallet?.kind === "embedded" ? () => exportWallet({ address: activeWallet.address }) : undefined,
    }),
    [privy, sessionChecked, user, activeWallet, phase, error, detected, email, privyConnect, wallets, exportWallet, fail],
  );

  return <AuthContextProvider value={api}>{children}</AuthContextProvider>;
}

const queryClient = new QueryClient();

/** Privy + wagmi on Celo Sepolia (default) and Celo. */
export function PrivyAuthProvider({ appId, children }: { appId: string; children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme: "light", accentColor: "#592E81", walletChainType: "ethereum-only" },
        loginMethods: ["email", "wallet"],
        defaultChain: celoSepolia,
        supportedChains: [celoSepolia, celo],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        walletConnectCloudProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined,
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <PrivyAuthBridge>{children}</PrivyAuthBridge>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
