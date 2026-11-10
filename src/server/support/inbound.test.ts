// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { firstTime, forwardReceived, inboundText, verifyWebhook } from "./inbound";

const secret = "whsec_" + Buffer.from("test-secret-key-1234567890").toString("base64");
const sign = (id: string, ts: string, body: string) => "v1," + createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");

describe("inbound support mail", () => {
  const now = 1_700_000_000_000;
  const ts = String(now / 1000);
  const body = '{"type":"email.received","data":{"email_id":"e1"}}';

  it("accepts only a correct, fresh signature", () => {
    expect(verifyWebhook(body, { id: "m1", timestamp: ts, signature: sign("m1", ts, body) }, secret, now)).toBe(true);
    expect(verifyWebhook(body, { id: "m1", timestamp: ts, signature: "v1,AAAA " + sign("m1", ts, body) }, secret, now)).toBe(true);
    expect(verifyWebhook(body + " ", { id: "m1", timestamp: ts, signature: sign("m1", ts, body) }, secret, now)).toBe(false);
    expect(verifyWebhook(body, { id: "m2", timestamp: ts, signature: sign("m1", ts, body) }, secret, now)).toBe(false);
    expect(verifyWebhook(body, { id: "m1", timestamp: String(now / 1000 - 600), signature: sign("m1", String(now / 1000 - 600), body) }, secret, now)).toBe(false);
    expect(verifyWebhook(body, { id: null, timestamp: ts, signature: null }, secret, now)).toBe(false);
  });

  it("forwards a retried message once", () => {
    expect(firstTime("dup-1")).toBe(true);
    expect(firstTime("dup-1")).toBe(false);
  });

  it("fetches the body and posts plain text to Telegram", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return url.includes("receiving") ? new Response(JSON.stringify({ from: "a@b.co", to: ["support@goodbuildit.xyz"], subject: "Help", text: "My app is stuck", authentication: { spf: "pass", dkim: "pass", dmarc: "pass" } })) : new Response("{}");
    }) as unknown as typeof fetch;
    const env = { RESEND_API_KEY: "re_x", TELEGRAM_BOT_TOKEN: "1:a", TELEGRAM_SUPPORT_CHAT_ID: "9" };
    expect(await forwardReceived("e1", env, fetcher)).toBe(true);
    expect(calls[0].url).toContain("/emails/receiving/e1");
    const text = String(calls[1].body?.text);
    expect(text).toContain("From: a@b.co");
    expect(text).toContain("My app is stuck");
    expect(calls[1].body?.parse_mode).toBeUndefined();
  });

  it("falls back to the HTML body without markup", () => {
    expect(inboundText({ html: "<style>x{}</style><p>Hi <b>there</b></p>", from: "a@b.co" }, "e")).toContain("Hi there");
  });
});
