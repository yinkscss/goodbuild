import "server-only";

import { SignJWT, jwtVerify } from "jose";

import { NONCE_TTL_SECONDS, SESSION_TTL_SECONDS, sessionSecret } from "./config";

const ISSUER = "goodbuild";

/**
 * The SIWE nonce is handed to the browser in the response body and also bound to a
 * short-lived signed httpOnly cookie. Verify compares the two and clears the cookie,
 * so each nonce works once and expires in 5 minutes, without a nonce table.
 */
export async function signNonceToken(nonce: string, now = Date.now()): Promise<string> {
  return new SignJWT({ nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience("siwe-nonce")
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + NONCE_TTL_SECONDS)
    .sign(sessionSecret());
}

export async function readNonceToken(token: string | undefined, now = Date.now()): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      issuer: ISSUER,
      audience: "siwe-nonce",
      currentDate: new Date(now),
    });
    return typeof payload.nonce === "string" ? payload.nonce : null;
  } catch {
    return null;
  }
}

export interface SessionClaims {
  /** Session row id. */
  sid: string;
  /** User id. */
  sub: string;
  wallet: string;
  chainId: number;
  iat: number;
  exp: number;
}

export async function signSessionToken(
  claims: Pick<SessionClaims, "sid" | "sub" | "wallet" | "chainId">,
  now = Date.now(),
): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({ sid: claims.sid, wallet: claims.wallet, chainId: claims.chainId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience("session")
    .setSubject(claims.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_SECONDS)
    .sign(sessionSecret());
}

export async function readSessionToken(token: string | undefined, now = Date.now()): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      issuer: ISSUER,
      audience: "session",
      currentDate: new Date(now),
    });
    if (
      typeof payload.sid !== "string" ||
      typeof payload.sub !== "string" ||
      typeof payload.wallet !== "string" ||
      typeof payload.chainId !== "number" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    return {
      sid: payload.sid,
      sub: payload.sub,
      wallet: payload.wallet,
      chainId: payload.chainId,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}
