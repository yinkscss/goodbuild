import "server-only";

import { randomInt } from "node:crypto";

import { z } from "zod";

import { MAX_MESSAGE_LENGTH as MAX_MESSAGE, TOPIC_OPTIONS, type Topic } from "@/components/support/topics";
import { isProduction } from "@/server/auth/config";

/**
 * Support tickets. One form, delivered to the owner by email (Resend) and Telegram (a bot). A ticket
 * counts as sent when at least one of the two accepted it, so one provider being down never loses it.
 */

const TOPICS = TOPIC_OPTIONS.map((t) => t.value) as [Topic, ...Topic[]];
const TOPIC_LABELS = Object.fromEntries(TOPIC_OPTIONS.map((t) => [t.value, t.label])) as Record<Topic, string>;

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();

export const ticketSchema = z.object({
  email: z.string().transform(clean).pipe(z.string().max(254).regex(/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/, "Enter an email address we can reply to.")),
  topic: z.enum(TOPICS),
  message: z.string().transform(clean).pipe(z.string().min(10, "Tell us a little more, at least a sentence.").max(MAX_MESSAGE, `Keep it under ${MAX_MESSAGE} characters.`)),
  /** Hidden field. People leave it empty; most bots fill it. */
  website: z.string().max(200).optional(),
});
export type TicketInput = z.infer<typeof ticketSchema>;

export class SupportError extends Error {
  constructor(
    readonly code: "invalid" | "rate_limited" | "not_set_up" | "failed",
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Env = Record<string, string | undefined>;

export function supportEmail(env: Env = process.env): string | null {
  return env.SUPPORT_EMAIL || env.NEXT_PUBLIC_CONTACT_EMAIL || null;
}

/** True when at least one place can receive a ticket. The page shows plain contact links instead of a form when not. */
export function supportConfigured(env: Env = process.env): boolean {
  return Boolean((env.RESEND_API_KEY && supportEmail(env)) || (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_SUPPORT_CHAT_ID));
}

export function newTicketId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "GB-" + Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export function ticketText(id: string, t: Pick<TicketInput, "email" | "topic" | "message">, country: string | null): string {
  return [`New support ticket ${id}`, `Topic: ${TOPIC_LABELS[t.topic]}`, `Reply to: ${t.email}`, country ? `Country: ${country}` : null, "", t.message].filter((l) => l !== null).join("\n");
}

async function sendEmail(id: string, t: TicketInput, text: string, env: Env, fetcher: typeof fetch): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  const to = supportEmail(env);
  if (!key || !to) return false;
  try {
    const res = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM || "GoodBuild <login@goodbuildit.xyz>",
        to: [to],
        reply_to: t.email,
        subject: `[${id}] ${TOPIC_LABELS[t.topic]}`,
        text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error("support email refused:", res.status);
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendTelegram(text: string, env: Env, fetcher: typeof fetch): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chat = env.TELEGRAM_SUPPORT_CHAT_ID;
  if (!token || !chat) return false;
  try {
    // No parse_mode: the message is plain text, so nothing a visitor writes can be read as markup.
    const res = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error("support telegram refused:", res.status);
    return res.ok;
  } catch {
    return false;
  }
}

export interface Delivery {
  email: boolean;
  telegram: boolean;
}

/** Sends one ticket. Throws SupportError when neither channel is set up or both fail. */
export async function deliverTicket(id: string, t: TicketInput, country: string | null, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<Delivery> {
  const text = ticketText(id, t, country);
  if (!supportConfigured(env)) {
    if (isProduction()) throw new SupportError("not_set_up", 503, "Support tickets aren't switched on yet. Please message us on Telegram instead.");
    console.info(`[support, development only]\n${text}`);
    return { email: false, telegram: false };
  }
  const [email, telegram] = await Promise.all([sendEmail(id, t, text, env, fetcher), sendTelegram(text, env, fetcher)]);
  if (!email && !telegram) throw new SupportError("failed", 502, "We couldn't send your ticket just now. Please try again in a minute, or message us on Telegram.");
  return { email, telegram };
}

/** In-memory limits: enough to stop one visitor flooding the owner's inbox. A restart resets them. */
const PER_IP = { count: 3, windowMs: 10 * 60 * 1000 };
const PER_SITE_DAY = 200;
const hits = new Map<string, number[]>();
let site: number[] = [];

export function checkRate(ip: string, now = Date.now()): void {
  site = site.filter((at) => now - at < 24 * 60 * 60 * 1000);
  const mine = (hits.get(ip) ?? []).filter((at) => now - at < PER_IP.windowMs);
  if (mine.length >= PER_IP.count || site.length >= PER_SITE_DAY) {
    throw new SupportError("rate_limited", 429, "You've sent a few tickets already. Please wait a few minutes before sending another.");
  }
  mine.push(now);
  site.push(now);
  hits.set(ip, mine);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((at) => now - at >= PER_IP.windowMs)) hits.delete(k);
}

export function resetRateForTests() {
  hits.clear();
  site = [];
}
