"use client";

import * as React from "react";
import type { EIP1193Provider } from "viem";
import { celo, celoSepolia } from "viem/chains";

import { AuthContextProvider } from "../context";
import { SignInError, endSession, fetchSession, parseChainId, signInWithEthereum } from "../session-client";
import type { Attestation, AuthApi, AuthPhase, ExternalWalletId, SessionUser, WalletState } from "../types";
import { switchWalletChain, walletClientFor } from "../wallet-client";

/**
 * Auth with Magic (D22): email OTP creates an embedded wallet on Celo; MetaMask, MiniPay/Valora
 * (injected) and WalletConnect are external wallets. Every wallet, embedded or not, is reduced
 * to one EIP-1193 provider, so `getWalletClient()` hands deploy code the same viem client.
 * The session is ours (SIWE, P9); for email wallets the server also checks a Magic DID token.
 */

type Listener = (...args: unknown[]) => void;
/** The slice of Magic's PromiEvent we use. */
interface Handle<T = unknown> extends Promise<T> {
  on(event: string, cb: Listener): Handle<T>;
  emit(event: string, ...args: unknown[]): unknown;
}
interface MagicInstance {
  auth: { loginWithEmailOTP(c: { email: string; showUI: false }): Handle<string | null> };
  user: {
    isLoggedIn(): Promise<boolean>;
    logout(): Promise<boolean>;
    generateIdToken(c: { attachment: string; lifespan: number }): Promise<string>;
    revealEVMPrivateKey(): Promise<boolean>;
  };
  evm: { switchChain(chainId: number): Promise<unknown> };
  rpcProvider: EIP1193Provider;
}

interface Connected {
  provider: EIP1193Provider;
  address: `0x${string}`;
  chainId: number | null;
  kind: "embedded" | "external";
  label: string;
}

const LAST_WALLET_KEY = "gb:wallet";

type Injected = EIP1193Provider & { isMetaMask?: boolean; isMiniPay?: boolean; providers?: Injected[] } & Record<string, unknown>;

/** EIP-6963: wallets announce themselves with a reverse-DNS id, so "MetaMask" can mean MetaMask and nothing else. */
type Announced = { info: { rdns: string; name: string }; provider: Injected };
const announced = new Map<string, Announced>();
const subscribers = new Set<() => void>();

