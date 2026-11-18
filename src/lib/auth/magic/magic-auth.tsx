"use client";

import * as React from "react";
import { createWalletClient, custom, numberToHex, type EIP1193Provider } from "viem";
import { base, celo, celoSepolia } from "viem/chains";

import { shortAddress } from "../../format";
import { AuthContextProvider } from "../context";
import { detectInstalled, missingWalletMessage, pickInjected as pickInjectedFrom, walletLabel, type Announced, type Injected, type WalletWindow } from "../injected";
import { isCaip25ScopeError, requestMetaMaskAccount, walletConnectMetadata } from "../metamask";
import { SignInError, endSession, fetchSession, parseChainId, signInWithEthereum } from "../session-client";
import type { Attestation, AuthApi, AuthPhase, ExternalWalletId, SessionUser, WalletState } from "../types";
import { switchWalletChain, switchWalletTo, walletClientFor } from "../wallet-client";

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

/** What the page has heard from wallets (EIP-6963). Finding a wallet in it lives in ../injected.ts. */
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

const pageWindow = (): WalletWindow | undefined => (typeof window === "undefined" ? undefined : (window as unknown as WalletWindow));

function detectWallets(): AuthApi["detected"] {
  return detectInstalled(announced, pageWindow());
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
  /** The WalletConnect client made to find the session's wallet, kept so it is made once per page. */
  const wcClientRef = React.useRef<(Awaited<ReturnType<typeof initWalletConnect>> & { withQr?: boolean }) | null>(null);
  const connRef = React.useRef<Connected | null>(null);
  React.useEffect(() => {
    connRef.current = conn;
  }, [conn]);

  const getMagic = React.useCallback((): Promise<MagicInstance> => {
    magicRef.current ??= (async () => {
      const [{ Magic }, { EVMExtension }] = await Promise.all([import("magic-sdk"), import("@magic-ext/evm")]);
      // Celo mainnet is the default network; Celo Sepolia is selectable for testing. Base is only ever used for one
      // signature, the GoodCash top-up permit (D122), and the wallet goes straight back to Celo. All three RPC hosts
      // must be allowed in the Magic dashboard's content security policy.
      const evm = new EVMExtension([
        { rpcUrl: celo.rpcUrls.default.http[0], chainId: celo.id, default: true },
        { rpcUrl: celoSepolia.rpcUrls.default.http[0], chainId: celoSepolia.id },
        { rpcUrl: base.rpcUrls.default.http[0], chainId: base.id },
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

  const userRef = React.useRef<SessionUser | null>(null);
  React.useEffect(() => {
    userRef.current = user;
  }, [user]);

  /**
   * Find the wallet that signed session `u`. Without `prompt` nothing is shown and a miss returns null (page load).
   * With `prompt` the wallet may open, and a miss throws a plain message (someone pressed Pay or Deploy).
   * A wallet showing a different account than the session's is never used: the server signed quotes for that address.
   */
  const findSessionWallet = React.useCallback(
    async (u: SessionUser, prompt: boolean): Promise<Connected | null> => {
      let found: Connected | null = null;
      if (u.walletKind === "embedded") {
        const magic = await getMagic();
        if (!(await magic.user.isLoggedIn())) {
          if (prompt) throw new SignInError("email_wallet_expired", "Your email sign-in has timed out. Choose Disconnect in the top bar, then sign in with your email again. Your account and apps stay the same.");
          return null;
        }
        const address = await readAccount(magic.rpcProvider, "eth_accounts");
        if (address) found = { provider: magic.rpcProvider, address, chainId: await readChainId(magic.rpcProvider), kind: "embedded", label: "Email wallet" };
      } else {
        const last = readLastWallet();
        if (last === "walletconnect") {
          // One WalletConnect client per page: making it again on every check upsets its relay. Only a client made
          // with its QR window can show one, so a prompt with no live session makes that one.
          let wc = wcClientRef.current ?? (await initWalletConnect(prompt));
          if (!wc.session && prompt) {
            if (!wcClientRef.current?.withQr) wc = await initWalletConnect(true);
            await wc.connect();
          }
          wcClientRef.current = Object.assign(wc, { withQr: wcClientRef.current?.withQr || prompt });
          const address = wc.accounts?.[0] as `0x${string}` | undefined;
          if (wc.session && address) found = { provider: wc as unknown as EIP1193Provider, address, chainId: wc.chainId ?? null, kind: "external", label: "WalletConnect" };
        } else {
          // No remembered wallet (cleared storage, another browser): when asked, try the one wallet that is here.
          const id = last ?? (prompt ? (["minipay", "okx", "metamask"] as const).find((w) => pickInjected(w)) : undefined);
          const injected = id ? pickInjected(id) : undefined;
          const address = injected ? await readAccount(injected, prompt ? "eth_requestAccounts" : "eth_accounts") : null;
          if (id && injected && address) found = { provider: injected, address, chainId: await readChainId(injected), kind: "external", label: walletLabel(id) };
        }
      }
      if (found && !sameAddress(found.address, u.wallet)) {
        if (prompt) throw wrongWalletError(u);
        return null;
      }
      if (found?.label === "WalletConnect") wcRef.current = found.provider as unknown as { disconnect(): Promise<void> };
      if (!found && prompt) throw new SignInError("wallet_unreachable", "We couldn't reach your wallet. Open or unlock it, then try again.");
      return found;
    },
    [getMagic],
  );

  // Restore the session.
  React.useEffect(() => {
    let alive = true;
    fetchSession()
      .catch(() => null)
      .then((u) => {
        if (!alive) return;
        setUser(u);
        setSessionChecked(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Then, quietly, the wallet that signed it. Runs again when a wallet announces itself late (EIP-6963), so a slow
  // extension doesn't leave the page signed in with no wallet.
  const silentRef = React.useRef(false);
  const triedOnceRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!user || connRef.current || silentRef.current) return;
    // Announcements matter only for browser wallets; a WalletConnect or email session is tried once.
    const once = user.walletKind === "embedded" || readLastWallet() === "walletconnect";
    if (once && triedOnceRef.current === user.wallet) return;
    triedOnceRef.current = user.wallet;
    silentRef.current = true;
    findSessionWallet(user, false)
      .then((found) => {
        // Kept even if this effect re-ran meanwhile, unless the person signed out or someone else signed in.
        const now = userRef.current;
        if (!found || connRef.current || !now || !sameAddress(now.wallet, user.wallet)) return;
        watch(found.provider);
        connRef.current = found;
        setConn(found);
      })
      .catch(() => undefined) // reconnected when the person next pays or deploys (ensureWallet)
      .finally(() => {
        silentRef.current = false;
      });
  }, [user, detected, findSessionWallet, watch]);

  /** The session's wallet, ready to sign: the live one, or reconnected now. */
  const restoringRef = React.useRef<Promise<Connected> | null>(null);
  const ensureConnected = React.useCallback(async (): Promise<Connected> => {
    const u = userRef.current;
    const c = connRef.current;
    if (!u) {
      if (c) return c;
      throw new SignInError("no_session", "Connect your wallet first.");
    }
    if (c) {
      if (sameAddress(c.address, u.wallet)) return c;
      throw wrongWalletError(u);
    }
    restoringRef.current ??= findSessionWallet(u, true)
      .then((found) => {
        const wallet = found as Connected; // with prompt, a miss throws
        watch(wallet.provider);
        connRef.current = wallet;
        setConn(wallet);
        return wallet;
      })
      .finally(() => {
        restoringRef.current = null;
      });
    return restoringRef.current;
  }, [findSessionWallet, watch]);

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
            label = walletLabel(id);
            if (!provider) throw new SignInError("wallet_missing", missingWalletMessage(id));
          }
          const address = id === "metamask" ? await requestMetaMaskAccount(provider) : await readAccount(provider, "eth_requestAccounts");
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
          const message = isCaip25ScopeError(e)
            ? "MetaMask couldn't finish connecting. Disconnect this site in MetaMask and try again."
            : "The wallet didn't connect. Try again.";
          fail(e instanceof SignInError ? e : new SignInError(rejected ? "user_rejected" : "connect_failed", message));
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
        const embedded = connRef.current?.kind === "embedded" || userRef.current?.walletKind === "embedded";
        await endSession();
        setUser(null);
        userRef.current = null;
        connRef.current = null;
        setConn(null);
        try {
          localStorage.removeItem(LAST_WALLET_KEY);
        } catch {
          /* private mode */
        }
        // Logged out of Magic even when the page never got the email wallet back, so the next email starts clean.
        if (embedded) await (await getMagic()).user.logout().catch(() => undefined);
        await wcRef.current?.disconnect().catch(() => undefined);
        wcRef.current = null;
        wcClientRef.current = null;
        triedOnceRef.current = null;
      },

      async switchChain(chainId: number) {
        const c = await ensureConnected();
        if (c.kind === "embedded") await (await getMagic()).evm.switchChain(chainId);
        else await switchWalletChain(walletClientFor(c.provider, c.address, c.chainId), chainId);
        if (connRef.current === c) connRef.current = { ...c, chainId };
        setConn((cur) => (cur && cur.provider === c.provider ? { ...cur, chainId } : cur));
      },

      async ensureWallet() {
        const c = await ensureConnected();
        return { address: c.address, chainId: c.chainId, kind: c.kind, label: c.label };
      },

      async getWalletClient() {
        const c = await ensureConnected();
        // Read the live chain so a switch made inside the wallet is respected.
        const chainId = (await readChainId(c.provider)) ?? c.chainId;
        return walletClientFor(c.provider, c.address, chainId);
      },

      async signTypedDataOn(chain, typedData) {
        // The session's own wallet, reconnected if the page lost it (D120); never a different account.
        const conn = await ensureConnected();
        const magic = conn.kind === "embedded" ? await getMagic() : null;
        const before = (await readChainId(conn.provider)) ?? conn.chainId;
        let moved = false;
        // Only switch when we know where to come back to.
        if (before !== null && before !== chain.id) {
          try {
            if (magic) await magic.evm.switchChain(chain.id);
            else await switchWalletTo(walletClientFor(conn.provider, conn.address, before), chain);
            moved = true;
          } catch {
            /* a wallet that can't switch signs without switching; if it refuses, the error below says so */
          }
        }
        try {
          const client = createWalletClient({ account: conn.address, chain, transport: custom(conn.provider) });
          const signature = await client.signTypedData({ account: conn.address, ...typedData });
          if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("The wallet didn't return a signature.");
          return signature;
        } finally {
          if (moved && before !== null) {
            // Always back to the chain it was on (Celo), so deploys and balances never run on Base.
            if (magic) await magic.evm.switchChain(before).catch(() => undefined);
            else await conn.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(before) }] }).catch(() => undefined);
            if (connRef.current === conn) connRef.current = { ...conn, chainId: before };
            setConn((c) => (c && c.provider === conn.provider ? { ...c, chainId: before } : c));
          }
        }
      },

      exportKey: conn?.kind === "embedded" ? async () => void (await (await getMagic()).user.revealEVMPrivateKey()) : undefined,
    };
  }, [conn, sessionChecked, user, phase, error, detected, getMagic, fail, signInWith, watch, ensureConnected]);

  return <AuthContextProvider value={api}>{children}</AuthContextProvider>;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** An email wallet has no accounts to switch between: another email is signed in to Magic in this browser. */
