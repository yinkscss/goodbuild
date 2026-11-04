import "server-only";

import { cookies, headers } from "next/headers";
import { NextResponse, connection } from "next/server";

import { getDb } from "@/server/db/client";
import { NONCE_COOKIE, SESSION_COOKIE, SESSION_TTL_SECONDS, NONCE_TTL_SECONDS, isProduction } from "./config";
import { AuthError } from "./errors";
import { resolveSession, type IssuedSession, type ResolvedSession } from "./service";

const baseCookie = () => ({ httpOnly: true, secure: isProduction(), sameSite: "lax" as const, path: "/" });

export async function setSessionCookie(session: IssuedSession) {
  (await cookies()).set(SESSION_COOKIE, session.token, { ...baseCookie(), maxAge: SESSION_TTL_SECONDS });
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", { ...baseCookie(), maxAge: 0 });
}

export async function setNonceCookie(token: string) {
  (await cookies()).set(NONCE_COOKIE, token, { ...baseCookie(), sameSite: "strict", maxAge: NONCE_TTL_SECONDS });
}

export async function takeNonceCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const value = jar.get(NONCE_COOKIE)?.value;
  jar.set(NONCE_COOKIE, "", { ...baseCookie(), sameSite: "strict", maxAge: 0 });
  return value;
}

/**
 * The domain SIWE messages must name. In production this comes only from APP_DOMAIN:
 * Host / X-Forwarded-Host can be forged on a direct request, which would let a
 * phishing site replay a signature it collected for its own domain.
 */
export async function requestDomain(): Promise<string> {
  const configured = process.env.APP_DOMAIN;
  if (configured) return configured;
  if (isProduction()) throw new Error("APP_DOMAIN must be set in production (e.g. goodbuild.app).");
  const h = await headers();
  return h.get("host") ?? "localhost:3000";
}

/** Current session or null. Writes a rotated cookie when the session was refreshed. */
export async function currentSession(): Promise<ResolvedSession | null> {
  // Sessions depend on the clock (expiry, rotation), so this always runs per request.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const resolved = await resolveSession(await getDb(), token);
  if (resolved?.rotated) {
    try {
      await setSessionCookie(resolved.rotated);
    } catch {
      // Server Components can't set cookies; the next route handler call rotates it.
    }
  }
  return resolved;
}

/** For route handlers: the session, or an AuthError("unauthenticated"). */
export async function requireSession(): Promise<ResolvedSession> {
  const session = await currentSession();
  if (!session) throw new AuthError("unauthenticated");
  return session;
}

/** Turn thrown errors into JSON responses with stable codes. */
export function errorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.code }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
