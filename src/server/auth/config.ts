import "server-only";

import { celo, celoSepolia } from "viem/chains";

/** Chains a SIWE message may name (AUTH.md Flow 4). Sign-in is gasless on either. */
export const SIGN_IN_CHAINS = [celoSepolia, celo] as const;
export const SIGN_IN_CHAIN_IDS: readonly number[] = SIGN_IN_CHAINS.map((c) => c.id);

export { NONCE_COOKIE, SESSION_COOKIE } from "@/lib/auth/cookie-names";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
/** Re-issue the session cookie once it's older than this (rotating sessions). */
export const SESSION_ROTATE_AFTER_SECONDS = 24 * 60 * 60;
export const NONCE_TTL_SECONDS = 5 * 60;
/** Reject SIWE messages issued too long ago or too far in the future (clock skew). */
export const MESSAGE_MAX_AGE_SECONDS = 10 * 60;
export const MESSAGE_MAX_SKEW_SECONDS = 60;

const DEV_SECRET = "goodbuild-dev-only-session-secret-change-me-0000000000";

/** HMAC key for session and nonce tokens. Required (32+ chars) outside development. */
export function sessionSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (raw && raw.length >= 32) return new TextEncoder().encode(raw);
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set to at least 32 characters in production.");
  }
  return new TextEncoder().encode(DEV_SECRET);
}

export function isProduction() {
  return process.env.NODE_ENV === "production";
}
