/**
 * The wallet layer every generated app gets (D36). GoodBuild owns these files: the builder can't
 * edit them (checks.ts pathProblem), and every turn and every publish writes the current copy
 * (withCurrentWalletHelpers), like the data helpers (D34).
 *
 * - src/lib/goodbuild/wallet.ts: EIP-6963 discovery (plus the old window.ethereum as a fallback),
 *   MiniPay detection, connect, restore, disconnect and chain switching.
 * - src/lib/goodbuild/walletChooser.tsx: the small "Connect a wallet" dialog.
 * - src/lib/goodbuild/walletConnect.tsx: a stand-in in the project. Publishing swaps in the real
 *   WalletConnect module (src/server/publish/walletconnect-module.ts) as a lazily loaded chunk, so the
 *   Sandpack preview never bundles WalletConnect and published apps only download it when a visitor
 *   picks it.
 *
 * Sources are String.raw so regexes keep their backslashes; they must not contain backticks or "${".
 */

import { createHash } from "node:crypto";

export const WALLET_DIR = "src/lib/goodbuild/";

const WALLET = String.raw`/**
 * Written by GoodBuild: how this app finds and connects wallets. Don't edit it, and don't read
 * window.ethereum yourself: use connectWallet / writeContract (src/lib/chain.ts), useWallet
 * (src/lib/useWallet.ts) and ConnectButton.
 *
 * Browser wallets are found with EIP-6963, so several extensions can live side by side and the
 * visitor picks one. MiniPay connects on its own, with no list. Phone wallets (MetaMask, Valora and
 * others) connect with WalletConnect once the app is published: a QR code on a computer, a button per
 * wallet on a phone. The preview offers browser wallets only.
 */
import type { Address, EIP1193Provider } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { openWalletChooser } from "./walletChooser";

/** Written by GoodBuild for this project's target network. */
export const appChain = celoSepolia;

export interface WalletInfo {
  /** "minipay", "walletconnect", "injected", or the wallet's EIP-6963 rdns such as "io.metamask". */
  id: string;
  name: string;
  /** A data:image/ or https: URL, or null. */
  icon: string | null;
  kind: "injected" | "walletconnect";
}

export interface WalletState {
  account: Address | null;
  wallet: WalletInfo | null;
  connecting: boolean;
}

export class WalletError extends Error {
  code: string | number;
  constructor(code: string | number, message: string) {
    super(message);
    this.code = code;
  }
}

type Handler = (...args: never[]) => void;
type Provider = EIP1193Provider & {
  isMiniPay?: boolean;
  isMetaMask?: boolean;
  accounts?: string[];
  on?: (event: string, handler: Handler) => void;
  removeListener?: (event: string, handler: Handler) => void;
  disconnect?: () => Promise<void>;
};
type Announced = { info: WalletInfo; provider: Provider };

const STORAGE_KEY = "goodbuild-wallet";
const MINIPAY: WalletInfo = { id: "minipay", name: "MiniPay", icon: null, kind: "injected" };
const WALLETCONNECT: WalletInfo = { id: "walletconnect", name: "WalletConnect", icon: null, kind: "walletconnect" };

let state: WalletState = { account: null, wallet: null, connecting: false };
let active: Provider | null = null;
let pending: Promise<Address> | null = null;
let restoring: Promise<void> | null = null;
let listening = false;
let walletConnectStarted = false;
const listeners = new Set<() => void>();
const announced = new Map<string, Announced>();

function emit() {
  for (const listener of [...listeners]) listener();
}

function setState(next: Partial<WalletState>) {
  state = { ...state, ...next };
  emit();
}

/** The current account, wallet and whether a connection is in progress. Stable between changes. */
export function walletState(): WalletState {
  return state;
}

/** Called on every change (for useSyncExternalStore). Returns the unsubscribe function. */
export function subscribeWallet(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The connected wallet's EIP-1193 provider, or null. For requests the helpers don't cover, such as wallet_watchAsset. */
export function walletProvider(): EIP1193Provider | null {
  return active;
}

/** Only data:image/ and https: icons, so a wallet's announcement can't point the page anywhere else. */
export function safeIcon(icon: unknown): string | null {
  if (typeof icon !== "string" || icon.length > 100000) return null;
  const lower = icon.slice(0, 16).toLowerCase();
  return lower.startsWith("data:image/") || lower.startsWith("https://") ? icon : null;
}

function legacy(): Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const eth = (window as unknown as { ethereum?: Provider }).ethereum;
  return eth && typeof eth.request === "function" ? eth : undefined;
}

/** True inside the MiniPay wallet, which connects without asking. */
export function isMiniPay(): boolean {
  return legacy()?.isMiniPay === true;
}

function onAnnounce(event: Event) {
  const detail = (event as CustomEvent).detail as { info?: { uuid?: unknown; name?: unknown; icon?: unknown; rdns?: unknown }; provider?: Provider } | undefined;
  const provider = detail?.provider;
  const info = detail?.info;
  if (!provider || typeof provider.request !== "function" || !info) return;
  const id = String(info.rdns || info.uuid || "").slice(0, 100);
  if (!id || id === MINIPAY.id || id === WALLETCONNECT.id || id === "injected") return;
  const name = String(info.name || "Browser wallet").slice(0, 40);
  announced.set(id, { info: { id, name, icon: safeIcon(info.icon), kind: "injected" }, provider });
  emit();
}

/** Ask installed wallets to announce themselves (EIP-6963). Safe to call more than once. */
export function discoverWallets(): void {
  if (typeof window === "undefined") return;
  if (!listening) {
    listening = true;
    window.addEventListener("eip6963:announceProvider", onAnnounce);
  }
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

discoverWallets();

/** Wallets in this browser: every EIP-6963 announcement, plus window.ethereum if it didn't announce itself. */
export function browserWallets(): WalletInfo[] {
  const found = [...announced.values()];
  const list = found.map((w) => w.info);
  const eth = legacy();
  if (eth && !eth.isMiniPay && !found.some((w) => w.provider === eth)) {
    list.push({ id: "injected", name: eth.isMetaMask ? "MetaMask" : "Browser wallet", icon: null, kind: "injected" });
  }
  return list;
}

function walletConnectProjectId(): string | null {
  if (typeof document === "undefined") return null;
  return document.querySelector('meta[name="goodbuild-walletconnect"]')?.getAttribute("content") || null;
}

/** WalletConnect (phone wallets) is on in published apps. The preview has browser wallets only. */
export function walletConnectAvailable(): boolean {
  return !!walletConnectProjectId();
}

/** What the chooser lists, in order. */
export function walletOptions(): WalletInfo[] {
  if (isMiniPay()) return [MINIPAY];
  return walletConnectAvailable() ? [...browserWallets(), WALLETCONNECT] : browserWallets();
}

/** True when there's some way to connect: MiniPay, a browser wallet, or WalletConnect. */
export function hasWallet(): boolean {
  return walletOptions().length > 0;
}

function providerOf(info: WalletInfo): Provider | undefined {
  if (info.id === MINIPAY.id || info.id === "injected") return legacy();
  return announced.get(info.id)?.provider;
}

function remember(info: WalletInfo | null) {
  try {
    if (info) localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: info.id, kind: info.kind }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private windows may refuse. The visitor just picks again next time.
  }
}

function remembered(): { id: string; kind: string } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { id?: unknown; kind?: unknown } | null;
    return saved && typeof saved.id === "string" && typeof saved.kind === "string" ? { id: saved.id, kind: saved.kind } : null;
  } catch {
    return null;
  }
}

const onAccountsChanged = (accounts: string[]) => {
  const account = (accounts?.[0] as Address | undefined) ?? null;
  if (account) setState({ account });
  else void disconnectWallet();
};
const onDisconnect = () => void disconnectWallet();

function detach() {
  active?.removeListener?.("accountsChanged", onAccountsChanged as Handler);
  active?.removeListener?.("disconnect", onDisconnect as Handler);
}

function adopt(info: WalletInfo, provider: Provider, account: Address): Address {
  detach();
  active = provider;
  provider.on?.("accountsChanged", onAccountsChanged as Handler);
  if (info.kind === "walletconnect") provider.on?.("disconnect", onDisconnect as Handler);
  remember(info);
  setState({ account, wallet: info });
  return account;
}

async function connectInjected(info: WalletInfo, provider: Provider): Promise<Address> {
  const [account] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  if (!account) throw new WalletError("no_account", "Your wallet didn't share an account. Unlock it and try again.");
  adopt(info, provider, account);
  await ensureChain(provider);
  return account;
}

/** Connect one wallet from the list. onUri gets the WalletConnect link to show as a QR code or open in a phone wallet. */
export async function connectWith(info: WalletInfo, onUri: (uri: string) => void = () => {}): Promise<Address> {
  if (info.kind === "walletconnect") {
    const projectId = walletConnectProjectId();
    if (!projectId) throw new WalletError("no_walletconnect", "Phone wallets connect once this app is published.");
    walletConnectStarted = true;
    const wc = await import("./walletConnect");
    const provider = (await wc.connectWalletConnect({ projectId, chain: appChain, onUri })) as unknown as Provider;
    const account = provider.accounts?.[0] as Address | undefined;
    if (!account) throw new WalletError("no_account", "The wallet didn't share an account. Try again.");
    return adopt(WALLETCONNECT, provider, account);
  }
  const provider = providerOf(info);
  if (!provider) throw new WalletError("no_wallet", info.name + " isn't available any more. Reload the page and try again.");
  return connectInjected(info, provider);
}

/** Stop a WalletConnect attempt the visitor walked away from. */
export async function cancelWalletConnect(): Promise<void> {
  // Not started means nothing to stop, and WalletConnect's code stays undownloaded.
  if (!walletConnectStarted) return;
  const wc = await import("./walletConnect");
  wc.cancelWalletConnect();
}

/** Give the page a moment to hear from wallets that loaded after it. */
function waitForWallets(ms = 60): Promise<void> {
  discoverWallets();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chooseAndConnect(): Promise<Address> {
  if (isMiniPay()) return connectInjected(MINIPAY, legacy()!);
  if (!browserWallets().length) await waitForWallets();
  const options = walletOptions();
  if (!options.length) {
    throw new WalletError("no_wallet", "No wallet found. Install a wallet such as MetaMask or Valora, or open this app in MiniPay.");
  }
  // One browser wallet and nothing else to choose (the preview): connect it straight away.
  if (options.length === 1 && options[0].kind === "injected") return connectWith(options[0]);
  return openWalletChooser({ options, connect: connectWith, cancel: cancelWalletConnect });
}

/**
 * Connect a wallet and return its address. Shows the wallet list when there's a choice; inside
 * MiniPay it connects straight away. If a wallet is already connected, returns its address.
 * Throws a WalletError with code 4001 if the visitor closes the list.
 */
export function connectWallet(): Promise<Address> {
  if (state.account && active) return Promise.resolve(state.account);
  if (!pending) {
    setState({ connecting: true });
    pending = chooseAndConnect().finally(() => {
      pending = null;
      setState({ connecting: false });
    });
  }
  return pending;
}

/** Forget the wallet in this app. Browser wallets are asked to drop the permission where they support it. */
export async function disconnectWallet(): Promise<void> {
  const provider = active;
  const wallet = state.wallet;
  detach();
  active = null;
  remember(null);
  setState({ account: null, wallet: null });
  if (!provider) return;
  if (wallet?.kind === "walletconnect") await provider.disconnect?.().catch(() => {});
  else await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] } as never).catch(() => {});
}

/** Reconnect the wallet used last time without asking, if it still allows it. In MiniPay, connect. */
export function restoreWallet(): Promise<void> {
  restoring ??= (async () => {
    if (state.account) return;
    if (isMiniPay()) {
      await connectWallet();
      return;
    }
    const saved = remembered();
    if (!saved) return;
    if (saved.kind === "walletconnect") {
      const projectId = walletConnectProjectId();
      if (!projectId) return;
      const wc = await import("./walletConnect");
      const provider = (await wc.restoreWalletConnect({ projectId, chain: appChain })) as unknown as Provider | null;
      const account = provider?.accounts?.[0] as Address | undefined;
      if (provider && account && !state.account) adopt(WALLETCONNECT, provider, account);
      return;
    }
    if (!announced.has(saved.id)) await waitForWallets(300);
    const info = browserWallets().find((w) => w.id === saved.id);
    const provider = info && providerOf(info);
    if (!info || !provider) return;
    const [account] = (await provider.request({ method: "eth_accounts" })) as Address[];
    if (account && !state.account) adopt(info, provider, account);
  })().catch(() => {});
  return restoring;
}

/** Switch the wallet to this app's chain, adding the chain first if the wallet doesn't know it. */
export async function ensureChain(provider: EIP1193Provider | null = active): Promise<void> {
  if (!provider) throw new WalletError("not_connected", "Connect a wallet first.");
  const hex = "0x" + appChain.id.toString(16);
  const current = await provider.request({ method: "eth_chainId" }).catch(() => null);
  if (typeof current === "string" && parseInt(current, 16) === appChain.id) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hex,
          chainName: appChain.name,
          nativeCurrency: appChain.nativeCurrency,
          rpcUrls: [appChain.rpcUrls.default.http[0]],
          blockExplorerUrls: appChain.blockExplorers ? [appChain.blockExplorers.default.url] : [],
        },
      ],
    });
  }
}

/** Connect if needed, switch to this app's chain, and return the provider and account to send with. */
export async function requireWallet(): Promise<{ provider: EIP1193Provider; account: Address }> {
  const account = await connectWallet();
  await ensureChain();
  if (!active) throw new WalletError("not_connected", "Connect a wallet first.");
  return { provider: active, account };
}
`;

