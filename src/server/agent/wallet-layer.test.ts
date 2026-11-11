// @vitest-environment jsdom
/**
 * The wallet layer generated apps get (D36), run as the app would run it: the template's files are
 * bundled with esbuild (React 18 and viem from publish-runtime, like a published app) and loaded
 * fresh for each test, so module state never leaks between tests.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { numberToHex } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WALLETCONNECT_MODULE } from "@/server/publish/walletconnect-module";

import { WALLET_HELPERS, WALLET_PATHS } from "./wallet-template";

type Request = { method: string; params?: unknown };
type Fake = { request: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn>; isMiniPay?: boolean; isMetaMask?: boolean; isOkxWallet?: boolean };
type WalletModule = {
  browserWallets: () => Array<{ id: string; name: string; icon: string | null; kind: string }>;
  walletOptions: () => Array<{ id: string; name: string; kind: string }>;
  connectWallet: () => Promise<string>;
  disconnectWallet: () => Promise<void>;
  restoreWallet: () => Promise<void>;
  walletState: () => { account: string | null; wallet: { id: string; name: string } | null; connecting: boolean };
  walletProvider: () => unknown;
  isMiniPay: () => boolean;
  ensureChain: (p?: unknown) => Promise<void>;
  safeIcon: (icon: unknown) => string | null;
  discoverWallets: () => void;
};
type ChooserModule = { PHONE_WALLETS: Array<{ name: string; link: string; hint?: string; iosOnly?: boolean }>; openWalletChooser: (args: unknown) => Promise<string> };

const SEPOLIA_HEX = "0xaa044c"; // 11142220
// Inside node_modules, so Vitest hands the bundles to Node as they are instead of transforming them.
mkdirSync(path.join(process.cwd(), "node_modules", ".cache"), { recursive: true });
const dir = realpathSync(mkdtempSync(path.join(process.cwd(), "node_modules", ".cache", "gb-wallet-test-")));
const built = new Map<string, string>();
let n = 0;

/** A WalletConnect stand-in for tests: hands out a link, then connects when the test says so. */
const FAKE_WALLETCONNECT = `
export const walletConnectBuiltIn = true;
export let approve = () => {};
export const calls = (window.__wcCalls = []);
export async function connectWalletConnect(args) {
  calls.push("connect");
  args.onUri("wc:abc@2?relay-protocol=irn&symKey=xyz");
  await new Promise((r) => { approve = r; window.__approveWalletConnect = r; });
  return { accounts: ["0x00000000000000000000000000000000000000Wc"], request: async () => SEPOLIA, on() {}, removeListener() {}, disconnect: async () => {} };
}
export async function restoreWalletConnect() { return null; }
export function cancelWalletConnect() { calls.push("cancel"); }
export function QrCode({ value }) { return <svg data-fake-qr={value} />; }
const SEPOLIA = "${SEPOLIA_HEX}";
`;

/** Stands in for @walletconnect/ethereum-provider under the real module: each connect waits to be approved. */
const FAKE_ETHEREUM_PROVIDER = `
export const EthereumProvider = { init: async () => {
  const handlers = new Set();
  const provider = {
    accounts: ["0x00000000000000000000000000000000000000Wc"],
    session: {},
    approvals: [],
    disconnects: 0,
    on: (event, f) => { if (event === "display_uri") handlers.add(f); },
    removeListener: (event, f) => { handlers.delete(f); },
    connect: () => new Promise((resolve) => {
      provider.approvals.push(resolve);
      const link = "wc:link" + provider.approvals.length + "@2?relay-protocol=irn&symKey=xyz";
      for (const f of [...handlers]) f(link);
    }),
    disconnect: async () => { provider.disconnects++; },
    request: async () => "${SEPOLIA_HEX}",
  };
  window.__wcProvider = provider;
  return provider;
} };
`;

/**
 * esbuild can't run inside jsdom (its TextEncoder check fails), so the bundle is built by a small
 * Node script in a child process and imported here.
 */
