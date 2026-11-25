// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createTestDb } from "@/server/db/client";
import { providerStatus } from "@/server/db/provider-schema";
import { anyProviderPaused, lowBalanceLine, pauseProvider, probeAnthropic, providerOf, readDeepSeekBalance, resumeProvider, runProviderChecks } from "./provider-status";

const ENV = { DEEPSEEK_API_KEY: "sk-test", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_SUPPORT_CHAT_ID: "c" };

/** A fake fetch: DeepSeek's balance answers with `balance()`, Telegram messages are collected. */
function fakeFetch(balance: () => { is_available: boolean; amount: string; currency?: string } | null) {
  const telegrams: string[] = [];
  let balanceReads = 0;
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("api.telegram.org")) {
      telegrams.push(JSON.parse(String(init?.body)).text);
      return new Response("{}", { status: 200 });
    }
    if (u === "https://api.deepseek.com/user/balance") {
      balanceReads++;
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-test");
      const b = balance();
      if (!b) return new Response("nope", { status: 500 });
      return Response.json({ is_available: b.is_available, balance_infos: [{ currency: b.currency ?? "USD", total_balance: b.amount, granted_balance: "0.00", topped_up_balance: b.amount }] });
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
  return { fetcher, telegrams, reads: () => balanceReads };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const at = (min: number) => new Date(Date.UTC(2026, 10, 25, 12, min));

describe("provider pause and early warning (D177)", () => {
  it("names the provider from an out-of-funds message", () => {
    expect(providerOf("The AI provider account is out of funds (DeepSeek, 402): Insufficient Balance")).toBe("deepseek");
    expect(providerOf("The AI provider account is out of funds (Anthropic, 402): billing_error")).toBe("anthropic");
  });

  it("pauses once and alerts once, however many builds fail", async () => {
    const db = await createTestDb();
    const f = fakeFetch(() => null);
    expect(await pauseProvider(db, "deepseek", "Insufficient Balance", ENV, f.fetcher)).toBe(true);
    expect(await pauseProvider(db, "deepseek", "Insufficient Balance", ENV, f.fetcher)).toBe(false);
    await flush();
    expect(f.telegrams).toHaveLength(1);
    expect(f.telegrams[0]).toMatch(/new builds are paused/);
    expect(await anyProviderPaused(db)).toBe(true);
    expect(await resumeProvider(db, "deepseek", "owner", ENV, f.fetcher)).toBe(true);
    expect(await resumeProvider(db, "deepseek", "owner", ENV, f.fetcher)).toBe(false);
    expect(await anyProviderPaused(db)).toBe(false);
  });

  it("warns once when the balance drops below the line, and again only after a top-up", async () => {
    const db = await createTestDb();
    let amount = "4.20";
    const f = fakeFetch(() => ({ is_available: true, amount }));
    await runProviderChecks(db, ENV, f.fetcher, at(0));
    await flush();
    expect(f.telegrams).toEqual([expect.stringMatching(/DeepSeek balance is low: 4\.20 USD \(alert line 5 USD\)/)]);
    // Same interval: claimed already, so no second read.
    await runProviderChecks(db, ENV, f.fetcher, at(1));
    expect(f.reads()).toBe(1);
    // Still low 5 minutes later: no second alert.
    await runProviderChecks(db, ENV, f.fetcher, at(6));
    await flush();
    expect(f.telegrams).toHaveLength(1);
    // Topped up, then low again: alerts again.
    amount = "50.00";
    await runProviderChecks(db, ENV, f.fetcher, at(12));
    amount = "3.00";
    await runProviderChecks(db, ENV, f.fetcher, at(18));
    await flush();
    expect(f.telegrams).toHaveLength(2);
    const [row] = await db.select().from(providerStatus);
    expect(row.lastBalance).toBe("3");
    expect(row.balanceCurrency).toBe("USD");
    expect(await anyProviderPaused(db)).toBe(false);
    // DEEPSEEK_LOW_BALANCE moves the line.
    expect(lowBalanceLine("USD", { DEEPSEEK_LOW_BALANCE: "10" })).toBe(10);
    expect(lowBalanceLine("CNY", {})).toBe(35);
  });

  it("pauses before a build fails when DeepSeek says the balance can't pay, and resumes above the floor", async () => {
    const db = await createTestDb();
    let state = { is_available: false, amount: "0.00" };
    const f = fakeFetch(() => state);
    await runProviderChecks(db, ENV, f.fetcher, at(0));
    expect(await anyProviderPaused(db)).toBe(true);
    // Probed 3 minutes later: a few cents isn't enough to start everything again.
    state = { is_available: true, amount: "0.10" };
    expect((await runProviderChecks(db, ENV, f.fetcher, at(4))).resumed).toBe(false);
    state = { is_available: true, amount: "20.00" };
    expect((await runProviderChecks(db, ENV, f.fetcher, at(8))).resumed).toBe(true);
    expect(await anyProviderPaused(db)).toBe(false);
    await flush();
    expect(f.telegrams.some((t) => /builds are back on/.test(t))).toBe(true);
  });

  it("reads a yuan account with its own line", async () => {
    const f = fakeFetch(() => ({ is_available: true, amount: "30.00", currency: "CNY" }));
    expect(await readDeepSeekBalance(ENV, f.fetcher)).toEqual({ available: true, amount: 30, currency: "CNY" });
    const db = await createTestDb();
    await runProviderChecks(db, ENV, f.fetcher, at(0));
    await flush();
    expect(f.telegrams[0]).toMatch(/30\.00 CNY \(alert line 35 CNY\)/);
    expect(await readDeepSeekBalance({}, f.fetcher)).toBeNull();
  });

  it("falls back to a tiny DeepSeek call when the balance can't be read, so a pause still clears", async () => {
    const db = await createTestDb();
    let chatStatus = 402;
    const calls: string[] = [];
    const fetcher = (async (url: string | URL) => {
      calls.push(String(url));
      if (String(url).endsWith("/user/balance")) return new Response("gone", { status: 404 });
      if (String(url).endsWith("/chat/completions")) return new Response("{}", { status: chatStatus });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await pauseProvider(db, "deepseek", "Insufficient Balance", ENV, fetcher);
    expect((await runProviderChecks(db, ENV, fetcher, at(0))).resumed).toBe(false);
    expect(calls).toContain("https://api.deepseek.com/chat/completions");
    chatStatus = 200;
    expect((await runProviderChecks(db, ENV, fetcher, at(4))).resumed).toBe(true);
    expect(await anyProviderPaused(db)).toBe(false);
  });

  it("probes Anthropic with a tiny call", async () => {
    const answer = (status: number, body = "{}") => (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await probeAnthropic({ ANTHROPIC_API_KEY: "k" }, answer(200))).toBe(true);
    expect(await probeAnthropic({ ANTHROPIC_API_KEY: "k" }, answer(402, '{"error":{"type":"billing_error"}}'))).toBe(false);
    expect(await probeAnthropic({ ANTHROPIC_API_KEY: "k" }, answer(529))).toBeNull();
    expect(await probeAnthropic({}, answer(200))).toBeNull();
  });
});