const CHOOSER = String.raw`/**
 * Written by GoodBuild: the "Connect a wallet" list that connectWallet() opens. Don't edit it.
 * Styled with this app's theme colours (with fallbacks), so it fits any design.
 */
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Address } from "viem";
import type { WalletInfo } from "./wallet";

type Connect = (info: WalletInfo, onUri: (uri: string) => void) => Promise<Address>;

/**
 * Phone wallets that open a WalletConnect link. Formats follow each wallet's universal link plus
 * "/wc?uri=" (UNVERIFIED on real phones; see docs/HANDOFF.md). "Other wallet" opens the plain wc: link.
 */
export const PHONE_WALLETS = [
  { name: "MetaMask", link: "https://metamask.app.link/wc?uri=" },
  { name: "Valora", link: "https://valoraapp.com/wc?uri=" },
  { name: "Trust Wallet", link: "https://link.trustwallet.com/wc?uri=" },
  { name: "Rainbow", link: "https://rnbwapp.com/wc?uri=" },
];

export function isPhone(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

const STYLE = [
  "[data-goodbuild-wallets]{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;background:rgba(17,17,17,.4);font-family:var(--font-sans,Inter,ui-sans-serif,system-ui,sans-serif);color:var(--color-foreground,#111)}",
  "@media (min-width:640px){[data-goodbuild-wallets]{align-items:center}}",
  ".gbw-panel{box-sizing:border-box;width:100%;max-width:400px;max-height:90vh;overflow:auto;margin:0;padding:24px;border-radius:24px 24px 0 0;background:var(--color-card,#fff);box-shadow:0 2px 6px rgba(17,17,17,.04),0 40px 80px -30px rgba(89,46,129,.3)}",
  "@media (min-width:640px){.gbw-panel{border-radius:24px;margin:16px}}",
  ".gbw-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}",
  ".gbw-title{margin:0;font-size:18px;font-weight:600}",
  ".gbw-close,.gbw-back{border:0;background:transparent;color:var(--color-muted-foreground,#7a7a7a);font:inherit;font-size:14px;cursor:pointer;padding:6px 8px;border-radius:9999px}",
  ".gbw-close:hover,.gbw-back:hover{background:var(--color-muted,#f5f5f5)}",
  ".gbw-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}",
  ".gbw-row{box-sizing:border-box;display:flex;width:100%;align-items:center;gap:12px;padding:12px;border:1px solid var(--color-border,rgba(17,17,17,.08));border-radius:16px;background:var(--color-card,#fff);color:inherit;font:inherit;font-size:14px;font-weight:500;text-align:left;text-decoration:none;cursor:pointer}",
  ".gbw-row:hover{background:var(--color-muted,#f5f5f5)}",
  ".gbw-row:focus-visible,.gbw-close:focus-visible,.gbw-back:focus-visible,.gbw-copy:focus-visible{outline:none;box-shadow:0 0 0 4px rgba(89,46,129,.18)}",
  ".gbw-row[disabled]{opacity:.6;cursor:default}",
  ".gbw-icon{width:32px;height:32px;flex:none;border-radius:10px;object-fit:contain;display:grid;place-items:center;font-weight:700;color:#fff;background:var(--color-accent,#592e81)}",
  ".gbw-hint{display:block;font-size:12px;font-weight:400;color:var(--color-muted-foreground,#7a7a7a)}",
  ".gbw-note{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--color-muted-foreground,#7a7a7a)}",
  ".gbw-error{margin:0 0 12px;padding:10px 12px;border-radius:12px;font-size:13px;background:rgba(210,56,75,.08);color:var(--color-danger,#d2384b)}",
  ".gbw-qr{display:grid;place-items:center;padding:16px;border-radius:16px;background:#fff;border:1px solid var(--color-border,rgba(17,17,17,.08))}",
  ".gbw-qr svg{display:block;width:100%;max-width:240px;height:auto}",
  ".gbw-copy{margin-top:12px;width:100%;padding:10px 12px;border:0;border-radius:9999px;background:var(--color-muted,#f5f5f5);color:inherit;font:inherit;font-size:13px;font-weight:500;cursor:pointer}",
].join("\n");

function addStyle() {
  if (document.getElementById("goodbuild-wallets-style")) return;
  const style = document.createElement("style");
  style.id = "goodbuild-wallets-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function Icon({ info }: { info: { name: string; icon?: string | null } }) {
  if (info.icon) return <img className="gbw-icon" style={{ background: "transparent" }} src={info.icon} alt="" />;
  return (
    <span className="gbw-icon" aria-hidden="true">
      {info.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function message(e: unknown): string {
  const err = e as { code?: unknown; message?: string; shortMessage?: string } | undefined;
  if (err?.code === 4001 || /user (rejected|denied)/i.test(err?.message ?? "")) return "You cancelled the request in your wallet.";
  return (err?.shortMessage ?? err?.message ?? "Couldn't connect. Try again.").split("\n")[0];
}

type View = { step: "list" } | { step: "waiting"; name: string } | { step: "walletconnect"; uri: string | null };
type Qr = ComponentType<{ value: string }>;

export function WalletChooser({
  options,
  connect,
  onDone,
  onCancel,
  onBack,
  phone = isPhone(),
}: {
  options: WalletInfo[];
  connect: Connect;
  onDone: (account: Address) => void;
  onCancel: () => void;
  onBack?: () => void;
  phone?: boolean;
}) {
  const [view, setView] = useState<View>({ step: "list" });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [Qr, setQr] = useState<Qr | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const attempt = useRef(0);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button, a")?.focus();
  }, [view.step]);

  async function pick(info: WalletInfo) {
    const id = ++attempt.current;
    setError(null);
    setCopied(false);
    if (info.kind === "walletconnect") {
      setView({ step: "walletconnect", uri: null });
      if (!phone) {
        import("./walletConnect").then((m) => setQr(() => m.QrCode as Qr)).catch(() => {});
      }
    } else {
      setView({ step: "waiting", name: info.name });
    }
    try {
      const account = await connect(info, (uri) => {
        if (attempt.current === id) {
          setCopied(false);
          setView({ step: "walletconnect", uri });
        }
      });
      if (attempt.current === id) onDone(account);
    } catch (e) {
      if (attempt.current !== id) return;
      setError(message(e));
      setView({ step: "list" });
    }
  }

  function back() {
    attempt.current++;
    onBack?.();
    setView({ step: "list" });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function copy(uri: string) {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const title = view.step === "walletconnect" ? (phone ? "Open your wallet" : "Scan with your phone") : "Connect a wallet";

  return (
    <div data-goodbuild-wallets="" onMouseDown={(e) => e.target === e.currentTarget && onCancel()} onKeyDown={onKeyDown}>
      <div ref={panel} className="gbw-panel" role="dialog" aria-modal="true" aria-labelledby="gbw-title">
        <div className="gbw-head">
          {view.step === "list" ? null : (
            <button type="button" className="gbw-back" onClick={back}>
              Back
            </button>
          )}
          <h2 id="gbw-title" className="gbw-title">
            {title}
          </h2>
          <button type="button" className="gbw-close" onClick={onCancel} aria-label="Close">
            Close
          </button>
        </div>

        {error ? (
          <p className="gbw-error" role="alert">
            {error}
          </p>
        ) : null}

        {view.step === "list" ? (
          <ul className="gbw-list">
            {options.map((info) => (
              <li key={info.id}>
                <button type="button" className="gbw-row" onClick={() => void pick(info)}>
                  <Icon info={info} />
                  <span>
                    {info.name}
                    <span className="gbw-hint">{info.kind === "walletconnect" ? (phone ? "MetaMask, Valora and other phone wallets" : "Scan a QR code with a phone wallet") : "In this browser"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {view.step === "waiting" ? (
          <p className="gbw-note" role="status">
            Confirm in {view.name}. If nothing opens, check your wallet's window.
          </p>
        ) : null}

        {view.step === "walletconnect" && !view.uri ? (
          <p className="gbw-note" role="status">
            Getting a connection link ready...
          </p>
        ) : null}

        {view.step === "walletconnect" && view.uri && !phone ? (
          <div>
            <div className="gbw-qr" data-goodbuild-qr="" aria-label="WalletConnect QR code">
              {Qr ? <Qr value={view.uri} /> : <span className="gbw-hint">Loading the QR code...</span>}
            </div>
            <button type="button" className="gbw-copy" onClick={() => void copy(view.uri!)}>
              {copied ? "Link copied" : "Copy link"}
            </button>
            <p className="gbw-note">Open a WalletConnect wallet on your phone (MetaMask, Valora and others) and scan this code. Keep this page open until it connects.</p>
          </div>
        ) : null}

        {view.step === "walletconnect" && view.uri && phone ? (
          <div>
            <ul className="gbw-list">
              {PHONE_WALLETS.map((w) => (
                <li key={w.name}>
                  <a className="gbw-row" href={w.link + encodeURIComponent(view.uri!)} rel="noreferrer">
                    <Icon info={w} />
                    <span>{w.name}</span>
                  </a>
                </li>
              ))}
              <li>
                <a className="gbw-row" href={view.uri} rel="noreferrer">
                  <Icon info={{ name: "Other wallet" }} />
                  <span>
                    Other wallet
                    <span className="gbw-hint">Any app that supports WalletConnect</span>
                  </span>
                </a>
              </li>
            </ul>
            <button type="button" className="gbw-copy" onClick={() => void copy(view.uri!)}>
              {copied ? "Link copied" : "Copy link"}
            </button>
            <p className="gbw-note">Approve in your wallet, then come back to this page.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Show the list and resolve with the connected account. Rejects with code 4001 if the visitor closes it. */
export function openWalletChooser(args: { options: WalletInfo[]; connect: Connect; cancel: () => Promise<void> }): Promise<Address> {
  return new Promise((resolve, reject) => {
    addStyle();
    const host = document.createElement("div");
    host.setAttribute("data-goodbuild-wallets-root", "");
    document.body.appendChild(host);
    const root = createRoot(host);
    const before = document.activeElement as HTMLElement | null;
    let settled = false;
    const finish = (account: Address | null) => {
      if (settled) return;
      settled = true;
      setTimeout(() => {
        root.unmount();
        host.remove();
        before?.focus?.();
      });
      if (account) resolve(account);
      else {
        void args.cancel().catch(() => {});
        reject(Object.assign(new Error("You closed the wallet list."), { code: 4001 }));
      }
    };
    root.render(<WalletChooser options={args.options} connect={args.connect} onDone={(a) => finish(a)} onCancel={() => finish(null)} onBack={() => void args.cancel().catch(() => {})} />);
  });
}
`;

