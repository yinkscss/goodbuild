import { keccak256, toHex } from "viem";
import { createSiweMessage } from "viem/siwe";

import type { Attestation, SessionUser, WalletKind } from "./types";

/** Chains a sign-in message may name. Sign-in costs nothing on either. */
export const SIGN_IN_CHAIN_IDS = [11142220, 42220];
export const DEFAULT_SIGN_IN_CHAIN_ID = 11142220;

export const SIGN_IN_STATEMENT = "Sign in to GoodBuild. This is free and does not send a transaction.";

/** Human-readable messages for the server's error codes. */
export const AUTH_ERROR_COPY: Record<string, string> = {
  attestation_required: "Please confirm you're 18 or older and not a US person.",
  region_blocked: "GoodBuild isn't available in your region.",
  signature_invalid: "That signature didn't match your wallet. Try again.",
  nonce_missing: "The sign-in request timed out. Try again.",
  nonce_mismatch: "The sign-in request timed out. Try again.",
  message_expired: "The sign-in request expired. Try again.",
  domain_mismatch: "This sign-in request was for a different site.",
  chain_unsupported: "Switch your wallet to Celo and try again.",
  user_rejected: "You cancelled the signature in your wallet.",
  magic_invalid: "We couldn't confirm your email login. Try again.",
  magic_unconfigured: "Email sign-in isn't set up on this deployment yet.",
};

export class SignInError extends Error {
  constructor(
    readonly code: string,
    message = AUTH_ERROR_COPY[code] ?? "Sign-in failed. Try again.",
  ) {
    super(message);
    this.name = "SignInError";
  }
}

type Fetch = typeof fetch;

/** Parse "eip155:11142220", "0xaa36a7" or 42220 into a number. */
export function parseChainId(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const value = raw.startsWith("eip155:") ? raw.slice(7) : raw;
  const n = value.startsWith("0x") ? parseInt(value, 16) : parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/** Sign-in names the wallet's chain when it's a Celo chain, otherwise Celo Sepolia. */
export function signInChainFor(walletChainId: number | null): number {
  return walletChainId !== null && SIGN_IN_CHAIN_IDS.includes(walletChainId) ? walletChainId : DEFAULT_SIGN_IN_CHAIN_ID;
}

/** Binds a Magic DID token to one SIWE message (the server recomputes this). */
export function attachmentFor(message: string): string {
  return keccak256(toHex(message));
}

export function isUserRejection(error: unknown): boolean {
  const e = error as { code?: number; message?: string } | null;
  return e?.code === 4001 || /reject|denied|cancel/i.test(e?.message ?? "");
}

export interface SignInArgs {
  address: `0x${string}`;
  walletChainId: number | null;
  walletKind: WalletKind;
  attestation: Attestation;
  /** Signs a plain-text message with the wallet and returns the hex signature. */
  sign: (message: string) => Promise<`0x${string}`>;
  /** Magic only (D22): mints a DID token carrying `attachment`, so it can't be replayed for another sign-in. */
  didToken?: (attachment: string) => Promise<string>;
  /** Defaults to window.location. */
  location?: { host: string; origin: string };
  fetchImpl?: Fetch;
  now?: Date;
}

/** Full SIWE round trip: nonce → EIP-4361 message → wallet signature → verify. */
export async function signInWithEthereum(args: SignInArgs): Promise<SessionUser> {
  const f = args.fetchImpl ?? fetch;
  const loc = args.location ?? window.location;
  const now = args.now ?? new Date();

  const nonceRes = await f("/api/auth/nonce", { cache: "no-store", credentials: "same-origin" });
  if (!nonceRes.ok) throw new SignInError(await errorCode(nonceRes));
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const message = createSiweMessage({
    address: args.address,
    chainId: signInChainFor(args.walletChainId),
    domain: loc.host,
    uri: loc.origin,
    version: "1",
    nonce,
    statement: SIGN_IN_STATEMENT,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 10 * 60_000),
  });

  let signature: `0x${string}`;
  let didToken: string | undefined;
  try {
    signature = await args.sign(message);
    // Email wallets also prove the Magic login: a DID token bound to this exact message.
    didToken = args.didToken ? await args.didToken(attachmentFor(message)) : undefined;
  } catch (error) {
    throw new SignInError(isUserRejection(error) ? "user_rejected" : "sign_failed");
  }

  const verifyRes = await f("/api/auth/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature, walletKind: args.walletKind, attestation: args.attestation, didToken }),
  });
  if (!verifyRes.ok) throw new SignInError(await errorCode(verifyRes));
  const { user } = (await verifyRes.json()) as { user: SessionUser };
  return user;
}

export async function fetchSession(fetchImpl: Fetch = fetch): Promise<SessionUser | null> {
  const res = await fetchImpl("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) return null;
  const body = (await res.json()) as { user: SessionUser | null };
  return body.user;
}

export async function endSession(fetchImpl: Fetch = fetch): Promise<void> {
  await fetchImpl("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
}

async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
  }
}
