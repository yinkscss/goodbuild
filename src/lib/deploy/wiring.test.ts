import { describe, expect, it } from "vitest";

import { contractAddressKey, contractsToWire, deployedContracts, wirePrompt } from "./wiring";

const mod = (map: string) => `export const TipAbi = [] as const;\nexport const TipAddress: Partial<Record<number, Address>> = ${map};\n`;

describe("contractAddressKey", () => {
  it("changes when an address lands, and not for other edits", () => {
    const before = { "src/contracts/Tip.ts": mod("{}"), "src/App.tsx": "a" };
    const after = { ...before, "src/contracts/Tip.ts": mod('{\n  "11142220": "0xabc"\n}') };
    expect(contractAddressKey(after)).not.toBe(contractAddressKey(before));
    expect(contractAddressKey({ ...before, "src/App.tsx": "b" })).toBe(contractAddressKey(before));
  });
});

describe("deployedContracts", () => {
  it("only lists contracts with an address on this chain", () => {
    const files = { "src/contracts/Tip.ts": mod('{\n  "11142220": "0xabc"\n}') };
    expect(deployedContracts(files, 11142220)).toEqual(["Tip"]);
    expect(deployedContracts(files, 42220)).toEqual([]);
    expect(deployedContracts({ "src/contracts/Tip.ts": mod("{}") }, 11142220)).toEqual([]);
  });
});

describe("contractsToWire", () => {
  const platform = { "src/contracts/Tip.ts": mod("{}") };
  it("is empty when the app reads the address, even with a helper contract unread", () => {
    const files = { ...platform, "src/lib/useTip.ts": "const a = TipAddress[chain.id];" };
    expect(contractsToWire(files, ["Tip"])).toEqual([]);
    expect(contractsToWire(files, ["Tip", "Helper"])).toEqual([]);
  });
  it("lists every contract when no page reads any address, ignoring the platform modules", () => {
    expect(contractsToWire({ ...platform, "src/App.tsx": "sample data" }, ["Tip"])).toEqual(["Tip"]);
  });
  it("doesn't match a longer name", () => {
    expect(contractsToWire({ "src/App.tsx": "MyTipAddress" }, ["Tip"])).toEqual(["Tip"]);
  });
  it("names the contracts in the prompt", () => {
    expect(wirePrompt(["Tip", "Pool"])).toContain("Tip and Pool");
  });
});
