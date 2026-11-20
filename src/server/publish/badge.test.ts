// @vitest-environment node
import { describe, expect, it } from "vitest";

import { bar, hasOwnContracts, mainnetContractAddresses } from "./build";

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

  it("links the unaudited notice to Celoscan for each mainnet contract (D156)", () => {
    const A = "0x1111111111111111111111111111111111111111";
    const B = "0x2222222222222222222222222222222222222222";
    const files = {
      "src/contracts/Tip.ts": `export const TipAddress = { "11142220": "${B}", "42220": "${A}" };`,
      "src/contracts/Pool.ts": `export const PoolAddress = { "42220": "${B}" };`,
      "src/contracts/index.ts": "export * from './Tip';",
    };
    expect(mainnetContractAddresses(files)).toEqual([B, A]);
    expect(mainnetContractAddresses({ "src/contracts/Tip.ts": `export const TipAddress = { "11142220": "${B}" };` })).toEqual([]);
    const one = bar(false, undefined, false, false, true, true, [A]);
    expect(one).toContain(`href="https://celoscan.io/address/${A}"`);
    expect(one).toMatch(/Unaudited contract \(<a[^>]*>Celoscan<\/a>\)/);
    expect(bar(false, undefined, false, false, true, true, [A, B])).toContain("Celoscan 2");
    expect(bar(false, undefined, false, false, true, true)).not.toContain("celoscan");
  });
});
