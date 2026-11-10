import { describe, expect, it } from "vitest";

import { formatAmount, nairaValid, statusIndex } from "./buy-logic";

describe("buy logic", () => {
  it("accepts whole naira from 1,000 to 2,000,000 only", () => {
    expect([999, 1000, 2_000_000, 2_000_001, 1500.5, NaN].map(nairaValid)).toEqual([false, true, true, false, false, false]);
  });
  it("orders statuses so a late event can never move an order back", () => {
    expect(statusIndex("awaiting_payment")).toBeLessThan(statusIndex("paid_in"));
    expect(statusIndex("paid_in")).toBeLessThan(statusIndex("delivered"));
    expect(statusIndex("failed")).toBeGreaterThan(statusIndex("delivered"));
  });
  it("formats G$ as whole numbers and CELO with decimals", () => {
    expect(formatAmount(88500.4, "g")).toBe("88,500");
    expect(formatAmount(1.23456, "celo")).toBe("1.2346");
  });
});
