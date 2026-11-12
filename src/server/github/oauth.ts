import "server-only";

import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { SignJWT, jwtVerify } from "jose";

import { sessionSecret } from "@/server/auth/config";

export const GITHUB_STATE_COOKIE = "gb_gh_state";
const TTL_SECONDS = 10 * 60;

/** Only a path on this site, so the redirect after connecting can't be pointed elsewhere. */
export function safeReturnTo(value: string | null | undefined): string {
  const fallback = "/settings?tab=github";
  // Any control character (a tab or newline is dropped by URL parsing, which can turn "/<tab>/host" into "//host").
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const base = "https://return-to.invalid";
    return new URL(value, base).origin === base ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A redirect to a path on this site that doesn't name a host. `NextResponse.redirect` needs an absolute URL, and
 * building one from `request.url` gives the address the server is bound to (`0.0.0.0:3000`) when it runs on a
 * bind address or behind a port forward, which is no address a browser can open. A relative `Location` is
 * resolved by the browser against the address it actually used.
 */
export function redirectToPath(path: string, params: Record<string, string> = {}): NextResponse {
  const target = new URL(safeReturnTo(path), "https://same-site.invalid");
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return new NextResponse(null, { status: 302, headers: { Location: `${target.pathname}${target.search}${target.hash}` } });
}

/**
 * Where the person lands after the callback. When GitHub didn't confirm a revocation, the warning about it lives
 * in Settings, so that is where they go, whatever page they started from.
 */
export function callbackDestination(returnTo: string, manualRevoke: boolean): string {
  return manualRevoke ? "/settings?tab=github" : safeReturnTo(returnTo);
}

/**
 * The OAuth `state`: a random value in the URL, and the same value in a signed cookie that also names who
 * started it and where to go back to. The callback needs both to match, and the same signed-in person.
 */
export async function newState(userId: string, returnTo: string): Promise<{ state: string; cookie: string }> {
  const state = randomBytes(24).toString("base64url");
  const cookie = await new SignJWT({ state, uid: userId, to: safeReturnTo(returnTo) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("goodbuild")
    .setAudience("github-oauth")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    .sign(sessionSecret());
  return { state, cookie };
}

export async function checkState(cookie: string | undefined, state: string | null, userId: string): Promise<{ returnTo: string } | null> {
  if (!cookie || !state) return null;
  try {
    const { payload } = await jwtVerify(cookie, sessionSecret(), { issuer: "goodbuild", audience: "github-oauth" });
    if (payload.state !== state || payload.uid !== userId) return null;
    return { returnTo: safeReturnTo(typeof payload.to === "string" ? payload.to : null) };
  } catch {
    return null;
  }
}
