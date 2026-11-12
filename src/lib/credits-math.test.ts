import { describe, expect, it } from "vitest";

import { creditsForWei, formatCelo, formatCredits, formatCreditsShort, microToCredits, weiForDollars } from "./credits-math";

const RATE = BigInt(14_000_000); // $1 credits = 1_000_000 units, so 14 credits per CELO

describe("credits math", () => {
  it("never charges less than the credit asked for", () => {
    for (const d of [1, 2.5, 5, 10, 0.37]) {
      const wei = weiForDollars(d, RATE);
      expect(creditsForWei(wei, RATE)).toBeGreaterThanOrEqual(BigInt(Math.round(d * 1_000_000)));
    }
  });
  it("is zero for nothing or a bad rate", () => {
    expect(weiForDollars(0, RATE)).toBe(BigInt(0));
    expect(weiForDollars(5, BigInt(0))).toBe(BigInt(0));
  });
  it("shows 1 credit as 1 cent of AI", () => {
    expect(microToCredits(10_000)).toBe(1);
    expect(microToCredits(2_500_000)).toBe(250);
    expect(formatCredits(2_500_000)).toBe("250 credits");
    expect(formatCredits(10_000)).toBe("1 credit");
    expect(formatCredits(123_456)).toBe("12 credits");
    expect(formatCredits(1_234_560_000)).toBe("123,456 credits");
    expect(formatCredits(0)).toBe("0 credits");
    expect(formatCredits(4_000)).toBe("< 1 credit");
    expect(formatCreditsShort(2_500_000)).toBe("250");
  });
  it("formats CELO to four places", () => {
    expect(formatCelo(BigInt("1500000000000000000"))).toBe("1.5000");
  });
});
