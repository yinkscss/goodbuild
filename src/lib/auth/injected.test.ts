import { describe, expect, it } from "vitest";

import { detectInstalled, findMetaMask, findOkx, missingWalletMessage, OKX_RDNS, pickInjected, walletLabel, type Announced, type Injected, type WalletWindow } from "./injected";

const provider = (flags: Record<string, unknown> = {}, request: unknown = async () => null) => ({ request, ...flags }) as unknown as Injected;
const announce = (map: Map<string, Announced>, rdns: string, p: Injected) => map.set(rdns, { info: { rdns, name: rdns }, provider: p });

describe("finding OKX Wallet (D92)", () => {
  it("uses window.okxwallet, which OKX documents for its extension and its app's browser", () => {
    const okx = provider();
    expect(findOkx(new Map(), { okxwallet: okx })).toBe(okx);
  });

  it("prefers the EIP-6963 announcement over the global", () => {
    const announcedOkx = provider();
    const announced = new Map<string, Announced>();
    announce(announced, OKX_RDNS, announcedOkx);
    expect(findOkx(announced, { okxwallet: provider() })).toBe(announcedOkx);
  });

  it("finds nothing when OKX is absent, or when okxwallet is not a provider", () => {
    expect(findOkx(new Map(), {})).toBeUndefined();
    expect(findOkx(new Map(), undefined)).toBeUndefined();
    expect(findOkx(new Map(), { okxwallet: provider({}, null) })).toBeUndefined();
    expect(findOkx(new Map(), { okxwallet: {} as Injected })).toBeUndefined();
  });

  it("is not confused with another announced wallet", () => {
    const announced = new Map<string, Announced>();
    announce(announced, "io.metamask", provider({ isMetaMask: true }));
    expect(findOkx(announced, {})).toBeUndefined();
  });
});

describe("OKX is never taken for MetaMask", () => {
  it("skips window.ethereum when OKX has taken it over and sets isMetaMask", () => {
    const okx = provider({ isMetaMask: true });
    const win: WalletWindow = { ethereum: okx, okxwallet: okx };
    expect(findMetaMask(new Map(), win)).toBeUndefined();
  });

  it("skips it by the old compatibility flags too, even when okxwallet is missing", () => {
    expect(findMetaMask(new Map(), { ethereum: provider({ isMetaMask: true, isOkxWallet: true }) })).toBeUndefined();
    expect(findMetaMask(new Map(), { ethereum: provider({ isMetaMask: true, isOKExWallet: true }) })).toBeUndefined();
  });

  it("still finds a real un-announced MetaMask beside OKX, in window.ethereum.providers", () => {
    const metamask = provider({ isMetaMask: true });
    const okx = provider({ isMetaMask: true, isOkxWallet: true });
    expect(findMetaMask(new Map(), { ethereum: { ...okx, providers: [okx, metamask] } as Injected, okxwallet: okx })).toBe(metamask);
  });

  it("returns the announced MetaMask regardless of OKX", () => {
    const metamask = provider({ isMetaMask: true });
    const announced = new Map<string, Announced>();
    announce(announced, "io.metamask", metamask);
    announce(announced, OKX_RDNS, provider());
    expect(findMetaMask(announced, { okxwallet: provider() })).toBe(metamask);
  });

  it("each wallet's request goes to its own provider when both are installed", () => {
    const metamask = provider({ isMetaMask: true });
    const okx = provider();
    const announced = new Map<string, Announced>();
    announce(announced, "io.metamask", metamask);
    announce(announced, OKX_RDNS, okx);
    expect(pickInjected("metamask", announced, {})).toBe(metamask);
    expect(pickInjected("okx", announced, {})).toBe(okx);
    expect(pickInjected("walletconnect", announced, {})).toBeUndefined();
  });
});

describe("detecting, labelling and explaining", () => {
  it("reports OKX, MetaMask and MiniPay separately", () => {
    expect(detectInstalled(new Map(), { okxwallet: provider() })).toEqual({ metamask: false, okx: true, minipay: false });
    expect(detectInstalled(new Map(), { ethereum: provider({ isMiniPay: true }) })).toEqual({ metamask: false, okx: false, minipay: true });
  });

  it("names every external wallet", () => {
    expect(walletLabel("okx")).toBe("OKX Wallet");
    expect(walletLabel("metamask")).toBe("MetaMask");
    expect(walletLabel("minipay")).toBe("MiniPay");
    expect(walletLabel("walletconnect")).toBe("WalletConnect");
  });

  it("tells someone without OKX where to go next", () => {
    expect(missingWalletMessage("okx")).toMatch(/OKX Wallet isn't installed.*OKX app.*WalletConnect/);
    expect(missingWalletMessage("metamask")).toMatch(/MetaMask isn't installed/);
    expect(missingWalletMessage("minipay")).toMatch(/MiniPay isn't available/);
  });
});
