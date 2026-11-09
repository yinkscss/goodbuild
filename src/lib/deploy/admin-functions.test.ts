import type { Abi } from "viem";
import { describe, expect, it } from "vitest";

import { adminFunctions, parseArg, parseArgs, plainLabel } from "./admin-functions";

const fn = (name: string, inputs: Array<{ type: string; name?: string }> = [], stateMutability = "nonpayable") => ({ type: "function", name, inputs: inputs.map((i) => ({ name: i.name ?? "", type: i.type })), outputs: [], stateMutability });

describe("adminFunctions", () => {
  it("finds admin-style write functions and skips reads, payable and ordinary user calls", () => {
    const abi = [fn("pause"), fn("setFee", [{ type: "uint256" }]), fn("transferOwnership", [{ type: "address" }]), fn("owner", [], "view"), fn("transfer", [{ type: "address" }, { type: "uint256" }]), fn("setPrice", [{ type: "uint256" }], "payable"), { type: "event", name: "Paused", inputs: [] }] as unknown as Abi;
    expect(adminFunctions(abi).map((f) => f.name)).toEqual(["pause", "setFee", "transferOwnership"]);
  });

  it("gives plain labels and flags the ones that move funds or control", () => {
    const [pause, owner, withdraw] = adminFunctions([fn("pause"), fn("transferOwnership", [{ type: "address" }]), fn("withdrawFees")] as unknown as Abi);
    expect(pause.label).toBe("Pause the app");
    expect(pause.sensitive).toBe(false);
    expect(owner.label).toBe("Hand over ownership");
    expect(owner.sensitive).toBe(true);
    expect(withdraw.label).toBe("Withdraw fees");
    expect(withdraw.sensitive).toBe(true);
    expect(plainLabel("setFeeRate")).toBe("Set fee rate");
  });

  it("lists, but marks unsupported, functions with array or struct inputs", () => {
    const [f] = adminFunctions([fn("addMembers", [{ type: "address[]" }])] as unknown as Abi);
    expect(f.supported).toBe(false);
    expect(f.reason).toMatch(/explorer/);
  });
});

describe("parseArg", () => {
  it("accepts a checksummed or lowercase address and rejects junk", () => {
    const a = "0x7a3000000000000000000000000000000000e41c";
    const r = parseArg({ type: "address" }, ` ${a} `);
    expect(r.ok && typeof r.value === "string" && r.value.toLowerCase()).toBe(a);
    expect(parseArg({ type: "address" }, "0x123").ok).toBe(false);
  });

  it("is strict about numbers and their size", () => {
    expect(parseArg({ type: "uint256" }, "42")).toEqual({ ok: true, value: BigInt(42) });
    expect(parseArg({ type: "uint256" }, "1.5").ok).toBe(false);
    expect(parseArg({ type: "uint256" }, "-1").ok).toBe(false);
    expect(parseArg({ type: "uint8" }, "256").ok).toBe(false);
    expect(parseArg({ type: "uint8" }, "255").ok).toBe(true);
    expect(parseArg({ type: "int8" }, "-128").ok).toBe(true);
    expect(parseArg({ type: "int8" }, "128").ok).toBe(false);
  });

  it("handles bool, bytes and unsupported types", () => {
    expect(parseArg({ type: "bool" }, "true")).toEqual({ ok: true, value: true });
    expect(parseArg({ type: "bool" }, "yes").ok).toBe(false);
    expect(parseArg({ type: "bytes32" }, "0x12").ok).toBe(false);
    expect(parseArg({ type: "bytes32" }, "0x" + "ab".repeat(32)).ok).toBe(true);
    expect(parseArg({ type: "tuple" }, "x").ok).toBe(false);
  });

  it("reports which field is wrong", () => {
    const [f] = adminFunctions([fn("setLimits", [{ type: "uint256" }, { type: "uint256" }])] as unknown as Abi);
    expect(parseArgs(f.abi, ["1", "oops"])).toMatchObject({ ok: false, index: 1 });
    expect(parseArgs(f.abi, ["1", "2"])).toEqual({ ok: true, args: [BigInt(1), BigInt(2)] });
  });
});