const BUILD_SCRIPT = `
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const [esbuildPath, input, output, runtimeDir] = process.argv.slice(2);
const { build } = await import(esbuildPath);
const files = JSON.parse(readFileSync(input, "utf8"));
const result = await build({
  stdin: { contents: files["<entry>"], loader: "ts", resolveDir: "/" },
  bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "project", setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.namespace !== "project" && args.importer !== "<stdin>") return null;
      if (args.path === "@walletconnect/ethereum-provider" && "fake-ethereum-provider.ts" in files) return { path: "/fake-ethereum-provider.ts", namespace: "project" };
      if (args.path.startsWith(".")) {
        const base = path.posix.join(args.importer === "<stdin>" ? "/" : path.posix.dirname(args.importer), args.path);
        const hit = [base, base + ".ts", base + ".tsx"].find((c) => c.slice(1) in files);
        return hit ? { path: hit, namespace: "project" } : { errors: [{ text: "missing " + base }] };
      }
      return b.resolve(args.path, { resolveDir: runtimeDir, kind: args.kind });
    });
    b.onLoad({ filter: /.*/, namespace: "project" }, (args) => ({ contents: files[args.path.slice(1)], loader: args.path.endsWith(".tsx") ? "tsx" : "ts" }));
  } }],
});
writeFileSync(output, result.outputFiles[0].text);
`;
writeFileSync(path.join(dir, "build.mjs"), BUILD_SCRIPT);

async function load(opts: { walletConnect?: boolean; realWalletConnect?: boolean } = {}): Promise<{ wallet: WalletModule; chooser: ChooserModule }> {
  const files: Record<string, string> = { ...WALLET_HELPERS };
  if (opts.walletConnect) files[WALLET_PATHS.walletConnect] = FAKE_WALLETCONNECT;
  if (opts.realWalletConnect) {
    files[WALLET_PATHS.walletConnect] = WALLETCONNECT_MODULE;
    files["fake-ethereum-provider.ts"] = FAKE_ETHEREUM_PROVIDER;
  }
  files["<entry>"] = `export * as wallet from "./${WALLET_PATHS.wallet}"; export * as chooser from "./${WALLET_PATHS.chooser}";`;
  const key = opts.realWalletConnect ? "real-wc" : opts.walletConnect ? "wc" : "plain";
  if (!built.has(key)) {
    const input = path.join(dir, `files-${key}.json`);
    const bundle = path.join(dir, `bundle-${key}.mjs`);
    writeFileSync(input, JSON.stringify(files));
    const esbuild = createRequire(import.meta.url).resolve("esbuild");
    execFileSync(process.execPath, [path.join(dir, "build.mjs"), pathToFileURL(esbuild).href, input, bundle, path.join(process.cwd(), "publish-runtime")]);
    built.set(key, bundle);
  }
  // A fresh copy per test, so each one starts with no wallet state.
  const output = path.join(dir, `wallet-${n++}.mjs`);
  copyFileSync(built.get(key)!, output);
  return (await import(/* @vite-ignore */ pathToFileURL(output).href)) as { wallet: WalletModule; chooser: ChooserModule };
}

function fakeProvider(account: string, extra: Partial<Fake> = {}, chainId = SEPOLIA_HEX): Fake {
  return {
    request: vi.fn(async ({ method }: Request) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return chainId;
      return null;
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
    ...extra,
  };
}

function announce(provider: Fake, info: { rdns: string; name: string; icon?: string; uuid?: string }) {
  const detail = Object.freeze({ info: { uuid: info.uuid ?? info.rdns, icon: info.icon ?? "data:image/svg+xml,<svg/>", ...info }, provider });
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
}

/** Wallets answer every eip6963:requestProvider, like real extensions. */
function install(provider: Fake, info: { rdns: string; name: string; icon?: string }) {
  const answer = () => announce(provider, info);
  window.addEventListener("eip6963:requestProvider", answer);
  cleanups.push(() => window.removeEventListener("eip6963:requestProvider", answer));
  answer();
}

const cleanups: Array<() => void> = [];
const dialog = () => document.querySelector('[role="dialog"]');
const until = async (check: () => unknown, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const button = (text: string) => [...document.querySelectorAll<HTMLElement>("button, a")].find((b) => b.textContent?.includes(text));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  delete (window as { ethereum?: unknown }).ethereum;
  delete (window as { okxwallet?: unknown }).okxwallet;
  localStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130", configurable: true });
});
afterEach(() => cleanups.splice(0).forEach((f) => f()));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("EIP-6963 discovery", () => {
  it("lists every wallet that announces itself, including ones that load after the page", async () => {
    install(fakeProvider("0x1"), { rdns: "io.metamask", name: "MetaMask" });
    const { wallet } = await load();
    install(fakeProvider("0x2"), { rdns: "com.coinbase.wallet", name: "Coinbase Wallet" });
    expect(wallet.browserWallets().map((w) => [w.id, w.name])).toEqual([
      ["io.metamask", "MetaMask"],
      ["com.coinbase.wallet", "Coinbase Wallet"],
    ]);
  });

  it("keeps only data:image/ and https: icons, and ignores broken or reserved announcements", async () => {
    const { wallet } = await load();
    announce(fakeProvider("0x1"), { rdns: "a.good", name: "Good", icon: "data:image/png;base64,AAAA" });
    announce(fakeProvider("0x2"), { rdns: "a.evil", name: "Evil", icon: "javascript:alert(1)" });
    announce(fakeProvider("0x3"), { rdns: "walletconnect", name: "Fake WalletConnect" });
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { rdns: "no.provider", name: "x" } } }));
    expect(wallet.browserWallets().map((w) => [w.id, w.icon])).toEqual([
      ["a.good", "data:image/png;base64,AAAA"],
      ["a.evil", null],
    ]);
    expect(wallet.safeIcon("https://x.example/i.png")).toBe("https://x.example/i.png");
    expect(wallet.safeIcon("http://x.example/i.png")).toBeNull();
  });

  it("falls back to window.ethereum when it doesn't announce, without listing it twice when it does", async () => {
    const legacy = fakeProvider("0x1");
    (window as { ethereum?: unknown }).ethereum = legacy;
    const { wallet } = await load();
    expect(wallet.browserWallets().map((w) => w.name)).toEqual(["Browser wallet"]);
    announce(legacy, { rdns: "io.metamask", name: "MetaMask" });
    expect(wallet.browserWallets().map((w) => w.name)).toEqual(["MetaMask"]);
  });
});