/** The stand-in that ships in the project and the preview. Publishing replaces it (see the file header). */
const WALLETCONNECT_STUB = String.raw`/**
 * Written by GoodBuild. In the preview this is a stand-in: phone wallets (WalletConnect) connect once
 * the app is published, where GoodBuild puts the real module here. Don't edit or import it.
 */
import type { Chain, EIP1193Provider } from "viem";

export const walletConnectBuiltIn = false;

export async function connectWalletConnect(_args: { projectId: string; chain: Chain; onUri: (uri: string) => void }): Promise<EIP1193Provider> {
  throw new Error("Phone wallets connect once this app is published.");
}

export async function restoreWalletConnect(_args: { projectId: string; chain: Chain }): Promise<EIP1193Provider | null> {
  return null;
}

export function cancelWalletConnect(): void {}

export function QrCode(_props: { value: string }) {
  return null;
}
`;

export const WALLET_PATHS = {
  wallet: WALLET_DIR + "wallet.ts",
  chooser: WALLET_DIR + "walletChooser.tsx",
  walletConnect: WALLET_DIR + "walletConnect.tsx",
} as const;

/** GoodBuild's wallet files: always present and always current in every project. */
const SEPOLIA_CHAIN_ID = 11142220;
const MAINNET_CHAIN_ID = 42220;

