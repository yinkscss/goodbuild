import { beforeEach, describe, expect, it } from "vitest";

import { loadSent, pendingKey, saveSent } from "./pending";

const TX = `0x${"ab".repeat(32)}` as const;
const A = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD" as const;

describe("pending deploy transactions", () => {
  beforeEach(() => localStorage.clear());

  it("survives a reload and clears when nothing is pending", () => {
    const key = pendingKey("p1", 11142220, TX, A);
    saveSent(key, { Token: TX });
    expect(loadSent(key)).toEqual({ Token: TX });
    saveSent(key, {});
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("is scoped by source and wallet", () => {
    const key = pendingKey("p1", 11142220, TX, A);
    saveSent(key, { Token: TX });
    expect(loadSent(pendingKey("p1", 11142220, `0x${"cd".repeat(32)}`, A))).toEqual({});
    expect(loadSent(pendingKey("p1", 11142220, TX, "0x1111111111111111111111111111111111111111"))).toEqual({});
  });

  it("ignores anything malformed", () => {
    localStorage.setItem("k", '{"Token":"nope"}');
    expect(loadSent("k")).toEqual({});
    localStorage.setItem("k", "not json");
    expect(loadSent("k")).toEqual({});
  });
});