describe("MiniPay", () => {
  it("is detected and connects without a wallet list, even with other wallets around", async () => {
    const minipay = fakeProvider("0x00000000000000000000000000000000000000aa", { isMiniPay: true });
    (window as { ethereum?: unknown }).ethereum = minipay;
    install(fakeProvider("0x2"), { rdns: "io.metamask", name: "MetaMask" });
    const { wallet } = await load({ walletConnect: true });
    expect(wallet.isMiniPay()).toBe(true);
    expect(wallet.walletOptions().map((w) => w.id)).toEqual(["minipay"]);
    expect(await wallet.connectWallet()).toBe("0x00000000000000000000000000000000000000aa");
    expect(dialog()).toBeNull();
    expect(minipay.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(wallet.walletState().wallet?.name).toBe("MiniPay");
  });

  it("connects on page load, so a MiniPay app never shows a connect step", async () => {
    (window as { ethereum?: unknown }).ethereum = fakeProvider("0x00000000000000000000000000000000000000aa", { isMiniPay: true });
    const { wallet } = await load();
    await wallet.restoreWallet();
    expect(wallet.walletState().account).toBe("0x00000000000000000000000000000000000000aa");
  });
});

describe("the wallet list", () => {
  it("opens when there's a choice, connects the picked wallet and closes", async () => {
    const metamask = fakeProvider("0x00000000000000000000000000000000000000a1");
    const rabby = fakeProvider("0x00000000000000000000000000000000000000b2");
    install(metamask, { rdns: "io.metamask", name: "MetaMask" });
    install(rabby, { rdns: "io.rabby", name: "Rabby" });
    const { wallet } = await load();
    const connecting = wallet.connectWallet();
    await until(dialog);
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement?.textContent).toContain("MetaMask"); // focus starts in the list
    button("Rabby")!.click();
    expect(await connecting).toBe("0x00000000000000000000000000000000000000b2");
    expect(metamask.request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    await until(() => !dialog());
    expect(wallet.walletState()).toMatchObject({ account: "0x00000000000000000000000000000000000000b2", wallet: { name: "Rabby" }, connecting: false });
    expect(wallet.walletProvider()).toBe(rabby);
    expect(JSON.parse(localStorage.getItem("goodbuild-wallet")!)).toEqual({ id: "io.rabby", kind: "injected" });
  });

  it("rejects with code 4001 when closed with Escape, and shows a wallet's error in the list", async () => {
    install(fakeProvider("0x1"), { rdns: "io.metamask", name: "MetaMask" });
    const refusing = fakeProvider("0x2");
    refusing.request.mockRejectedValue(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    install(refusing, { rdns: "io.rabby", name: "Rabby" });
    const { wallet } = await load();
    const first = wallet.connectWallet();
    await until(dialog);
    button("Rabby")!.click();
    await until(() => document.querySelector('[role="alert"]'));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("You cancelled the request in your wallet.");
    dialog()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(first).rejects.toMatchObject({ code: 4001 });
    await until(() => !dialog());
    expect(wallet.walletState()).toMatchObject({ account: null, connecting: false });
  });

  it("skips the list for a single browser wallet when WalletConnect is off (the preview)", async () => {
    install(fakeProvider("0x00000000000000000000000000000000000000a1"), { rdns: "io.metamask", name: "MetaMask" });
    const { wallet } = await load();
    expect(await wallet.connectWallet()).toBe("0x00000000000000000000000000000000000000a1");
    expect(dialog()).toBeNull();
  });

  it("asks MetaMask only for the Celo chains, and does not fall back when MetaMask rejects a Tron scope", async () => {
    const metamask = fakeProvider("0x00000000000000000000000000000000000000a1");
    install(metamask, { rdns: "io.metamask", name: "MetaMask" });
    const { wallet } = await load();
    await wallet.connectWallet();
    expect(metamask.request).toHaveBeenCalledWith({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {}, "endowment:permitted-chains": { caveats: [{ type: "restrictNetworkSwitching", value: [numberToHex(celo.id), numberToHex(celoSepolia.id)] }] } }],
    });
    expect(metamask.request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });

    await wallet.disconnectWallet();
    metamask.request.mockReset();
    metamask.request.mockRejectedValue(Object.assign(new Error('endowment:caip25 error: Received scopeString value(s): tron:728126428 for caveat of type "authorizedScopes" that are not supported by the wallet.'), { code: -32603 }));
    await expect(wallet.connectWallet()).rejects.toThrow(/authorizedScopes/);
    expect(metamask.request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("asks MetaMask again without Celo Sepolia when it isn't added, then adds it", async () => {
    const metamask = fakeProvider("0x00000000000000000000000000000000000000a1", {}, numberToHex(celo.id));
    const plain = metamask.request.getMockImplementation() as (args: { method: string; params?: unknown }) => Promise<unknown>;
    metamask.request.mockImplementation(async (args: { method: string; params?: unknown }) => {
      if (args.method === "wallet_requestPermissions") {
        const chains = (args.params as [{ "endowment:permitted-chains": { caveats: [{ value: string[] }] } }])[0]["endowment:permitted-chains"].caveats[0].value;
        if (chains.includes(numberToHex(celoSepolia.id))) {
          throw Object.assign(new Error('endowment:caip25 error: Received scopeString value(s): eip155:11142220 for caveat of type "authorizedScopes" that are not supported by the wallet.'), { code: -32603 });
        }
      }
      return plain(args);
    });
    install(metamask, { rdns: "io.metamask", name: "MetaMask" });
    const { wallet } = await load();
    expect(await wallet.connectWallet()).toBe("0x00000000000000000000000000000000000000a1");
    expect(metamask.request).toHaveBeenCalledWith({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {}, "endowment:permitted-chains": { caveats: [{ type: "restrictNetworkSwitching", value: [numberToHex(celo.id)] }] } }],
    });
    expect(metamask.request).not.toHaveBeenCalledWith({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    expect(metamask.request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(celoSepolia.id) }] });
  });

  it("says what to do when there's no wallet at all", async () => {
    const { wallet } = await load();
    await expect(wallet.connectWallet()).rejects.toThrow(/No wallet found/);
  });

  it("offers WalletConnect in a published app and shows its QR code on a computer", async () => {
    document.head.innerHTML = '<meta name="goodbuild-walletconnect" content="testproject">';
    install(fakeProvider("0x1"), { rdns: "io.metamask", name: "MetaMask" });
    const { wallet } = await load({ walletConnect: true });
    expect(wallet.walletOptions().map((w) => w.id)).toEqual(["io.metamask", "walletconnect"]);
    const connecting = wallet.connectWallet();
    await until(dialog);
    button("WalletConnect")!.click();
    await until(() => document.querySelector("[data-fake-qr]"));
    expect(document.querySelector("[data-fake-qr]")?.getAttribute("data-fake-qr")).toBe("wc:abc@2?relay-protocol=irn&symKey=xyz");
    expect(dialog()?.textContent).toContain("Scan with your phone");
    (window as unknown as { __approveWalletConnect: () => void }).__approveWalletConnect();
    expect(await connecting).toBe("0x00000000000000000000000000000000000000Wc");
    expect(wallet.walletState().wallet?.name).toBe("WalletConnect");
  });

  it("shows a button per phone wallet with the WalletConnect link on a phone", async () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Chrome/130", configurable: true });
    document.head.innerHTML = '<meta name="goodbuild-walletconnect" content="testproject">';
    const { wallet, chooser } = await load({ walletConnect: true });
    const connecting = wallet.connectWallet(); // WalletConnect is the only option, but it still needs the list
    await until(dialog);
    button("WalletConnect")!.click();
    const link = (text: string) => [...document.querySelectorAll("a")].find((a) => a.textContent?.includes(text));
    await until(() => link("Valora"));
    const encoded = encodeURIComponent("wc:abc@2?relay-protocol=irn&symKey=xyz");
    expect(link("MetaMask")?.getAttribute("href")).toBe("https://metamask.app.link/wc?uri=" + encoded);
    expect(link("Valora")?.getAttribute("href")).toBe("https://valoraapp.com/wc?uri=" + encoded);
    expect(link("Other wallet")?.getAttribute("href")).toBe("wc:abc@2?relay-protocol=irn&symKey=xyz");
    expect(chooser.PHONE_WALLETS.map((w) => w.name)).toEqual(["MetaMask", "Valora", "Trust Wallet", "Rainbow", "OKX Wallet"]);
    // OKX's row is for iOS only: on Android its link would be the same plain wc: link as "Other wallet".
    expect(link("OKX Wallet")).toBeUndefined();
    expect(document.querySelector("[data-fake-qr]")).toBeNull();
    (window as unknown as { __approveWalletConnect: () => void }).__approveWalletConnect();
    await connecting;
  });
});

