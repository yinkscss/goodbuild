import { beforeEach, describe, expect, it, vi } from "vitest";

import { ALERT_EVERY_MS, alertProviderFunds, resetProviderAlertForTests } from "./provider-alert";


describe("alertProviderFunds", () => {
  beforeEach(() => resetProviderAlertForTests());

  it("sends one Telegram alert, then stays quiet for the window", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const env = { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_SUPPORT_CHAT_ID: "c" };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(alertProviderFunds("DeepSeek 402", env, fetcher, 1_000)).toBe(true);
    expect(alertProviderFunds("DeepSeek 402", env, fetcher, 2_000)).toBe(false);
    expect(alertProviderFunds("DeepSeek 402", env, fetcher, 1_000 + ALERT_EVERY_MS)).toBe(true);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const body = JSON.parse((fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body as string);
    expect(body.text).toMatch(/out of funds/);
  });
});
