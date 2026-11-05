import "server-only";

import { Magic } from "@magic-sdk/admin";
import { isAddressEqual } from "viem";

import { attachmentFor } from "@/lib/auth/session-client";

import { AuthError } from "./errors";

/**
 * Magic DID token check for email sign-ins (D22). The SIWE signature already proves the
 * wallet; this proves the wallet was minted by a live Magic login on this app (the token
 * is signed with the user's Magic key and issued for our publishable key), and that it
 * belongs to the same address. The token's attachment is the hash of the SIWE message, so
 * a token can't be replayed for another sign-in.
 */
export type DidTokenValidator = (didToken: string, attachment: string) => { address: string };

let cached: Magic | null = null;

export function magicAdmin(): Magic {
  const secret = process.env.MAGIC_SECRET_KEY;
  if (!secret) throw new AuthError("magic_unconfigured", "MAGIC_SECRET_KEY is not set.");
  // The constructor is synchronous and makes no network call; `token.*` is fully offline.
  cached ??= new Magic(secret);
  return cached;
}

export const validateDidToken: DidTokenValidator = (didToken, attachment) => {
  const magic = magicAdmin();
  try {
    magic.token.validate(didToken, attachment);
    return { address: magic.token.getPublicAddress(didToken) };
  } catch (error) {
    console.warn("[auth] Magic DID token rejected:", (error as Error).message);
    throw new AuthError("magic_invalid");
  }
};

/** Throws unless `didToken` is valid, bound to `message`, and issued for `address`. */
export function assertMagicLogin(
  input: { didToken: string | undefined; message: string; address: string },
  validate: DidTokenValidator = validateDidToken,
): void {
  if (!input.didToken) throw new AuthError("magic_invalid");
  const { address } = validate(input.didToken, attachmentFor(input.message));
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !isAddressEqual(address as `0x${string}`, input.address as `0x${string}`)) {
    throw new AuthError("magic_invalid");
  }
}
