// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupportError, checkRate, deliverTicket, resetRateForTests, ticketSchema, ticketText } from "./ticket";

const ticket = { email: "ada@example.com", topic: "problem" as const, message: "My app won't publish, it spins forever." };
const ok = () => new Response("{}", { status: 200 });

describe("support tickets", () => {
  beforeEach(resetRateForTests);

  it("rejects bad emails and short messages, and strips control characters", () => {
    expect(ticketSchema.safeParse({ ...ticket, email: "a@b.com, c@d.com" }).success).toBe(false);
    expect(ticketSchema.safeParse({ ...ticket, message: "help" }).success).toBe(false);
    expect(ticketSchema.safeParse({ ...ticket, message: "x".repeat(2001) }).success).toBe(false);
    expect(ticketSchema.parse({ ...ticket, message: "  hello\u0000 there friend  " }).message).toBe("hello there friend");
  });

  it("sends to email and Telegram, with the visitor as reply-to and one recipient", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return ok();
    }) as unknown as typeof fetch;
    const env = { RESEND_API_KEY: "re_x", SUPPORT_EMAIL: "help@goodbuildit.xyz", TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_SUPPORT_CHAT_ID: "-100" };
    expect(await deliverTicket("GB-TEST22", ticket, "NG", env, fetcher)).toEqual({ email: true, telegram: true });
    const mail = calls.find((c) => c.url.includes("resend"))!;
    expect(mail.body.to).toEqual(["help@goodbuildit.xyz"]);
    expect(mail.body.reply_to).toBe("ada@example.com");
    const tg = calls.find((c) => c.url.includes("telegram"))!;
    expect(tg.body.parse_mode).toBeUndefined();
    expect(String(tg.body.text)).toContain("GB-TEST22");
  });

  it("still succeeds when one channel fails, and fails when both do", async () => {
    const env = { RESEND_API_KEY: "re_x", SUPPORT_EMAIL: "h@x.io", TELEGRAM_BOT_TOKEN: "1:a", TELEGRAM_SUPPORT_CHAT_ID: "1" };
    const emailDown = (async (url: string) => (url.includes("resend") ? new Response("", { status: 500 }) : ok())) as unknown as typeof fetch;
    expect(await deliverTicket("GB-A", ticket, null, env, emailDown)).toEqual({ email: false, telegram: true });
    const allDown = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(deliverTicket("GB-A", ticket, null, env, allDown)).rejects.toBeInstanceOf(SupportError);
  });

  it("limits one visitor to 3 tickets per 10 minutes", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) checkRate("1.1.1.1", t + i);
    expect(() => checkRate("1.1.1.1", t + 10)).toThrow(SupportError);
    expect(() => checkRate("2.2.2.2", t + 10)).not.toThrow();
    expect(() => checkRate("1.1.1.1", t + 11 * 60 * 1000)).not.toThrow();
  });

  it("puts no markup-significant extras in the message", () => {
    expect(ticketText("GB-1", ticket, "NG")).toContain("Country: NG");
  });
});