function chainExportName(chainId: number): "celo" | "celoSepolia" {
  if (chainId === MAINNET_CHAIN_ID) return "celo";
  if (chainId === SEPOLIA_CHAIN_ID) return "celoSepolia";
  throw new Error(`Unsupported project chain id ${chainId}.`);
}

function walletSourceFor(chainId: number): string {
  const selected = chainExportName(chainId);
  return WALLET
    .replace('import { celo, celoSepolia } from "viem/chains";', `import { ${selected} } from "viem/chains";`)
    .replace("export const appChain = celoSepolia;", `export const appChain = ${selected};`);
}

export function walletHelpersFor(chainId = SEPOLIA_CHAIN_ID): Record<string, string> {
  return {
    [WALLET_PATHS.wallet]: walletSourceFor(chainId),
    [WALLET_PATHS.chooser]: CHOOSER,
    [WALLET_PATHS.walletConnect]: WALLETCONNECT_STUB,
  };
}

export const WALLET_HELPERS: Record<string, string> = walletHelpersFor();

// --- Starter files that use the layer. The builder may edit these; untouched old copies are upgraded.

export const CHAIN = String.raw`import { createPublicClient, createWalletClient, custom, http, type Abi, type Address } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { requireWallet } from "./goodbuild/wallet";

// The wallet itself (finding wallets, the wallet list, WalletConnect, MiniPay) is GoodBuild's,
// in src/lib/goodbuild/. These are the parts this app uses.
export { connectWallet, disconnectWallet, walletProvider } from "./goodbuild/wallet";

/** Written by GoodBuild for this project's target network. */
export const chain = celoSepolia;
export const chains = { [celoSepolia.id]: celoSepolia, [celo.id]: celo } as const;

export const publicClient = createPublicClient({ chain, transport: http() });

/** Send a contract write from the connected wallet (connecting first if needed) and wait for the receipt. */
export async function writeContract(args: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}) {
  const { provider, account } = await requireWallet();
  const wallet = createWalletClient({ account, chain, transport: custom(provider) });
  const { request } = await publicClient.simulateContract({ ...args, account } as never);
  const hash = await wallet.writeContract(request as never);
  return publicClient.waitForTransactionReceipt({ hash });
}
`;

