// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import { verifySignIn } from "./siwe";
import { AuthError } from "./errors";

const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const DOMAIN = "goodbuild.test";
const NONCE = "abcdef0123456789";
const NOW = new Date("2026-11-04T09:00:00Z");

function message(overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  return createSiweMessage({
    address: account.address,
    chainId: 11142220,
    domain: DOMAIN,
    nonce: NONCE,
    uri: `https://${DOMAIN}`,
    version: "1",
    issuedAt: new Date(NOW.getTime() - 5_000),
    expirationTime: new Date(NOW.getTime() + 10 * 60_000),
    statement: "Sign in to GoodBuild.",
    ...overrides,
  });
}

const noContract = async () => false;

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AuthError);
  await expect(p).rejects.toMatchObject({ code });
}

describe("verifySignIn", () => {
  it("accepts a valid EOA signature on Celo Sepolia", async () => {
    const msg = message();
    const signature = await account.signMessage({ message: msg });
    await expect(
      verifySignIn({ message: msg, signature, expectedNonce: NONCE, expectedDomain: DOMAIN, now: NOW, verifyContractSignature: noContract }),
    ).resolves.toEqual({ address: account.address, chainId: 11142220 });
  });

  it("accepts Celo mainnet too", async () => {
    const msg = message({ chainId: 42220 });
    const signature = await account.signMessage({ message: msg });
    const result = await verifySignIn({ message: msg, signature, expectedNonce: NONCE, expectedDomain: DOMAIN, now: NOW, verifyContractSignature: noContract });
    expect(result.chainId).toBe(42220);
  });

  it("rejects a missing nonce cookie", async () => {
    const msg = message();
    const signature = await account.signMessage({ message: msg });
    await expectCode(verifySignIn({ message: msg, signature, expectedNonce: null, expectedDomain: DOMAIN, now: NOW }), "nonce_missing");
  });

  it("rejects a replayed or foreign nonce", async () => {
    const msg = message();
    const signature = await account.signMessage({ message: msg });
    await expectCode(
      verifySignIn({ message: msg, signature, expectedNonce: "ffffffffffffffff", expectedDomain: DOMAIN, now: NOW }),
      "nonce_mismatch",
    );
  });

  it("rejects a message for another domain (phishing)", async () => {
    const msg = message({ domain: "evil.example", uri: "https://evil.example" });
    const signature = await account.signMessage({ message: msg });
    await expectCode(verifySignIn({ message: msg, signature, expectedNonce: NONCE, expectedDomain: DOMAIN, now: NOW }), "domain_mismatch");
  });

  it("rejects unsupported chains", async () => {
    const msg = message({ chainId: 1 });
    const signature = await account.signMessage({ message: msg });
    await expectCode(verifySignIn({ message: msg, signature, expectedNonce: NONCE, expectedDomain: DOMAIN, now: NOW }), "chain_unsupported");
  });

  it("rejects stale messages", async () => {
    const msg = message({ issuedAt: new Date(NOW.getTime() - 60 * 60_000), expirationTime: undefined });
    const signature = await account.signMessage({ message: msg });
    await expectCode(verifySignIn({ message: msg, signature, expectedNonce: NONCE, expectedDomain: DOMAIN, now: NOW }), "message_expired");
  });

  it("rejects expired messages", async () => {
    const msg = message({ expirationTime: new Date(NOW.getTime() - 1000) });
    const signature = await account.signMessage({ message: msg });
    await expectCode(verifySignIn({ message: msg, signature, expectedNonce: NONCE, expectedDomain: DOMAIN, now: NOW }), "message_expired");
  });

  it("rejects a signature from a different key", async () => {
    const msg = message();
    const signature = await other.signMessage({ message: msg });
    await expectCode(
      verifySignIn({ message: msg, signature, expectedNonce: NONCE, expectedDomain: DOMAIN, now: NOW, verifyContractSignature: noContract }),
      "signature_invalid",
    );
  });

  it("falls back to the contract-wallet check when the EOA check fails", async () => {
    const msg = message();
    const signature = await other.signMessage({ message: msg });
    const result = await verifySignIn({
      message: msg,
      signature,
      expectedNonce: NONCE,
      expectedDomain: DOMAIN,
      now: NOW,
      verifyContractSignature: async ({ address }) => address === account.address,
    });
    expect(result.address).toBe(account.address);
  });

  it("rejects garbage", async () => {
    await expectCode(
      verifySignIn({ message: "hello", signature: "0x00", expectedNonce: NONCE, expectedDomain: DOMAIN, now: NOW }),
      "message_invalid",
    );
  });
});
