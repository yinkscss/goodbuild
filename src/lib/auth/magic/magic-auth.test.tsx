import * as React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { base } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "../context";
import * as sessionClient from "../session-client";
import type { AuthApi } from "../types";
import { MagicAuthProvider } from "./magic-auth";

vi.mock("../session-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session-client")>();
  return { ...actual, fetchSession: vi.fn(), signInWithEthereum: vi.fn(), endSession: vi.fn(async () => {}) };
});

/**
 * The sign-in wiring for OKX Wallet (D92): what magic-auth.tsx does with the wallet finders in ./injected.ts.
 * Magic itself is never loaded here: it is imported only for email sign-ins.
 */
const ACCOUNT = "0x00000000000000000000000000000000000000c1" as const;
const ATTESTATION = { ageOk: true, notUsPerson: true };
const SEPOLIA_HEX = "0xaa044c";
const user = { id: "u1", wallet: ACCOUNT, walletKind: "external" as const, verified: false };

let auth: AuthApi;
/** Hands the latest auth API to the test. It is copied in an effect, not during render. */
function Probe() {
  const api = useAuth();
  React.useEffect(() => {
    auth = api;
  });
  return null;
}

function provider(extra: Record<string, unknown> = {}) {
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return SEPOLIA_HEX;
      return null;
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
    ...extra,
  };
}

const win = window as unknown as { okxwallet?: unknown; ethereum?: unknown };
async function mount() {
  render(
    <MagicAuthProvider publishableKey="pk_test">
      <Probe />
    </MagicAuthProvider>,
  );
  await waitFor(() => expect(auth.ready).toBe(true));
}

beforeEach(() => {
  vi.mocked(sessionClient.fetchSession).mockResolvedValue(null);
  vi.mocked(sessionClient.signInWithEthereum).mockResolvedValue(user);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  delete win.okxwallet;
  delete win.ethereum;
  vi.clearAllMocks();
});

