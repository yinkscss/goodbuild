import type { EIP1193Provider } from "viem";

import type { ExternalWalletId } from "./types";

/**
 * Finding browser wallets, kept free of module state so it can be tested: each function takes what
 * the page has announced (EIP-6963) and the window. magic-auth.tsx owns the live state and calls these.
 */

export type Injected = EIP1193Provider & { isMetaMask?: boolean; isMiniPay?: boolean; providers?: Injected[] } & Record<string, unknown>;

/** EIP-6963: wallets announce themselves with a reverse-DNS id, so "MetaMask" can mean MetaMask and nothing else. */
export type Announced = { info: { rdns: string; name: string }; provider: Injected };

/** The globals wallets inject. `okxwallet` is the one OKX documents for its extension and for the OKX app's own browser. */
export interface WalletWindow {
  ethereum?: Injected;
  okxwallet?: Injected;
}

/**
 * OKX Wallet's EIP-6963 id. UNVERIFIED against a real extension: it is the rdns RainbowKit declares for OKX,
 * and OKX's own docs name only window.okxwallet. Either way of finding the wallet works.
 */
export const OKX_RDNS = "com.okex.wallet";

/** Rainbow, Brave, Coinbase, Phantom, Rabby, Trust and others set isMetaMask = true to be compatible. Only the rdns tells them apart. */
export const IMPERSONATORS = ["isRainbow", "isBraveWallet", "isCoinbaseWallet", "isPhantom", "isRabby", "isTrust", "isTrustWallet", "isOkxWallet", "isOKExWallet", "isTokenPocket", "isZerion", "isFrame", "isExodus"];

export function legacyProviders(win: WalletWindow | undefined): Injected[] {
  const eth = win?.ethereum;
  return eth ? [eth, ...(eth.providers ?? [])] : [];
}

export function injectedProviders(announced: ReadonlyMap<string, Announced>, win: WalletWindow | undefined): Injected[] {
  return [...[...announced.values()].map((a) => a.provider), ...legacyProviders(win)];
}

export function findMetaMask(announced: ReadonlyMap<string, Announced>, win: WalletWindow | undefined): Injected | undefined {
  const real = announced.get("io.metamask") ?? announced.get("io.metamask.flask");
  if (real) return real.provider;
  // Wallets that do not announce (older MetaMask): accept window.ethereum only when nothing else claims to own it.
  if (announced.size > 0) return undefined;
  // OKX's extension can take over window.ethereum. The flags are not in OKX's docs, so also refuse the OKX object itself.
  return legacyProviders(win).find((p) => p.isMetaMask && !p.isMiniPay && p !== win?.okxwallet && !IMPERSONATORS.some((k) => p[k]));
}

/** The announced OKX wallet, else the global OKX documents. A global without a request method is not a wallet. */
export function findOkx(announced: ReadonlyMap<string, Announced>, win: WalletWindow | undefined): Injected | undefined {
  const announcedOkx = announced.get(OKX_RDNS)?.provider;
  if (announcedOkx) return announcedOkx;
  const okx = win?.okxwallet;
  return okx && typeof okx.request === "function" ? okx : undefined;
}

export function pickInjected(id: ExternalWalletId | string, announced: ReadonlyMap<string, Announced>, win: WalletWindow | undefined): Injected | undefined {
  if (id === "minipay") return injectedProviders(announced, win).find((p) => p.isMiniPay);
  if (id === "metamask") return findMetaMask(announced, win);
  if (id === "okx") return findOkx(announced, win);
  return undefined;
}

export function detectInstalled(announced: ReadonlyMap<string, Announced>, win: WalletWindow | undefined): Partial<Record<ExternalWalletId, boolean>> {
  return {
    metamask: !!findMetaMask(announced, win),
    okx: !!findOkx(announced, win),
    minipay: injectedProviders(announced, win).some((p) => p.isMiniPay),
  };
}

const LABELS: Record<ExternalWalletId, string> = {
  metamask: "MetaMask",
  minipay: "MiniPay",
  okx: "OKX Wallet",
  walletconnect: "WalletConnect",
};

/** The name shown next to a connected wallet, e.g. "Continue as 0x7a3…e41c · OKX Wallet". */
export function walletLabel(id: ExternalWalletId): string {
  return LABELS[id];
}

/** What to tell someone who picked a browser wallet that isn't in this browser. */
export function missingWalletMessage(id: ExternalWalletId): string {
  if (id === "minipay") return "MiniPay isn't available in this browser. Open GoodBuild inside MiniPay, or use WalletConnect for Valora.";
  if (id === "okx") return "OKX Wallet isn't installed in this browser. Open GoodBuild inside the OKX app's browser, or try WalletConnect.";
  return "MetaMask isn't installed in this browser. Try WalletConnect.";
}
