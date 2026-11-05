import { describe, expect, it } from "vitest";

import { isNewerSavedVersion, previewChannelName } from "./preview-channel";

describe("preview channel", () => {
  it("is scoped to one project", () => {
    expect(previewChannelName("a")).not.toBe(previewChannelName("b"));
  });

  it("only lets a newer saved version replace what the pop-out shows", () => {
    expect(isNewerSavedVersion(4, 3)).toBe(true);
    expect(isNewerSavedVersion(3, 3)).toBe(false);
    expect(isNewerSavedVersion(2, 3)).toBe(false);
  });
});
