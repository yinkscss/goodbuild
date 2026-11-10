import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { sendTelegram } from "./ticket";

/**
 * Mail sent to the support address, shown in the owner's Telegram chat. Resend receives it and calls
 * the webhook with details only; the body is fetched with the API key, then posted through the same bot as tickets.
 */

type Env = Record<string, string | undefined>;
const TOLERANCE_S = 5 * 60;

/** Svix signature check (Resend signs webhooks with Svix): HMAC-SHA256 of "id.timestamp.body", key = base64 part of the secret. */
export function verifyWebhook(raw: string, h: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, nowMs = Date.now()): boolean {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${raw}`).digest();
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

const seen = new Set<string>();
/** Resend retries with the same id. Remembered in memory, so a restart can repeat one message at worst. */
export function firstTime(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 2000) seen.delete(seen.values().next().value as string);
  return true;
}
export const forget = (id: string) => void seen.delete(id);

interface Received {
  from?: string;
  to?: string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
  authentication?: { spf?: string | null; dkim?: string | null; dmarc?: string | null } | null;
  attachments?: Array<{ filename?: string }>;
}

const stripHtml = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n");

export function inboundText(mail: Received, id: string): string {
  const body = (mail.text?.trim() || (mail.html ? stripHtml(mail.html).trim() : "") || "(no text)").slice(0, 3200);
  const auth = mail.authentication;
  const check = auth ? `SPF ${auth.spf ?? "?"}, DKIM ${auth.dkim ?? "?"}, DMARC ${auth.dmarc ?? "?"}` : null;
  const files = mail.attachments?.length ? `Attachments: ${mail.attachments.map((a) => a.filename ?? "file").join(", ")} (open them in Resend)` : null;
  return [`Email to ${(mail.to ?? []).join(", ") || "support"}`, `From: ${mail.from ?? "unknown"}`, `Subject: ${mail.subject ?? "(none)"}`, check && `Checks: ${check}`, files, "", body, "", `Resend id: ${id}`].filter((l): l is string => typeof l === "string").join("\n");
}

/** Fetch one received email and post it to Telegram. Returns whether Telegram took it. */
export async function forwardReceived(emailId: string, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  if (!key) return false;
  let mail: Received;
  try {
    const res = await fetcher(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.error("received email fetch refused:", res.status);
      return false;
    }
    mail = (await res.json()) as Received;
  } catch {
    return false;
  }
  return sendTelegram(inboundText(mail, emailId), env, fetcher);
}
