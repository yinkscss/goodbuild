import { describe, expect, it } from "vitest";
import { friendStatus } from "./referral";

describe("friendStatus", () => {
  it("says what each friend has left", () => {
    expect(friendStatus({ verified: false, voted: false, rewarded: false }).label).toBe("Needs verifying");
    expect(friendStatus({ verified: true, voted: false, rewarded: false }).label).toBe("1 step left");
    expect(friendStatus({ verified: true, voted: true, rewarded: false }).label).toBe("Almost there");
    expect(friendStatus({ verified: true, voted: true, rewarded: true }).tone).toBe("ok");
  });
});
