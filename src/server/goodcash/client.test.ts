import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GoodCashError, getTopUp, goodCashConfig, isTestKey, topUpBelongsTo, topUpQuote } from "./client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const cfg = { publishableKey: "gc_pk_test_abc", origin: "https://goodbuildit.xyz" };

describe("goodCashConfig", () => {
  it("reads keys and builds the origin from APP_DOMAIN", () => {
    expect(goodCashConfig({ GOODCASH_PUBLISHABLE_KEY: "gc_pk_test_x", APP_DOMAIN: "goodbuildit.xyz" } as unknown as NodeJS.ProcessEnv)).toEqual({ publishableKey: "gc_pk_test_x", secretKey: undefined, origin: "https://goodbuildit.xyz" });
  });
  it("tells test keys from live ones", () => {
    expect(isTestKey("gc_pk_test_1")).toBe(true);
    expect(isTestKey("gc_sk_test_1")).toBe(true);
    expect(isTestKey("gc_pk_live_1")).toBe(false);
    expect(isTestKey(undefined)).toBe(false);
  });
});

describe("topUpQuote", () => {
  it("sends the publishable key with our Origin and the asked amount", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { amountNaira: 5000, asset: "g" }));
    await topUpQuote({ amountNaira: 5000, asset: "g", wallet: "0x" + "a".repeat(40) }, cfg, fetcher);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`https://api.goodcash.xyz/v1/topup/quote?amountNaira=5000&asset=g&wallet=0x${"a".repeat(40)}`);
    expect(init.headers).toMatchObject({ authorization: "Bearer gc_pk_test_abc", origin: "https://goodbuildit.xyz" });
  });
  it("prefers the secret key and then sends no Origin", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, {}));
    await topUpQuote({ amountNaira: 1000, asset: "celo" }, { ...cfg, secretKey: "gc_sk_test_z" }, fetcher);
    expect(fetcher.mock.calls[0][1].headers).toEqual({ authorization: "Bearer gc_sk_test_z", accept: "application/json" });
  });
  it("says Buy is off when no key is set, and when GoodCash answers not found", async () => {
    await expect(topUpQuote({ amountNaira: 1000, asset: "g" }, { origin: "x" }, vi.fn())).rejects.toMatchObject({ code: "not_configured" });
    await expect(topUpQuote({ amountNaira: 1000, asset: "g" }, cfg, vi.fn().mockResolvedValue(json(404, {})))).rejects.toMatchObject({ code: "not_enabled" });
  });
  it("shows the message from GoodCash's { error: { message } } shape", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(400, { error: { code: "asset_unavailable", message: "CELO top-ups aren't available yet.", detail: "x" } }));
    await expect(topUpQuote({ amountNaira: 5000, asset: "celo" }, cfg, fetcher)).rejects.toMatchObject({ code: "bad_request", message: "CELO top-ups aren't available yet." });
  });
  it("passes a short partner message for a bad amount and hides server faults", async () => {
    await expect(topUpQuote({ amountNaira: 1000, asset: "g" }, cfg, vi.fn().mockResolvedValue(json(400, { message: "Too small" })))).rejects.toMatchObject({ code: "bad_request", message: "Too small" });
    await expect(topUpQuote({ amountNaira: 1000, asset: "g" }, cfg, vi.fn().mockResolvedValue(json(500, { message: "stack trace" })))).rejects.toMatchObject({ code: "unavailable" });
    await expect(topUpQuote({ amountNaira: 1000, asset: "g" }, cfg, vi.fn().mockRejectedValue(new Error("offline")))).rejects.toBeInstanceOf(GoodCashError);
  });
});

describe("getTopUp", () => {
  it("refuses ids that are not top-up ids before calling out", async () => {
    const fetcher = vi.fn();
    await expect(getTopUp("../v1/cashouts", cfg, fetcher)).rejects.toMatchObject({ status: 404 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("only shows a top-up to the wallet it pays, in any letter case", () => {
    const wallet = "0xAbC" + "1".repeat(37);
    expect(topUpBelongsTo({ wallet }, wallet.toLowerCase())).toBe(true);
    expect(topUpBelongsTo({ wallet }, "0x" + "2".repeat(40))).toBe(false);
  });
});
