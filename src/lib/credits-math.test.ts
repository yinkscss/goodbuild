import { describe, expect, it } from "vitest";

import { creditsForWei, formatCelo, weiForDollars } from "./credits-math";

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
  it("formats CELO to four places", () => {
    expect(formatCelo(BigInt("1500000000000000000"))).toBe("1.5000");
  });
});