/** The chain helper is rendered per project, retaining both networks for contract address maps. */
export function chainSourceFor(chainId = SEPOLIA_CHAIN_ID): string {
  return CHAIN.replace("export const chain = celoSepolia;", `export const chain = ${chainExportName(chainId)};`);
}

const hash = (source: string) => createHash("sha256").update(source).digest("hex");
const CHAIN_TEMPLATE_HASHES = new Set([hash(CHAIN), hash(chainSourceFor(MAINNET_CHAIN_ID))]);

function legacyChainFor(source: string, chainId: number): string {
  return source.replace("export const chain = celoSepolia;", `export const chain = ${chainExportName(chainId)};`);
}

export const USE_WALLET = String.raw`import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { connectWallet, disconnectWallet, restoreWallet, subscribeWallet, walletState } from "./goodbuild/wallet";

/**
 * The connected account, the wallet's name, connect and disconnect, and any connection error.
 * connect() shows the wallet list (browser wallets and, once published, phone wallets by QR code or
 * link); inside MiniPay it connects on its own. The last wallet used reconnects on the next visit.
 */
export function useWallet() {
  const state = useSyncExternalStore(subscribeWallet, walletState, walletState);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void restoreWallet();
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      await connectWallet();
    } catch (e) {
      // Closing the list or rejecting in the wallet isn't an error worth showing.
      if ((e as { code?: unknown }).code !== 4001) setError(e instanceof Error ? e.message : "Could not connect.");
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    await disconnectWallet();
  }, []);

  return { account: state.account, walletName: state.wallet?.name ?? null, connect, disconnect, connecting: state.connecting, error };
}
`;