describe("changing your mind about WalletConnect", () => {
  type FakeWc = { approvals: Array<() => void>; disconnects: number };
  const fakeWc = () => (window as unknown as { __wcProvider: FakeWc }).__wcProvider;
  const wcCalls = () => (window as unknown as { __wcCalls: string[] }).__wcCalls;
  const copyButton = () => [...document.querySelectorAll("button")].find((b) => b.classList.contains("gbw-copy"));

  beforeEach(() => {
    document.head.innerHTML = '<meta name="goodbuild-walletconnect" content="testproject">';
    // The stand-in sets this when its module is first imported, which is what these tests watch for.
    delete (window as unknown as { __wcCalls?: string[] }).__wcCalls;
  });

  it("closing the list without picking WalletConnect never touches its code", async () => {
    install(fakeProvider("0x1"), { rdns: "io.metamask", name: "MetaMask" });
    const { wallet } = await load({ walletConnect: true });
    const connecting = wallet.connectWallet();
    await until(dialog);
    dialog()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(connecting).rejects.toMatchObject({ code: 4001 });
    await new Promise((r) => setTimeout(r, 20));
    expect((window as unknown as { __wcCalls?: string[] }).__wcCalls).toBeUndefined();
  });

  it("Back stops the attempt in progress", async () => {
    const { wallet } = await load({ walletConnect: true });
    void wallet.connectWallet().catch(() => {});
    await until(dialog);
    button("WalletConnect")!.click();
    await until(() => document.querySelector("[data-fake-qr]"));
    button("Back")!.click();
    await until(() => wcCalls().includes("cancel"));
    button("Close")!.click();
    await until(() => !dialog());
  });

  it("a wallet that approves a link the visitor closed doesn't connect, and the session is dropped", async () => {
    const { wallet } = await load({ realWalletConnect: true });
    const connecting = wallet.connectWallet();
    await until(dialog);
    button("WalletConnect")!.click();
    await until(() => document.querySelector("[data-goodbuild-qr] svg"));
    button("Close")!.click();
    await expect(connecting).rejects.toMatchObject({ code: 4001 });
    await until(() => !dialog());
    fakeWc().approvals[0]();
    await until(() => fakeWc().disconnects === 1);
    expect(wallet.walletState()).toMatchObject({ account: null, wallet: null });
    expect(localStorage.getItem("goodbuild-wallet")).toBeNull();
  });

  it("after Back, picking again uses the new link only, and the copy button starts over", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { wallet } = await load({ realWalletConnect: true });
    const connecting = wallet.connectWallet();
    await until(dialog);
    button("WalletConnect")!.click();
    await until(() => copyButton());
    copyButton()!.click();
    await until(() => copyButton()?.textContent === "Link copied");
    expect(writeText).toHaveBeenLastCalledWith("wc:link1@2?relay-protocol=irn&symKey=xyz");
    button("Back")!.click();
    await until(() => button("WalletConnect"));
    await new Promise((r) => setTimeout(r, 20));
    button("WalletConnect")!.click();
    await until(() => copyButton());
    expect(copyButton()!.textContent).toBe("Copy link");
    copyButton()!.click();
    await until(() => copyButton()?.textContent === "Link copied");
    expect(writeText).toHaveBeenLastCalledWith("wc:link2@2?relay-protocol=irn&symKey=xyz");
    fakeWc().approvals[1]();
    expect(await connecting).toBe("0x00000000000000000000000000000000000000Wc");
    expect(wallet.walletState().wallet?.name).toBe("WalletConnect");
  });
});

