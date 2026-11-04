import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { sessions, users, type User } from "@/server/db/schema";
import { SESSION_ROTATE_AFTER_SECONDS, SESSION_TTL_SECONDS } from "./config";
import { AuthError } from "./errors";
import { readSessionToken, signSessionToken } from "./tokens";

export interface Attestation {
  /** "I'm 18 or older." */
  ageOk: boolean;
  /** "I'm not a US person" (GoodDollar ToS §8, D10). */
  notUsPerson: boolean;
}

export type WalletKind = "embedded" | "external";

/**
 * Find or create the user for a verified wallet. A user who hasn't attested yet
 * must send both attestations as true; after that they're remembered (D10).
 */
export async function signInUser(
  db: Db,
  input: { wallet: string; walletKind: WalletKind; attestation?: Attestation },
  now = new Date(),
): Promise<User> {
  const wallet = input.wallet.toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.wallet, wallet)).limit(1);
  const alreadyAttested = Boolean(existing?.ageOk && existing?.countryOk);
  const attestsNow = Boolean(input.attestation?.ageOk && input.attestation?.notUsPerson);
  if (!alreadyAttested && !attestsNow) throw new AuthError("attestation_required");

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        lastSeenAt: now,
        walletKind: input.walletKind,
        ...(alreadyAttested ? {} : { ageOk: true, countryOk: true, attestedAt: now }),
      })
      .where(eq(users.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(users)
    .values({ wallet, walletKind: input.walletKind, ageOk: true, countryOk: true, attestedAt: now, lastSeenAt: now })
    .onConflictDoUpdate({ target: users.wallet, set: { lastSeenAt: now } })
    .returning();
  return created;
}

export interface IssuedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export async function issueSession(
  db: Db,
  user: Pick<User, "id" | "wallet">,
  chainId: number,
  now = new Date(),
  rotatedFrom?: string,
): Promise<IssuedSession> {
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const [row] = await db
    .insert(sessions)
    .values({ userId: user.id, chainId, expiresAt, createdAt: now, rotatedFrom })
    .returning({ id: sessions.id });
  const token = await signSessionToken({ sid: row.id, sub: user.id, wallet: user.wallet, chainId }, now.getTime());
  return { token, sessionId: row.id, expiresAt };
}

export interface ResolvedSession {
  user: User;
  sessionId: string;
  chainId: number;
  /** Set when the cookie should be replaced (rotation). */
  rotated?: IssuedSession;
}

/**
 * Resolve a session cookie: valid signature, live (unrevoked, unexpired) DB row,
 * and an existing user. Rotates the session once it's a day old: the old row is
 * revoked and a fresh 7-day session is issued.
 */
export async function resolveSession(db: Db, token: string | undefined, now = new Date()): Promise<ResolvedSession | null> {
  const claims = await readSessionToken(token, now.getTime());
  if (!claims) return null;

  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, claims.sid), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row || row.user.id !== claims.sub) return null;

  const resolved: ResolvedSession = { user: row.user, sessionId: row.session.id, chainId: row.session.chainId };
  const ageSeconds = now.getTime() / 1000 - claims.iat;
  if (ageSeconds > SESSION_ROTATE_AFTER_SECONDS) {
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.session.id));
    resolved.rotated = await issueSession(db, row.user, row.session.chainId, now, row.session.id);
    resolved.sessionId = resolved.rotated.sessionId;
  }
  return resolved;
}

export async function revokeSession(db: Db, token: string | undefined, now = new Date()): Promise<void> {
  const claims = await readSessionToken(token, now.getTime());
  if (!claims) return;
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, claims.sid));
}

/** Shape returned to the browser. Never includes internal ids beyond what the UI needs. */
export function publicUser(user: User) {
  return {
    id: user.id,
    wallet: user.wallet,
    walletKind: user.walletKind as WalletKind,
    verified: Boolean(user.verifiedAt),
  };
}
export type PublicUser = ReturnType<typeof publicUser>;
