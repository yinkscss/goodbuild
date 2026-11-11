import "server-only";

import { randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { sessionSecret } from "@/server/auth/config";

export const GITHUB_STATE_COOKIE = "gb_gh_state";
const TTL_SECONDS = 10 * 60;

/** Only a path on this site, so the redirect after connecting can't be pointed elsewhere. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) return "/settings?tab=github";
  return value;
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