describe("staying connected", () => {
  it("reconnects the last wallet silently with eth_accounts, and forgets it on disconnect", async () => {
    localStorage.setItem("goodbuild-wallet", JSON.stringify({ id: "io.rabby", kind: "injected" }));
    const rabby = fakeProvider("0x00000000000000000000000000000000000000b2");
    install(fakeProvider("0x1"), { rdns: "io.metamask", name: "MetaMask" });
    install(rabby, { rdns: "io.rabby", name: "Rabby" });
    const { wallet } = await load();
    await wallet.restoreWallet();
    expect(wallet.walletState().account).toBe("0x00000000000000000000000000000000000000b2");
    expect(rabby.request).toHaveBeenCalledWith({ method: "eth_accounts" });
    expect(rabby.request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    await wallet.disconnectWallet();
    expect(wallet.walletState().account).toBeNull();
    expect(localStorage.getItem("goodbuild-wallet")).toBeNull();
  });

  it("follows account changes in the wallet, and an empty list disconnects", async () => {
    const metamask = fakeProvider("0x00000000000000000000000000000000000000a1");
    install(metamask, { rdns: "io.metamask", name: "MetaMask" });
    const { wallet } = await load();
    await wallet.connectWallet();
    const handler = metamask.on.mock.calls.find((c) => c[0] === "accountsChanged")![1] as (a: string[]) => void;
    handler(["0x00000000000000000000000000000000000000a2"]);
    expect(wallet.walletState().account).toBe("0x00000000000000000000000000000000000000a2");
    handler([]);
    await until(() => wallet.walletState().account === null);
  });

  it("only asks the wallet to switch chains when it's on another one", async () => {
    const { wallet } = await load();
    const same = fakeProvider("0x1");
    await wallet.ensureChain(same);
    expect(same.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_switchEthereumChain" }));
    const other = fakeProvider("0x1", {}, "0xa4ec");
    await wallet.ensureChain(other);
    expect(other.request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_HEX }] });
  });
});