export const CONNECT_BUTTON = String.raw`import { LogOut, Wallet } from "lucide-react";
import { Button } from "./ui/button";
import { useWallet } from "../lib/useWallet";
import { shortAddress } from "../lib/utils";

/** Connect button: opens the wallet list; once connected, shows the address and a disconnect button. */
export function ConnectButton() {
  const { account, connect, disconnect, connecting, walletName } = useWallet();
  if (account) {
    return (
      <div className="inline-flex items-center gap-1">
        <Button variant="outline" title={walletName ? "Connected with " + walletName : undefined}>
          {shortAddress(account)}
        </Button>
        <Button variant="ghost" size="sm" onClick={disconnect} aria-label="Disconnect wallet" title="Disconnect">
          <LogOut className="size-4" />
        </Button>
      </div>
    );
  }
  return (
    <Button onClick={connect} disabled={connecting}>
      <Wallet className="size-4" />
      {connecting ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
`;

/**
 * sha256 of the starter files from before D36, which only read window.ethereum. They never changed
 * until then, so a project whose copy still matches has never edited it and gets the new one.
 */
const LEGACY: Record<string, { sha256: string; current: string }> = {
  "src/lib/chain.ts": { sha256: "0608af3d230aefd28e613ef0c069d6e17fd43e348084151eec4288c739a8686a", current: CHAIN },
  "src/lib/useWallet.ts": { sha256: "464b4566ed4fef3a36f548d8996d8c85863ecb48376a6a0f45cf4988b3eaa6ab", current: USE_WALLET },
  "src/components/ConnectButton.tsx": { sha256: "3b22244b9be11f78416d45ed398562ee89806ed08a8e47b1b46b8ee72f707241", current: CONNECT_BUTTON },
};

