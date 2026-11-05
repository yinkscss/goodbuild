import { describe, expect, it } from "vitest";

import { previewChannelName, shouldShowSaved } from "./preview-channel";

describe("preview channel", () => {
  it("is scoped to one project", () => {
    expect(previewChannelName("a")).not.toBe(previewChannelName("b"));
  });

  it("shows saved files when they're newer, or the same version gained a deployed address", () => {
    const at = (version: number, addresses = "") => ({ version, addresses });
    expect(shouldShowSaved(at(4), at(3))).toBe(true);
    expect(shouldShowSaved(at(3), at(3))).toBe(false);
    expect(shouldShowSaved(at(2), at(3))).toBe(false);
    expect(shouldShowSaved(at(3, "0xabc"), at(3))).toBe(true);
    expect(shouldShowSaved(at(2, "0xabc"), at(3))).toBe(false);
  });
});