describe("OKX Wallet (D92)", () => {
  const OKX_ACCOUNT = "0x00000000000000000000000000000000000000c1";
  const META_ACCOUNT = "0x00000000000000000000000000000000000000a1";
  const setOkx = (p: Fake) => {
    (window as { okxwallet?: unknown }).okxwallet = p;
  };
  const setEthereum = (p: Fake) => {
    (window as { ethereum?: unknown }).ethereum = p;
  };

  it("is listed from window.okxwallet alone and connects at once, with a plain account request", async () => {
    const okx = fakeProvider(OKX_ACCOUNT);
    setOkx(okx);
    const { wallet } = await load();
    expect(wallet.browserWallets()).toEqual([{ id: "com.okex.wallet", name: "OKX Wallet", icon: null, kind: "injected" }]);
    expect(await wallet.connectWallet()).toBe(OKX_ACCOUNT);
    expect(dialog()).toBeNull();
    expect(okx.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    // MetaMask's Celo-only permission request is for MetaMask. OKX documents a plain eth_requestAccounts.
    expect(okx.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_requestPermissions" }));
    expect(wallet.walletState().wallet?.name).toBe("OKX Wallet");
    expect(wallet.walletProvider()).toBe(okx);
  });

  it("is listed once when it also announces: under its own id, or under another id with the same name", async () => {
    const okx = fakeProvider(OKX_ACCOUNT);
    setOkx(okx);
    const own = await load();
    announce(okx, { rdns: "com.okex.wallet", name: "OKX Wallet" });
    expect(own.wallet.browserWallets().map((w) => w.id)).toEqual(["com.okex.wallet"]);

    // A different object under a different id, in case the real rdns differs from the one we expect.
    const other = await load();
    announce(fakeProvider(OKX_ACCOUNT), { rdns: "com.okx.wallet", name: "OKX Wallet" });
    expect(other.wallet.browserWallets().map((w) => w.id)).toEqual(["com.okx.wallet"]);
  });

  it("doesn't list window.ethereum again as a 'Browser wallet' when that is OKX", async () => {
    const okx = fakeProvider(OKX_ACCOUNT);
    setOkx(okx);
    setEthereum(okx);
    const same = await load();
    expect(same.wallet.browserWallets().map((w) => w.name)).toEqual(["OKX Wallet"]);

    // OKX flagging a separate window.ethereum object as itself.
    setEthereum(fakeProvider("0x1", { isMetaMask: true, isOkxWallet: true }));
    const flagged = await load();
    expect(flagged.wallet.browserWallets().map((w) => w.name)).toEqual(["OKX Wallet"]);
  });

  it("still lists a different window.ethereum wallet beside OKX", async () => {
    setOkx(fakeProvider(OKX_ACCOUNT));
    setEthereum(fakeProvider(META_ACCOUNT, { isMetaMask: true }));
    const { wallet } = await load();
    expect(wallet.browserWallets().map((w) => w.name)).toEqual(["OKX Wallet", "MetaMask"]);
  });

  it("with MetaMask also installed, the visitor's pick decides which provider is asked", async () => {
    const okx = fakeProvider(OKX_ACCOUNT);
    const metamask = fakeProvider(META_ACCOUNT);
    setOkx(okx);
    install(metamask, { rdns: "io.metamask", name: "MetaMask" });
    const { wallet } = await load();
    expect(wallet.browserWallets().map((w) => w.name)).toEqual(["MetaMask", "OKX Wallet"]);
    const connecting = wallet.connectWallet();
    await until(dialog);
    button("OKX Wallet")!.click();
    expect(await connecting).toBe(OKX_ACCOUNT);
    expect(okx.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(metamask.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_requestAccounts" }));
    expect(metamask.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_requestPermissions" }));
  });

  it("reconnects silently on reload, without the wait a late-loading wallet gets, and forgets it on disconnect", async () => {
    localStorage.setItem("goodbuild-wallet", JSON.stringify({ id: "com.okex.wallet", kind: "injected" }));
    const okx = fakeProvider(OKX_ACCOUNT);
    setOkx(okx);
    const { wallet } = await load();
    const started = Date.now();
    await wallet.restoreWallet();
    expect(Date.now() - started).toBeLessThan(250); // waitForWallets(300) would take at least 300
    expect(wallet.walletState().account).toBe(OKX_ACCOUNT);
    expect(wallet.walletState().wallet?.name).toBe("OKX Wallet");
    expect(okx.request).toHaveBeenCalledWith({ method: "eth_accounts" });
    expect(okx.request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    await wallet.disconnectWallet();
    expect(localStorage.getItem("goodbuild-wallet")).toBeNull();
  });

  it("doesn't carry an old 'Browser wallet' choice over to OKX: the visitor connects once more", async () => {
    localStorage.setItem("goodbuild-wallet", JSON.stringify({ id: "injected", kind: "injected" }));
    const okx = fakeProvider(OKX_ACCOUNT);
    setOkx(okx);
    setEthereum(okx);
    const { wallet } = await load();
    await wallet.restoreWallet();
    expect(wallet.walletState().account).toBeNull();
    expect(okx.request).not.toHaveBeenCalledWith({ method: "eth_accounts" });
  });

  /** OKX's own chain list has no Celo: the switch fails with 4902, the chain is added, and adding doesn't switch (EIP-3085). */
  function okxWithoutCelo(switchesOnAdd: boolean) {
    const calls: Array<{ method: string; params?: unknown }> = [];
    let chain = "0x1";
    let added = false;
    const okx = fakeProvider(OKX_ACCOUNT);
    okx.request = vi.fn(async (args: Request) => {
      calls.push(args);
      const wanted = (args.params as Array<{ chainId?: string }> | undefined)?.[0]?.chainId;
      if (args.method === "eth_chainId") return chain;
      if (args.method === "wallet_switchEthereumChain") {
        if (!added) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
        chain = wanted!;
        return null;
      }
      if (args.method === "wallet_addEthereumChain") {
        added = true;
        if (switchesOnAdd) chain = wanted!;
        return null;
      }
      return null;
    });
    return { okx, calls, chainNow: () => chain };
  }

  it("adds Celo to OKX, then switches to it when adding didn't", async () => {
    const { okx, calls, chainNow } = okxWithoutCelo(false);
    const { wallet } = await load();
    await wallet.ensureChain(okx);
    expect(calls.map((c) => c.method)).toEqual(["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId", "wallet_switchEthereumChain"]);
    expect(calls[2].params).toEqual([expect.objectContaining({ chainId: SEPOLIA_HEX })]);
    expect(chainNow()).toBe(SEPOLIA_HEX);
  });

  it("doesn't switch a second time when the wallet moved to the chain it just added", async () => {
    const { okx, calls, chainNow } = okxWithoutCelo(true);
    const { wallet } = await load();
    await wallet.ensureChain(okx);
    expect(calls.map((c) => c.method)).toEqual(["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId"]);
    expect(chainNow()).toBe(SEPOLIA_HEX);
  });

  describe("on a phone, in the WalletConnect list", () => {
    const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
    const URI = "wc:abc@2?relay-protocol=irn&symKey=xyz";

    async function openPhoneList(userAgent: string) {
      Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });
      document.head.innerHTML = '<meta name="goodbuild-walletconnect" content="testproject">';
      const { wallet } = await load({ walletConnect: true });
      const connecting = wallet.connectWallet();
      await until(dialog);
      const listText = button("WalletConnect")!.textContent ?? "";
      button("WalletConnect")!.click();
      const link = (text: string) => [...document.querySelectorAll("a")].find((a) => a.textContent?.includes(text));
      await until(() => link("Valora"));
      return { listText, link, finish: async () => ((window as unknown as { __approveWalletConnect: () => void }).__approveWalletConnect(), await connecting) };
    }

    it.each([
      ["an iPhone", IPHONE],
      ["an iPad", IPAD],
    ])("%s gets an OKX Wallet row that opens the OKX app with the pairing link", async (_name, ua) => {
      const { listText, link, finish } = await openPhoneList(ua);
      expect(listText).toContain("MetaMask, Valora, OKX and other phone wallets");
      const okx = link("OKX Wallet");
      expect(okx?.getAttribute("href")).toBe("okex://main/wc?uri=" + encodeURIComponent(URI));
      expect(okx?.textContent).toContain("Needs the OKX app");
      // The plain link and the other wallets are still there.
      expect(link("Other wallet")?.getAttribute("href")).toBe(URI);
      expect(link("MetaMask")?.getAttribute("href")).toBe("https://metamask.app.link/wc?uri=" + encodeURIComponent(URI));
      await finish();
    });

    it("an Android phone has no OKX row of its own: its link would be the plain one, which is 'Other wallet'", async () => {
      const { listText, link, finish } = await openPhoneList(ANDROID);
      // No OKX row on Android, so the list doesn't promise one.
      expect(listText).toContain("MetaMask, Valora and other phone wallets");
      expect(listText).not.toContain("OKX");
      expect(link("OKX Wallet")).toBeUndefined();
      expect(link("Other wallet")?.getAttribute("href")).toBe(URI);
      await finish();
    });
  });
});

describe("OKX Wallet (D92), edge cases", () => {
  const ACCOUNT = "0x00000000000000000000000000000000000000c1";
  const setOkx = (p: Fake) => {
    (window as { okxwallet?: unknown }).okxwallet = p;
  };

  it("is listed once by id alone (a different object under its id) and by object alone (the same object under another id and name)", async () => {
    const okx = fakeProvider(ACCOUNT);
    setOkx(okx);
    const byId = await load();
    announce(fakeProvider(ACCOUNT), { rdns: "com.okex.wallet", name: "Something else" });
    expect(byId.wallet.browserWallets().map((w) => w.id)).toEqual(["com.okex.wallet"]);

    const byObject = await load();
    announce(okx, { rdns: "wallet.example", name: "Plain name" });
    expect(byObject.wallet.browserWallets().map((w) => w.id)).toEqual(["wallet.example"]);
  });

  it("gives an iPad that reports itself as a Mac (iPadOS 13 and later) the OKX row too", async () => {
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
    try {
      document.head.innerHTML = '<meta name="goodbuild-walletconnect" content="testproject">';
      const { wallet } = await load({ walletConnect: true });
      const connecting = wallet.connectWallet();
      await until(dialog);
      button("WalletConnect")!.click();
      const link = (text: string) => [...document.querySelectorAll("a")].find((a) => a.textContent?.includes(text));
      await until(() => link("Valora"));
      expect(link("OKX Wallet")?.getAttribute("href")).toBe("okex://main/wc?uri=" + encodeURIComponent("wc:abc@2?relay-protocol=irn&symKey=xyz"));
      (window as unknown as { __approveWalletConnect: () => void }).__approveWalletConnect();
      await connecting;
    } finally {
      delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
    }
  });

  it("throws the visitor's rejection of the switch that follows adding Celo, and carries on when the chain can't be read back", async () => {
    const { wallet } = await load();
    const rejecting = fakeProvider(ACCOUNT);
    rejecting.request = vi.fn(async ({ method }: Request) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "wallet_switchEthereumChain") {
        const switches = rejecting.request.mock.calls.filter((c) => (c[0] as Request).method === "wallet_switchEthereumChain").length;
        throw Object.assign(new Error(switches === 1 ? "Unrecognized chain ID" : "User rejected the request."), { code: switches === 1 ? 4902 : 4001 });
      }
      return null;
    });
    await expect(wallet.ensureChain(rejecting)).rejects.toMatchObject({ code: 4001 });

    const unreadable = fakeProvider(ACCOUNT);
    let reads = 0;
    unreadable.request = vi.fn(async ({ method }: Request) => {
      if (method === "eth_chainId") {
        if (++reads > 1) throw new Error("rpc down");
        return "0x1";
      }
      if (method === "wallet_switchEthereumChain") throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
      return null;
    });
    await expect(wallet.ensureChain(unreadable)).resolves.toBeUndefined();
    const switches = unreadable.request.mock.calls.filter((c) => (c[0] as Request).method === "wallet_switchEthereumChain");
    expect(switches).toHaveLength(1);
  });
});