const wrongWalletError = (u: SessionUser) =>
  u.walletKind === "embedded"
    ? new SignInError("wrong_wallet", "This browser is signed in to a different email wallet. Choose Disconnect in the top bar, then sign in with your email again. Your account and apps stay the same.")
    : new SignInError("wrong_wallet", `Your wallet has a different account selected. Switch to ${shortAddress(u.wallet)}, the one you signed in with, then try again.`);

function readLastWallet(): ExternalWalletId | null {
  try {
    return localStorage.getItem(LAST_WALLET_KEY) as ExternalWalletId | null;
  } catch {
    return null; // private mode
  }
}

function pickInjected(id: ExternalWalletId | string): Injected | undefined {
  return pickInjectedFrom(id, announced, pageWindow());
}

async function initWalletConnect(showQrModal: boolean) {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!projectId) throw new SignInError("wallet_missing", "WalletConnect isn't set up on this deployment (no project id).");
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href;
  return EthereumProvider.init({
    projectId,
    chains: [celo.id],
    // Celo Sepolia only when someone picks the testnet; Base only for the GoodCash top-up permit (D122).
    optionalChains: [celoSepolia.id, base.id],
    rpcMap: { [celoSepolia.id]: celoSepolia.rpcUrls.default.http[0], [celo.id]: celo.rpcUrls.default.http[0], [base.id]: base.rpcUrls.default.http[0] },
    metadata: walletConnectMetadata(window.location.origin, icon),
    showQrModal,
  });
}

/** Magic + external wallets on Celo (default) and Celo Sepolia. */
export function MagicAuthProvider({ publishableKey, children }: { publishableKey: string; children: React.ReactNode }) {
  return <MagicBridge publishableKey={publishableKey}>{children}</MagicBridge>;
}
