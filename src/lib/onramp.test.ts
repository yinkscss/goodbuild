import { describe, expect, it } from "vitest";

import { onrampUrl } from "./onramp";

const WALLET = "0x00000000000000000000000000000000000000b1";

describe("onrampUrl", () => {
  it("is off without a key or with a bad address", () => {
    expect(onrampUrl(WALLET, {})).toBeNull();
    expect(onrampUrl("nope", { key: "k" })).toBeNull();
    expect(onrampUrl(null, { key: "k" })).toBeNull();
  });
  it("opens the provider for CELO on Celo, locked to the wallet", () => {
    const url = new URL(onrampUrl(WALLET, { key: "k" })!);
    expect(url.host).toBe("global.transak.com");
    expect(url.searchParams.get("cryptoCurrencyCode")).toBe("CELO");
    expect(url.searchParams.get("network")).toBe("celo");
    expect(url.searchParams.get("walletAddress")).toBe(WALLET);
  });
  it("can use the provider's staging site", () => {
    expect(onrampUrl(WALLET, { key: "k", staging: true })).toContain("global-stg.transak.com");
  });
});
