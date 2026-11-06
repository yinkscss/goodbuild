import "server-only";

import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import { and, count, eq, gt, isNull, lt, sql, sum } from "drizzle-orm";

import { isProduction, sessionSecret } from "@/server/auth/config";
import type { Db } from "@/server/db/client";
import { appDataEmailCodes, appDataEmailIdentities } from "@/server/db/app-data-schema";
import type { AppDataLimits } from "./limits";
import { AppDataError, EMAIL_PREFIX, type LiveApp } from "./store";

/**
 * Email sign-in for app visitors (D35). A 6-digit code, sent through Resend, signs the visitor in to
 * that one app. Every limit that spans more than a minute is counted here, in the database, so it
 * survives a restart and holds across the site.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MINUTES_10 = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const hmac = (value: string) => createHmac("sha256", Buffer.from(sessionSecret())).update(value).digest("hex");
const codeHash = (projectId: string, email: string, code: string) => hmac(`email-code:${projectId}:${email}:${code}`);
export const ipHash = (ip: string) => hmac(`email-ip:${ip}`);

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Sends one message. Tests pass their own. */
export type EmailSender = (message: EmailMessage) => Promise<void>;

/** Resend in production. Without a key, development prints the code to the server log and production refuses. */
export function emailSender(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): EmailSender | null {
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM || "GoodBuild <login@goodbuildit.xyz>";
  // Local end-to-end runs of a production build only: never honoured unless the site itself is on localhost.
  const localLog = env.EMAIL_LOG_CODES_LOCALHOST_ONLY === "1" && /^localhost(:\d+)?$/.test(env.APP_DOMAIN ?? "");
  if (!key) {
    if (isProduction() && !localLog) return null;
    return async (message) => {
      console.info(`[email, development only] to ${message.to}: ${message.subject}`);
    };
  }
  return async (message) => {
    let res: Response;
    try {
      res = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        // Exactly one recipient, as an array, so nothing in an address can add another.
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppDataError("email_failed", 502, "The email couldn't be sent just now. Try again in a minute.");
    }
    if (!res.ok) {
      console.error("email provider refused a message:", res.status);
      throw new AppDataError("email_failed", 502, "The email couldn't be sent just now. Try again in a minute.");
    }
  };
}

/** The message: the app's address and the code, and nothing the app itself wrote. */
export function codeMessage(to: string, code: string, appHost: string): EmailMessage {
  return {
    to,
    subject: `Your sign-in code: ${code}`,
    text: [
      `Your code to sign in to ${appHost} is ${code}.`,
      "",
      "It expires in 10 minutes and works once.",
      `Never share this code. Only enter it on ${appHost}.`,
      "",
      "If you didn't ask for it, ignore this email. Nobody can sign in without the code.",
      "",
      "Sent by GoodBuild for an app built on it.",
    ].join("\n"),
  };
}

async function countSince(db: Db, where: ReturnType<typeof and>, since: Date): Promise<number> {
  const [row] = await db.select({ n: count() }).from(appDataEmailCodes).where(and(where, gt(appDataEmailCodes.createdAt, since)));
  return Number(row?.n ?? 0);
}

function capped(message: string): never {
  throw new AppDataError("email_limit", 429, message);
}

