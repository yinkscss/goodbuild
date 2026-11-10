// @vitest-environment node
import { describe, expect, it } from "vitest";

import { bar } from "./build";

describe("the Built with GoodBuild badge", () => {
  it("shows by default", () => {
    expect(bar(false, "https://x/report?app=a")).toContain("Built with");
  });

  it("is gone with the badge off and nothing to warn about", () => {
    expect(bar(false, "https://x/report?app=a", false, false)).toBe("");
  });

  it("keeps visitor notices when the badge is off, without the branding", () => {
    const changeable = bar(false, "https://x/report?app=a", true, false);
    expect(changeable).toContain("data-goodbuild-bar");
    expect(changeable).not.toContain("Built with");
    expect(changeable).not.toContain("goodbuildit.xyz\"");
    expect(changeable).toContain("Report");
    expect(bar(true, undefined, false, false)).toContain("Demo:");
  });
});
