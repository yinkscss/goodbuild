import { numberToHex, type EIP1193Provider } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import { isCaip25ScopeError, isScopedPermissionUnsupported, requestMetaMaskAccount, unsupportedEvmChains, walletConnectMetadata } from "./metamask";

const CELO = [numberToHex(celo.id), numberToHex(celoSepolia.id)];
const TRON = Object.assign(
  new Error('Invalid approved permissions request: endowment:caip25 error: Received scopeString value(s): tron:728126428 for caveat of type "authorizedScopes" that are not supported by the wallet.'),
  { code: -32603 },
);

const scopeError = (scopes: string) =>
  Object.assign(
    new Error(`endowment:caip25 error: Received scopeString value(s): ${scopes} for caveat of type "authorizedScopes" that are not supported by the wallet.`),
    { code: -32603 },
  );
const NO_SEPOLIA = scopeError("eip155:11142220");

function permittedChains(request: ReturnType<typeof vi.fn>): string[][] {
  return request.mock.calls
    .filter((call) => call[0].method === "wallet_requestPermissions")
    .map((call) => call[0].params[0]["endowment:permitted-chains"].caveats[0].value);
}

function provider(impl: (method: string, params?: unknown) => unknown) {
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => impl(method, params));
  return { request, provider: { request } as unknown as EIP1193Provider };
}

describe("walletConnectMetadata", () => {
  it("names this site, not walletconnect.org", () => {
    expect(walletConnectMetadata("https://goodbuildit.xyz")).toEqual({
      name: "GoodBuild",
      description: "Build and deploy apps on Celo.",
      url: "https://goodbuildit.xyz",
      icons: ["https://goodbuildit.xyz/favicon.ico"],
    });
    expect(walletConnectMetadata("https://goodbuildit.xyz", "https://goodbuildit.xyz/icon.png").icons).toEqual(["https://goodbuildit.xyz/icon.png"]);
  });
});

describe("requestMetaMaskAccount", () => {
  it("asks only for the Celo chains, then reads the account already granted", async () => {
    const { request, provider: wallet } = provider((method) => (method === "eth_accounts" ? ["0x00000000000000000000000000000000000000a1"] : null));
    await expect(requestMetaMaskAccount(wallet)).resolves.toBe("0x00000000000000000000000000000000000000a1");
    expect(request).toHaveBeenCalledWith({
      method: "wallet_requestPermissions",
      params: [
        {
          eth_accounts: {},
          "endowment:permitted-chains": { caveats: [{ type: "restrictNetworkSwitching", value: CELO }] },
        },
      ],
    });
    expect(request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(CELO).toEqual(["0xa4ec", "0xaa044c"]);
  });

  it("uses eth_requestAccounts when the wallet has no scoped permissions", async () => {
    const { request, provider: wallet } = provider((method) => {
      if (method === "wallet_requestPermissions") throw Object.assign(new Error("Method not found"), { code: -32601 });
      if (method === "eth_requestAccounts") return ["0x00000000000000000000000000000000000000a1"];
      return null;
    });
    await expect(requestMetaMaskAccount(wallet)).resolves.toBe("0x00000000000000000000000000000000000000a1");
    expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("drops a stored permission and asks again when MetaMask rejects a Tron scope", async () => {
    let approvals = 0;
    const { request, provider: wallet } = provider((method) => {
      if (method === "wallet_requestPermissions") {
        approvals += 1;
        if (approvals === 1) throw TRON;
        return null;
      }
      if (method === "eth_accounts") return ["0x00000000000000000000000000000000000000a1"];
      return null;
    });
    await expect(requestMetaMaskAccount(wallet)).resolves.toBe("0x00000000000000000000000000000000000000a1");
    expect(request).toHaveBeenCalledWith({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    expect(request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(approvals).toBe(2);
    expect(isCaip25ScopeError(TRON)).toBe(true);
    expect(isScopedPermissionUnsupported(TRON)).toBe(false);
  });

  it("does not fall back to eth_requestAccounts when the second approval still includes Tron", async () => {
    const { request, provider: wallet } = provider((method) => {
      if (method === "wallet_revokePermissions") return null;
      throw TRON;
    });
    await expect(requestMetaMaskAccount(wallet)).rejects.toBe(TRON);
    expect(request.mock.calls.filter((call) => call[0].method === "wallet_requestPermissions")).toHaveLength(2);
    expect(request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("asks again without Celo Sepolia when the wallet hasn't added it, and keeps the permission", async () => {
    const { request, provider: wallet } = provider((method, params) => {
      if (method === "wallet_requestPermissions") {
        const chains = (params as [{ "endowment:permitted-chains": { caveats: [{ value: string[] }] } }])[0]["endowment:permitted-chains"].caveats[0].value;
        if (chains.includes("0xaa044c")) throw NO_SEPOLIA;
        return null;
      }
      if (method === "eth_accounts") return ["0x00000000000000000000000000000000000000a1"];
      return null;
    });
    await expect(requestMetaMaskAccount(wallet)).resolves.toBe("0x00000000000000000000000000000000000000a1");
    expect(permittedChains(request)).toEqual([CELO, ["0xa4ec"]]);
    expect(request).not.toHaveBeenCalledWith({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    expect(request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(unsupportedEvmChains(NO_SEPOLIA)).toEqual(["0xaa044c"]);
    expect(isScopedPermissionUnsupported(NO_SEPOLIA)).toBe(false);
  });

  it("falls back to Ethereum when the wallet has neither Celo network", async () => {
    const { request, provider: wallet } = provider((method, params) => {
      if (method === "wallet_requestPermissions") {
        const chains = (params as [{ "endowment:permitted-chains": { caveats: [{ value: string[] }] } }])[0]["endowment:permitted-chains"].caveats[0].value;
        if (chains.includes("0xa4ec")) throw scopeError("eip155:42220, eip155:11142220");
        return null;
      }
      if (method === "eth_accounts") return ["0x00000000000000000000000000000000000000a1"];
      return null;
    });
    await expect(requestMetaMaskAccount(wallet)).resolves.toBe("0x00000000000000000000000000000000000000a1");
    expect(permittedChains(request)).toEqual([CELO, ["0x1"]]);
  });

  it("handles a missing network and a stored Tron permission in turn", async () => {
    const errors = [NO_SEPOLIA, TRON];
    const { request, provider: wallet } = provider((method) => {
      if (method === "wallet_requestPermissions") {
        const next = errors.shift();
        if (next) throw next;
        return null;
      }
      if (method === "eth_accounts") return ["0x00000000000000000000000000000000000000a1"];
      return null;
    });
    await expect(requestMetaMaskAccount(wallet)).resolves.toBe("0x00000000000000000000000000000000000000a1");
    expect(permittedChains(request)).toEqual([CELO, ["0xa4ec"], ["0xa4ec"]]);
    expect(request).toHaveBeenCalledWith({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  });

  it("stops when the wallet keeps refusing the same network", async () => {
    const stubborn = scopeError("eip155:1");
    const { request, provider: wallet } = provider(() => {
      throw stubborn;
    });
    await expect(requestMetaMaskAccount(wallet)).rejects.toBe(stubborn);
    expect(permittedChains(request)).toEqual([CELO]);
  });

  it("lets a rejection through", async () => {
    const rejected = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const { provider: wallet } = provider(() => {
      throw rejected;
    });
    await expect(requestMetaMaskAccount(wallet)).rejects.toBe(rejected);
    expect(isScopedPermissionUnsupported(rejected)).toBe(false);
  });
});
