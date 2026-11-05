import { describe, expect, it, vi } from "vitest";
import type { EIP1193Provider } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { recoverMessageAddress } from "viem";

import { celoChainFor, switchWalletChain, walletClientFor } from "./wallet-client";

const account = privateKeyToAccount(generatePrivateKey());

/** A fake EIP-1193 wallet that signs with a local key, like MetaMask or Magic would. */
function fakeProvider(extra: (method: string, params: unknown[]) => unknown = () => undefined) {
  const request = vi.fn(async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
    const custom = extra(method, params as unknown[]);
    if (custom !== undefined) return custom;
    if (method === "personal_sign") {
      const [data] = params as [`0x${string}`];
      return account.signMessage({ message: { raw: data } });
    }
    throw new Error(`unexpected ${method}`);
  });
  return { request } as unknown as EIP1193Provider & { request: typeof request };
}

describe("walletClientFor", () => {
  it("signs through any EIP-1193 provider and recovers to the account", async () => {
    const client = walletClientFor(fakeProvider(), account.address, 11142220);
    const signature = await client.signMessage({ account: account.address, message: "hello" });
    expect(await recoverMessageAddress({ message: "hello", signature })).toBe(account.address);
    expect(client.chain?.id).toBe(11142220);
  });

  it("defaults unknown chains to Celo Sepolia and honours mainnet", () => {
    expect(celoChainFor(null).id).toBe(11142220);
    expect(celoChainFor(42220).id).toBe(42220);
  });
});

describe("switchWalletChain", () => {
  it("adds the chain when the wallet doesn't know it (4902), then switches", async () => {
    let known = false;
    const provider = fakeProvider((method) => {
      if (method === "wallet_switchEthereumChain") {
        if (!known) throw Object.assign(new Error("unknown chain"), { code: 4902 });
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        known = true;
        return null;
      }
    });
    await switchWalletChain(walletClientFor(provider, account.address, 42220), 11142220);
    const methods = provider.request.mock.calls.map(([a]) => a.method);
    expect(methods).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);
  });

  it("rethrows a user rejection", async () => {
    const provider = fakeProvider((m) => {
      if (m === "wallet_switchEthereumChain") throw Object.assign(new Error("rejected"), { code: 4001 });
    });
    await expect(switchWalletChain(walletClientFor(provider, account.address, 42220), 11142220)).rejects.toThrow();
  });
});
