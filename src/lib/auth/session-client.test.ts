import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";

import { SignInError, parseChainId, signInChainFor, signInWithEthereum } from "./session-client";

const account = privateKeyToAccount(generatePrivateKey());
const loc = { host: "goodbuild.test", origin: "https://goodbuild.test" };
const yes = { ageOk: true, notUsPerson: true };

function fakeFetch(verify: (body: Record<string, unknown>) => Response) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/nonce") return Response.json({ nonce: "n0nce0123456789a" });
    if (url === "/api/auth/verify") return verify(JSON.parse(String(init?.body)));
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
}

describe("signInWithEthereum", () => {
  it("builds an EIP-4361 message for this site, signs it and posts it", async () => {
    let posted: Record<string, unknown> = {};
    const f = fakeFetch((body) => {
      posted = body;
      return Response.json({ user: { id: "u1", wallet: account.address.toLowerCase(), walletKind: "external", verified: false } });
    });
    const user = await signInWithEthereum({
      address: account.address,
      walletChainId: 1,
      walletKind: "external",
      attestation: yes,
      sign: (message) => account.signMessage({ message }),
      location: loc,
      fetchImpl: f,
    });
    expect(user.id).toBe("u1");
    const parsed = parseSiweMessage(String(posted.message));
    expect(parsed).toMatchObject({ domain: "goodbuild.test", nonce: "n0nce0123456789a", chainId: 42220 });
    expect(posted.attestation).toEqual(yes);
    expect(posted.walletKind).toBe("external");
  });

  it("maps a wallet rejection to a friendly error", async () => {
    const f = fakeFetch(() => Response.json({}));
    const p = signInWithEthereum({
      address: account.address,
      walletChainId: 11142220,
      walletKind: "external",
      attestation: yes,
      sign: async () => {
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      },
      location: loc,
      fetchImpl: f,
    });
    await expect(p).rejects.toBeInstanceOf(SignInError);
    await expect(p).rejects.toMatchObject({ code: "user_rejected" });
  });

  it("surfaces server error codes", async () => {
    const f = fakeFetch(() => Response.json({ error: "attestation_required" }, { status: 403 }));
    await expect(
      signInWithEthereum({
        address: account.address,
        walletChainId: null,
        walletKind: "embedded",
        attestation: { ageOk: false, notUsPerson: false },
        sign: (message) => account.signMessage({ message }),
        location: loc,
        fetchImpl: f,
      }),
    ).rejects.toMatchObject({ code: "attestation_required", message: expect.stringContaining("18") });
  });
});

describe("chain helpers", () => {
  it("parses CAIP-2, hex and numbers", () => {
    expect(parseChainId("eip155:11142220")).toBe(11142220);
    expect(parseChainId("0xa4ec")).toBe(42220);
    expect(parseChainId(42220)).toBe(42220);
    expect(parseChainId(null)).toBeNull();
  });
  it("signs in on the wallet's Celo chain, else Celo mainnet", () => {
    expect(signInChainFor(42220)).toBe(42220);
    expect(signInChainFor(11142220)).toBe(11142220);
    expect(signInChainFor(1)).toBe(42220);
    expect(signInChainFor(null)).toBe(42220);
  });
});