describe("OKX Wallet in sign-in (D92)", () => {
  it("shows it as detected when window.okxwallet exists, and not otherwise", async () => {
    win.okxwallet = provider();
    await mount();
    expect(auth.detected).toMatchObject({ okx: true, metamask: false, minipay: false });
    cleanup();
    delete win.okxwallet;
    await mount();
    expect(auth.detected.okx).toBe(false);
  });

  it("connects with a plain eth_requestAccounts, labels the wallet and remembers the choice", async () => {
    const okx = provider();
    win.okxwallet = okx;
    await mount();
    await act(async () => {
      await auth.connectWallet("okx", ATTESTATION);
    });
    expect(okx.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(okx.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_requestPermissions" }));
    expect(auth.wallet).toMatchObject({ address: ACCOUNT, label: "OKX Wallet", kind: "external", chainId: 11142220 });
    expect(auth.user).toEqual(user);
    expect(localStorage.getItem("gb:wallet")).toBe("okx");
    expect(sessionClient.signInWithEthereum).toHaveBeenCalledWith(expect.objectContaining({ address: ACCOUNT, walletKind: "external", attestation: ATTESTATION }));
  });

  it("says where to go when OKX isn't in this browser", async () => {
    await mount();
    await act(async () => {
      await auth.connectWallet("okx", ATTESTATION);
    });
    expect(auth.phase).toBe("error");
    expect(auth.error).toMatch(/OKX Wallet isn't installed.*OKX app.*WalletConnect/);
    expect(sessionClient.signInWithEthereum).not.toHaveBeenCalled();
  });

  it("reconnects the remembered wallet silently on reload, with the OKX label", async () => {
    const okx = provider();
    win.okxwallet = okx;
    localStorage.setItem("gb:wallet", "okx");
    vi.mocked(sessionClient.fetchSession).mockResolvedValue(user);
    await mount();
    await waitFor(() => expect(auth.wallet).toMatchObject({ address: ACCOUNT, label: "OKX Wallet" }));
    expect(okx.request).toHaveBeenCalledWith({ method: "eth_accounts" });
    expect(okx.request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("didn't change MetaMask: a remembered MetaMask still reconnects with its own label, and OKX is not mistaken for it", async () => {
    const metamask = provider({ isMetaMask: true });
    win.ethereum = metamask;
    localStorage.setItem("gb:wallet", "metamask");
    vi.mocked(sessionClient.fetchSession).mockResolvedValue(user);
    await mount();
    await waitFor(() => expect(auth.wallet).toMatchObject({ label: "MetaMask" }));

    cleanup();
    vi.mocked(sessionClient.fetchSession).mockResolvedValue(null);
    const okx = provider({ isMetaMask: true });
    win.ethereum = okx;
    win.okxwallet = okx;
    await mount();
    expect(auth.detected).toMatchObject({ okx: true, metamask: false });
  });
});

describe("signing the GoodCash top-up permit on Base (D120)", () => {
  const BASE_HEX = "0x2105";
  const SIG = `0x${"11".repeat(65)}`;
  const permit = {
    domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const },
    types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "value", type: "uint256" }] },
    primaryType: "ReceiveWithAuthorization" as const,
    message: { from: ACCOUNT, value: BigInt(1) },
  };

  /** A wallet on Celo Sepolia that can switch networks. `sign` decides what eth_signTypedData_v4 does. */
  function switching(sign: () => Promise<unknown>, switchable = true) {
    let chain = SEPOLIA_HEX;
    const calls: string[] = [];
    const p = provider();
    p.request = vi.fn(async ({ method, params }: { method: string; params?: Array<{ chainId?: string }> }) => {
      calls.push(method === "wallet_switchEthereumChain" ? `switch:${params?.[0]?.chainId}` : method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") {
        if (!switchable) throw Object.assign(new Error("Unsupported"), { code: 4200 });
        chain = params![0].chainId!;
        return null;
      }
      if (method === "eth_signTypedData_v4") return sign();
      return null;
    }) as typeof p.request;
    return { p, calls, chain: () => chain };
  }

  async function connected(p: ReturnType<typeof provider>) {
    win.okxwallet = p;
    await mount();
    await act(async () => {
      await auth.connectWallet("okx", ATTESTATION);
    });
  }

  it("moves the wallet to Base, signs, and moves it back to the chain it was on", async () => {
    const w = switching(async () => SIG);
    await connected(w.p);
    let sig: string | undefined;
    await act(async () => {
      sig = await auth.signTypedDataOn(base, permit);
    });
    expect(sig).toBe(SIG);
    const switches = w.calls.filter((c) => c.startsWith("switch:") || c === "eth_signTypedData_v4");
    expect(switches).toEqual([`switch:${BASE_HEX}`, "eth_signTypedData_v4", `switch:${SEPOLIA_HEX}`]);
    expect(w.chain()).toBe(SEPOLIA_HEX);
    expect(auth.wallet?.chainId).toBe(11142220);
  });

  it("moves it back even when the person refuses to sign", async () => {
    const w = switching(async () => {
      throw Object.assign(new Error("User rejected"), { code: 4001 });
    });
    await connected(w.p);
    await act(async () => {
      await expect(auth.signTypedDataOn(base, permit)).rejects.toThrow();
    });
    expect(w.chain()).toBe(SEPOLIA_HEX);
  });

  it("signs without switching when the wallet can't switch", async () => {
    const w = switching(async () => SIG, false);
    await connected(w.p);
    await act(async () => {
      await expect(auth.signTypedDataOn(base, permit)).resolves.toBe(SIG);
    });
    expect(w.calls).toContain("eth_signTypedData_v4");
    expect(w.chain()).toBe(SEPOLIA_HEX);
  });

  it("refuses an answer that isn't a signature", async () => {
    const w = switching(async () => "0x1234");
    await connected(w.p);
    await act(async () => {
      await expect(auth.signTypedDataOn(base, permit)).rejects.toThrow(/signature/);
    });
  });
});