function listenForWallets() {
  if (typeof window === "undefined") return;
  window.addEventListener("eip6963:announceProvider", (e) => {
    const detail = (e as CustomEvent<Announced>).detail;
    if (!detail?.info?.rdns || !detail.provider) return;
    announced.set(detail.info.rdns, detail);
    subscribers.forEach((f) => f());
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}
if (typeof window !== "undefined") listenForWallets();

/** Rainbow, Brave, Coinbase, Phantom, Rabby, Trust and others set isMetaMask = true to be compatible. Only the rdns tells them apart. */
const IMPERSONATORS = ["isRainbow", "isBraveWallet", "isCoinbaseWallet", "isPhantom", "isRabby", "isTrust", "isTrustWallet", "isOkxWallet", "isOKExWallet", "isTokenPocket", "isZerion", "isFrame", "isExodus"];

function legacyProviders(): Injected[] {
  if (typeof window === "undefined") return [];
  const eth = (window as unknown as { ethereum?: Injected }).ethereum;
  return eth ? [eth, ...(eth.providers ?? [])] : [];
}

function findMetaMask(): Injected | undefined {
  const real = announced.get("io.metamask") ?? announced.get("io.metamask.flask");
  if (real) return real.provider;
  // Wallets that do not announce (older MetaMask): accept window.ethereum only when nothing else claims to own it.
  if (announced.size > 0) return undefined;
  return legacyProviders().find((p) => p.isMetaMask && !p.isMiniPay && !IMPERSONATORS.some((k) => p[k]));
}

function injectedProviders(): Injected[] {
  return [...[...announced.values()].map((a) => a.provider), ...legacyProviders()];
}

function detectWallets(): AuthApi["detected"] {
  return { metamask: !!findMetaMask(), minipay: injectedProviders().some((p) => p.isMiniPay) };
}

async function readAccount(provider: EIP1193Provider, method: "eth_accounts" | "eth_requestAccounts"): Promise<`0x${string}` | null> {
  const accounts = (await provider.request({ method })) as string[] | undefined;
  return (accounts?.[0] as `0x${string}` | undefined) ?? null;
}

async function readChainId(provider: EIP1193Provider): Promise<number | null> {
  try {
    return parseChainId((await provider.request({ method: "eth_chainId" })) as string);
  } catch {
    return null;
  }
}

function MagicBridge({ publishableKey, children }: { publishableKey: string; children: React.ReactNode }) {
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [sessionChecked, setSessionChecked] = React.useState(false);
  const [phase, setPhase] = React.useState<AuthPhase>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [conn, setConn] = React.useState<Connected | null>(null);
  const [detected, setDetected] = React.useState<AuthApi["detected"]>(() => detectWallets());
  React.useEffect(() => {
    const update = () => setDetected(detectWallets());
    subscribers.add(update);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    update();
    return () => void subscribers.delete(update);
  }, []);

  const magicRef = React.useRef<Promise<MagicInstance> | null>(null);
  const otpRef = React.useRef<Handle<string | null> | null>(null);
  const verifyRef = React.useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);
  const wcRef = React.useRef<{ disconnect(): Promise<void> } | null>(null);
  const connRef = React.useRef<Connected | null>(null);
  React.useEffect(() => {
    connRef.current = conn;
  }, [conn]);

  const getMagic = React.useCallback((): Promise<MagicInstance> => {
    magicRef.current ??= (async () => {
      const [{ Magic }, { EVMExtension }] = await Promise.all([import("magic-sdk"), import("@magic-ext/evm")]);
      // Celo mainnet is the default network; Celo Sepolia is selectable for testing. Both RPC hosts
      // must be allowed in the Magic dashboard's content security policy.
      const evm = new EVMExtension([
        { rpcUrl: celo.rpcUrls.default.http[0], chainId: celo.id, default: true },
        { rpcUrl: celoSepolia.rpcUrls.default.http[0], chainId: celoSepolia.id },
      ]);
      return new Magic(publishableKey, { extensions: [evm] }) as unknown as MagicInstance;
    })();
    return magicRef.current;
  }, [publishableKey]);

  const fail = React.useCallback((e: unknown) => {
    setPhase("error");
    setError(e instanceof SignInError ? e.message : e instanceof Error && e.message ? e.message : "Something went wrong. Try again.");
  }, []);

  /** Follow account and network changes in external wallets. */
  const watch = React.useCallback((provider: EIP1193Provider) => {
    const p = provider as EIP1193Provider & { on?: (e: string, cb: Listener) => void };
    p.on?.("chainChanged", (id) => setConn((c) => (c && c.provider === provider ? { ...c, chainId: parseChainId(id as string) } : c)));
    p.on?.("accountsChanged", (accounts) => {
      const next = (accounts as string[])[0] as `0x${string}` | undefined;
      setConn((c) => (c && c.provider === provider && next ? { ...c, address: next } : c));
    });
  }, []);

  // Restore the session, then the wallet that signed it.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const u = await fetchSession().catch(() => null);
      if (!alive) return;
      setUser(u);
      setSessionChecked(true);
      if (!u) return;
      try {
        if (u.walletKind === "embedded") {
          const magic = await getMagic();
          if (!(await magic.user.isLoggedIn())) return;
          const address = await readAccount(magic.rpcProvider, "eth_accounts");
          if (alive && address) setConn({ provider: magic.rpcProvider, address, chainId: await readChainId(magic.rpcProvider), kind: "embedded", label: "Email wallet" });
        } else {
          const last = localStorage.getItem(LAST_WALLET_KEY) as ExternalWalletId | null;
          if (last === "walletconnect") {
            const provider = await initWalletConnect(false);
            const address = provider.accounts?.[0] as `0x${string}` | undefined;
            if (alive && provider.session && address) {
              wcRef.current = provider;
              watch(provider as unknown as EIP1193Provider);
              setConn({ provider: provider as unknown as EIP1193Provider, address, chainId: provider.chainId ?? null, kind: "external", label: "WalletConnect" });
            }
          } else if (last) {
            const injected = pickInjected(last);
            const address = injected ? await readAccount(injected, "eth_accounts") : null; // no prompt
            if (alive && injected && address) {
              watch(injected);
              setConn({ provider: injected, address, chainId: await readChainId(injected), kind: "external", label: last === "minipay" ? "MiniPay" : "MetaMask" });
            }
          }
        }
      } catch {
        /* the wallet reconnects the next time the user acts */
      }
    })();
    return () => {
      alive = false;
    };
  }, [getMagic, watch]);

  /** SIWE round trip with whatever wallet is connected. */
  const signInWith = React.useCallback(
    async (wallet: Connected, attestation: Attestation) => {
      setPhase("signing");
      const client = walletClientFor(wallet.provider, wallet.address, wallet.chainId);
      const magic = wallet.kind === "embedded" ? await getMagic() : null;
      const signed = await signInWithEthereum({
        address: wallet.address,
        walletChainId: wallet.chainId,
        walletKind: wallet.kind,
        attestation,
        sign: (message) => client.signMessage({ account: wallet.address, message }),
        didToken: magic ? (attachment) => magic.user.generateIdToken({ attachment, lifespan: 120 }) : undefined,
      });
      setUser(signed);
      setPhase("idle");
      setError(null);
    },
    [getMagic],
  );

  const api: AuthApi = React.useMemo(() => {
    const walletState: WalletState | null = conn ? { address: conn.address, chainId: conn.chainId, kind: conn.kind, label: conn.label } : null;
    return {
      configured: true,
      ready: sessionChecked,
      user,
      wallet: walletState,
      phase,
      error,
      detected,

      async sendEmailCode(email: string) {
        setError(null);
        setPhase("sending-code");
        try {
          const magic = await getMagic();
          const handle = magic.auth.loginWithEmailOTP({ email, showUI: false });
          otpRef.current = handle;
          handle.on("email-otp-sent", () => setPhase("awaiting-code"));
          handle.on("invalid-email-otp", () => verifyRef.current?.reject(new SignInError("otp_invalid", "That code didn't work. Check it and try again.")));
          handle.on("expired-email-otp", () => verifyRef.current?.reject(new SignInError("otp_expired", "That code expired. Go back and request a new one.")));
          handle.on("login-throttled", () => fail(new SignInError("otp_throttled", "Too many attempts. Wait a minute and try again.")));
          handle.then(
            () => verifyRef.current?.resolve(),
            (e: unknown) => {
              verifyRef.current?.reject(e);
              if (!verifyRef.current) fail(new SignInError("otp_send_failed", "We couldn't send the code. Check the address and try again."));
            },
          );
        } catch {
          fail(new SignInError("otp_send_failed", "We couldn't send the code. Check the address and try again."));
        }
      },

      async verifyEmailCode(code: string, attestation: Attestation) {
        const handle = otpRef.current;
        if (!handle) return fail(new SignInError("otp_invalid", "Request a new code first."));
        setError(null);
        setPhase("verifying-code");
        try {
          await new Promise<void>((resolve, reject) => {
            verifyRef.current = { resolve, reject };
            handle.emit("verify-email-otp", code);
          });
          verifyRef.current = null;
          const magic = await getMagic();
          const address = await readAccount(magic.rpcProvider, "eth_accounts");
          if (!address) throw new SignInError("connect_failed", "We couldn't open your email wallet. Try again.");
          const wallet: Connected = { provider: magic.rpcProvider, address, chainId: await readChainId(magic.rpcProvider), kind: "embedded", label: "Email wallet" };
          setConn(wallet);
          await signInWith(wallet, attestation);
        } catch (e) {
          verifyRef.current = null;
          // A wrong code can be retried in place; anything else restarts the form.
          if (e instanceof SignInError && e.code === "otp_invalid") {
            setPhase("awaiting-code");
            setError(e.message);
          } else fail(e);
        }
      },

      async connectWallet(id: ExternalWalletId, attestation: Attestation) {
        setError(null);
        setPhase("connecting");
        try {
          let provider: EIP1193Provider | undefined;
          let label = "WalletConnect";
          if (id === "walletconnect") {
            const wc = await initWalletConnect(true);
            await wc.connect();
            wcRef.current = wc;
            provider = wc as unknown as EIP1193Provider;
          } else {
            provider = pickInjected(id);
            label = id === "minipay" ? "MiniPay" : "MetaMask";
            if (!provider) {
              throw new SignInError(
                "wallet_missing",
                id === "minipay" ? "MiniPay isn't available in this browser. Open GoodBuild inside MiniPay, or use WalletConnect for Valora." : "MetaMask isn't installed in this browser. Try WalletConnect.",
              );
            }
          }
          const address = await readAccount(provider, "eth_requestAccounts");
          if (!address) throw new SignInError("connect_failed", "The wallet didn't connect. Try again.");
          watch(provider);
          try {
            localStorage.setItem(LAST_WALLET_KEY, id);
          } catch {
            /* private mode */
          }
          const wallet: Connected = { provider, address, chainId: await readChainId(provider), kind: "external", label };
          setConn(wallet);
          await signInWith(wallet, attestation);
        } catch (e) {
          const rejected = (e as { code?: number })?.code === 4001 || /reject|denied|closed|cancel/i.test((e as Error)?.message ?? "");
          fail(e instanceof SignInError ? e : new SignInError(rejected ? "user_rejected" : "connect_failed", "The wallet didn't connect. Try again."));
        }
      },

      async signInWithConnectedWallet(attestation: Attestation) {
        if (!conn) return;
        setError(null);
        try {
          await signInWith(conn, attestation);
        } catch (e) {
          fail(e);
        }
      },

      reset() {
        setError(null);
        setPhase("idle");
        otpRef.current = null;
        verifyRef.current = null;
      },

      async signOut() {
        await endSession();
        setUser(null);
        const current = connRef.current;
        setConn(null);
        try {
          localStorage.removeItem(LAST_WALLET_KEY);
        } catch {
          /* private mode */
        }
        if (current?.kind === "embedded") await (await getMagic()).user.logout().catch(() => undefined);
        await wcRef.current?.disconnect().catch(() => undefined);
        wcRef.current = null;
      },

      async switchChain(chainId: number) {
        if (!conn) return;
        if (conn.kind === "embedded") await (await getMagic()).evm.switchChain(chainId);
        else await switchWalletChain(walletClientFor(conn.provider, conn.address, conn.chainId), chainId);
        setConn((c) => (c ? { ...c, chainId } : c));
      },

      async getWalletClient() {
        if (!conn) throw new Error("Connect a wallet first.");
        // Read the live chain so a switch made inside the wallet is respected.
        const chainId = (await readChainId(conn.provider)) ?? conn.chainId;
        return walletClientFor(conn.provider, conn.address, chainId);
      },

      exportKey: conn?.kind === "embedded" ? async () => void (await (await getMagic()).user.revealEVMPrivateKey()) : undefined,
    };
  }, [conn, sessionChecked, user, phase, error, detected, getMagic, fail, signInWith, watch]);

  return <AuthContextProvider value={api}>{children}</AuthContextProvider>;
}

function pickInjected(id: ExternalWalletId | string): Injected | undefined {
  const all = injectedProviders();
  if (id === "minipay") return all.find((p) => p.isMiniPay);
  if (id === "metamask") return findMetaMask();
  return undefined;
}

async function initWalletConnect(showQrModal: boolean) {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!projectId) throw new SignInError("wallet_missing", "WalletConnect isn't set up on this deployment (no project id).");
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  return EthereumProvider.init({
    projectId,
    chains: [celoSepolia.id],
    optionalChains: [celo.id],
    rpcMap: { [celoSepolia.id]: celoSepolia.rpcUrls.default.http[0], [celo.id]: celo.rpcUrls.default.http[0] },
    showQrModal,
  });
}

/** Magic + external wallets on Celo Sepolia (default) and Celo. */
export function MagicAuthProvider({ publishableKey, children }: { publishableKey: string; children: React.ReactNode }) {
  return <MagicBridge publishableKey={publishableKey}>{children}</MagicBridge>;
}
