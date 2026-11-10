import { describe, expect, it } from "vitest";

import { isNearBottom } from "./scroll";

describe("isNearBottom", () => {
  it("is true at the end and a little above it, and false once the person has scrolled up to read", () => {
    const list = { scrollHeight: 2000, clientHeight: 600 };
    expect(isNearBottom({ ...list, scrollTop: 1400 })).toBe(true);
    expect(isNearBottom({ ...list, scrollTop: 1300 })).toBe(true);
    expect(isNearBottom({ ...list, scrollTop: 1000 })).toBe(false);
    // A list shorter than its box has nowhere to scroll: always following.
    expect(isNearBottom({ scrollHeight: 300, clientHeight: 600, scrollTop: 0 })).toBe(true);
  });
});