/** Make and send a code. Checks every cap first, and tells the visitor plainly when one is reached. */
export async function requestEmailCode(
  db: Db,
  app: LiveApp,
  input: { email: string; ip: string; appHost: string },
  limits: AppDataLimits,
  send: EmailSender | null,
  now = new Date(),
): Promise<{ expiresAt: Date }> {
  if (!app.emailSignIn) throw new AppDataError("email_not_enabled", 404, "This app doesn't offer email sign-in.");
  if (!send) throw new AppDataError("email_unavailable", 503, "Email sign-in isn't set up on this server yet.");
  const ip = ipHash(input.ip);
  const t = now.getTime();
  // Expired codes aren't kept.
  await db.delete(appDataEmailCodes).where(lt(appDataEmailCodes.createdAt, new Date(t - DAY)));

  const mine = and(eq(appDataEmailCodes.projectId, app.projectId), eq(appDataEmailCodes.email, input.email));
  if ((await countSince(db, mine, new Date(t - MINUTES_10))) >= limits.emailCodesPerEmailPer10Minutes) capped("A few codes were sent to this address already. Check your inbox, or try again in 10 minutes.");
  if ((await countSince(db, mine, new Date(t - DAY))) >= limits.emailCodesPerEmailPerDay) capped("Too many codes were sent to this address today. Try again tomorrow.");
  if ((await countSince(db, eq(appDataEmailCodes.ipHash, ip), new Date(t - DAY))) >= limits.emailCodesPerIpPerDay) capped("Too many codes were asked for from this connection today. Try again tomorrow.");
  if ((await countSince(db, eq(appDataEmailCodes.projectId, app.projectId), new Date(t - DAY))) >= limits.emailCodesPerProjectPerDay) {
    throw new AppDataError("email_app_cap", 503, "This app has sent all the sign-in emails it can today. Try again tomorrow, or connect a wallet instead.");
  }
  const [site] = await db.select({ n: count() }).from(appDataEmailCodes).where(gt(appDataEmailCodes.createdAt, new Date(t - DAY)));
  if (Number(site?.n ?? 0) >= limits.emailCodesSitePerDay) {
    throw new AppDataError("email_site_cap", 503, "Email sign-in is busy today. Try again tomorrow, or connect a wallet instead.");
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(t + CODE_TTL_MS);
  const [row] = await db
    .insert(appDataEmailCodes)
    .values({ projectId: app.projectId, email: input.email, codeHash: codeHash(app.projectId, input.email, code), ipHash: ip, expiresAt, createdAt: now })
    .returning({ id: appDataEmailCodes.id });
  try {
    await send(codeMessage(input.email, code, input.appHost));
  } catch (error) {
    // A code that never arrived shouldn't count against anyone.
    await db.delete(appDataEmailCodes).where(eq(appDataEmailCodes.id, row.id));
    throw error;
  }
  return { expiresAt };
}

/**
 * Check a code and return the visitor's id in this app, or throw. Each guess is counted in the same
 * statement that reads the code, so parallel guesses can't share one attempt.
 */
export async function verifyEmailCode(db: Db, app: LiveApp, input: { email: string; code: string }, limits: AppDataLimits, now = new Date()): Promise<string> {
  if (!app.emailSignIn) throw new AppDataError("email_not_enabled", 404, "This app doesn't offer email sign-in.");
  const wrong = () => new AppDataError("code_invalid", 401, "That code isn't right, or it has expired. Check the latest email, or ask for a new code.");
  const t = now.getTime();
  const mine = and(eq(appDataEmailCodes.projectId, app.projectId), eq(appDataEmailCodes.email, input.email));
  const [failures] = await db.select({ n: sum(appDataEmailCodes.attempts) }).from(appDataEmailCodes).where(and(mine, gt(appDataEmailCodes.createdAt, new Date(t - DAY))));
  if (Number(failures?.n ?? 0) >= limits.emailFailuresPerEmailPerDay) throw new AppDataError("email_locked", 429, "Too many wrong codes for this address today. Try again tomorrow.");
  if (!/^[0-9]{6}$/.test(input.code)) throw wrong();

  // The newest unused, unexpired code with attempts left, counted as tried in the same statement.
  const tried = await db.execute<{ id: string; code_hash: string }>(sql`
    update ${appDataEmailCodes} set attempts = attempts + 1
    where id = (
      select id from ${appDataEmailCodes}
      where project_id = ${app.projectId} and email = ${input.email} and used_at is null
        and expires_at > ${now.toISOString()}::timestamptz and attempts < ${MAX_ATTEMPTS}
      order by created_at desc limit 1
      for update
    )
    returning id, code_hash`);
  const rows = (tried as unknown as { rows?: { id: string; code_hash: string }[] }).rows ?? (tried as unknown as { id: string; code_hash: string }[]);
  const found = rows[0];
  if (!found) throw wrong();
  const expected = Buffer.from(found.code_hash, "hex");
  const given = Buffer.from(codeHash(app.projectId, input.email, input.code), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw wrong();

  // Spend it, once: only the first of two parallel right answers gets a session.
  const spent = await db
    .update(appDataEmailCodes)
    .set({ usedAt: now, attempts: sql`${appDataEmailCodes.attempts} - 1` })
    .where(and(eq(appDataEmailCodes.id, found.id), isNull(appDataEmailCodes.usedAt)))
    .returning({ id: appDataEmailCodes.id });
  if (!spent.length) throw wrong();
  return emailSubject(db, app.projectId, input.email);
}

/** The visitor's id in this app: made once, then always the same. */
export async function emailSubject(db: Db, projectId: string, email: string): Promise<string> {
  await db.insert(appDataEmailIdentities).values({ projectId, email, subject: `${EMAIL_PREFIX}${randomUUID()}` }).onConflictDoNothing();
  const [row] = await db.select({ subject: appDataEmailIdentities.subject }).from(appDataEmailIdentities).where(and(eq(appDataEmailIdentities.projectId, projectId), eq(appDataEmailIdentities.email, email)));
  return row.subject;
}