const LEGACY_CHAIN = "src/lib/chain.ts";
const LEGACY_HOOK = "src/lib/useWallet.ts";
const LEGACY_BUTTON = "src/components/ConnectButton.tsx";

/**
 * Every project always has the current wallet layer, and untouched pre-D36 copies of chain.ts,
 * useWallet.ts and ConnectButton.tsx move onto it, but never only some of them. chain.ts sends and
 * useWallet.ts shows the account, so they move together or not at all: otherwise the page could show
 * the wallet the visitor picked while the transaction goes to window.ethereum. If the builder edited
 * either one on the old path, the app stays on window.ethereum. An edited ConnectButton stays as it is
 * and works with the new hook.
 */
export function withCurrentWalletHelpers(files: Record<string, string>, chainId = SEPOLIA_CHAIN_ID): Record<string, string> {
  const out = { ...files, ...walletHelpersFor(chainId) };
  const isOld = (p: string) => p in out && createHash("sha256").update(out[p]).digest("hex") === LEGACY[p].sha256;
  const canMove = (p: string) => !(p in out) || isOld(p) || out[p].includes("./goodbuild/wallet");
  const savedChain = files[LEGACY_CHAIN];
  const savedChainHash = savedChain ? hash(savedChain) : null;
  const oldChainHash = LEGACY[LEGACY_CHAIN].sha256;
  if (!savedChain) out[LEGACY_CHAIN] = chainSourceFor(chainId);
  if (!canMove(LEGACY_CHAIN) || !canMove(LEGACY_HOOK)) {
    // Preserve the pre-D36 wallet implementation when one half was customized, but still move its
    // network constant with the project. Known GoodBuild chain helpers can be safely regenerated.
    if (savedChainHash === oldChainHash) out[LEGACY_CHAIN] = legacyChainFor(savedChain!, chainId);
    else if (savedChainHash && CHAIN_TEMPLATE_HASHES.has(savedChainHash)) out[LEGACY_CHAIN] = chainSourceFor(chainId);
    return out;
  }
  for (const p of [LEGACY_CHAIN, LEGACY_HOOK, LEGACY_BUTTON]) {
    if (isOld(p) && p !== LEGACY_CHAIN) out[p] = LEGACY[p].current;
  }
  if (savedChainHash === oldChainHash || (savedChainHash && CHAIN_TEMPLATE_HASHES.has(savedChainHash))) out[LEGACY_CHAIN] = chainSourceFor(chainId);
  return out;
}
