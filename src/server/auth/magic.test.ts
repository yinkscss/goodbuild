import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { attachmentFor } from "@/lib/auth/session-client";
import { AuthError } from "./errors";
import { assertMagicLogin } from "./magic";

const user = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const message = "Sign in to GoodBuild. nonce abc";
const attachment = attachmentFor(message);

/** A DID token the way Magic builds it: [proof, claim] where proof signs the claim. */
async function didToken(opts: { signer?: typeof user; issuer?: string; attachmentFor?: string; ext?: number } = {}) {
  const signer = opts.signer ?? user;
  const now = Math.floor(Date.now() / 1000);
  const claim = JSON.stringify({
    iat: now,
    ext: opts.ext ?? now + 900,
    iss: `did:ethr:${opts.issuer ?? signer.address}`,
    sub: "subject",
    aud: "client",
    nbf: now,
    tid: "t1",
    add: await signer.signMessage({ message: opts.attachmentFor ?? attachment }),
  });
  const proof = await signer.signMessage({ message: claim });
  return Buffer.from(JSON.stringify([proof, claim])).toString("base64");
}

beforeAll(() => {
  vi.stubEnv("MAGIC_SECRET_KEY", "sk_live_TESTSECRET");
});
afterEach(() => undefined);

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  return "ok";
};

describe("attachmentFor", () => {
  it("can't be mistaken for hex, which signers would sign as raw bytes", () => {
    expect(attachment).toMatch(/^siwe:[0-9a-f]{64}$/);
  });
});

describe("assertMagicLogin", () => {
  it("accepts a token bound to this message for the same address", async () => {
    expect(code(() => assertMagicLogin({ didToken: tokenSync, message, address: user.address }))).toBe("ok");
  });
});

let tokenSync = "";
beforeAll(async () => {
  tokenSync = await didToken();
});

describe("assertMagicLogin rejections", () => {
  it("rejects a missing token", () => {
    expect(code(() => assertMagicLogin({ didToken: undefined, message, address: user.address }))).toBe("magic_invalid");
  });
  it("rejects a token for another address than the SIWE one", () => {
    expect(code(() => assertMagicLogin({ didToken: tokenSync, message, address: other.address }))).toBe("magic_invalid");
  });
  it("rejects a token bound to a different message (replay)", () => {
    expect(code(() => assertMagicLogin({ didToken: tokenSync, message: message + "x", address: user.address }))).toBe("magic_invalid");
  });
  it("rejects an expired token", async () => {
    const expired = await didToken({ ext: Math.floor(Date.now() / 1000) - 10 });
    expect(code(() => assertMagicLogin({ didToken: expired, message, address: user.address }))).toBe("magic_invalid");
  });
  it("rejects a token whose issuer isn't its signer (forged)", async () => {
    const forged = await didToken({ signer: other, issuer: user.address });
    expect(code(() => assertMagicLogin({ didToken: forged, message, address: user.address }))).toBe("magic_invalid");
  });
  it("rejects garbage", () => {
    expect(code(() => assertMagicLogin({ didToken: "not-a-token-not-a-token", message, address: user.address }))).toBe("magic_invalid");
  });
});
