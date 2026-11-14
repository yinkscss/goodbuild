// @vitest-environment node
import { describe, expect, it } from "vitest";

import { bar, hasOwnContracts } from "./build";

describe("the Built with GoodBuild badge", () => {
  it("shows by default", () => {
    expect(bar(false, "https://x/report?app=a")).toContain("Built with");
  });

  it("is gone with the badge off and nothing to warn about", () => {
    expect(bar(false, "https://x/report?app=a", false, false, false)).toBe("");
  });

  it("keeps visitor notices when the badge is off, without the branding", () => {
    const changeable = bar(false, "https://x/report?app=a", true, false, false);
    expect(changeable).toContain("data-goodbuild-bar");
    expect(changeable).not.toContain("Built with GoodBuild\" title");
    expect(changeable).not.toContain("<img");
    expect(changeable).toContain("Report");
    expect(bar(true, undefined, false, false, false)).toContain("Demo:");
  });

  it("always says an app's own contracts are unaudited, even with the badge off (D109)", () => {
    const off = bar(false, "https://x/report?app=a", false, false, false, true);
    expect(off).toContain("Unaudited contract");
    expect(off).not.toContain("<img"); // the owner's choice still removes the logo
    expect(bar(false, undefined, false, false, true, true)).toMatch(/<img[\s\S]*Unaudited contract/);
    expect(bar(false, undefined, false, false, true, false)).not.toContain("Unaudited");
  });

  it("counts the project's own contracts, not its tests", () => {
    expect(hasOwnContracts({ "contracts/Pool.sol": "" })).toBe(true);
    expect(hasOwnContracts({ "contracts/test/Pool.t.sol": "", "contracts/deploy.json": "{}", "src/App.tsx": "" })).toBe(false);
    expect(hasOwnContracts({ "contracts/Pool.t.sol": "" })).toBe(false);
  });
});
