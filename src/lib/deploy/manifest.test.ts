import { describe, expect, it } from "vitest";
import type { Abi, Address } from "viem";

import { coerceArg, parseManifest, planManifest, resolveArgs, topoSort, type DeployManifest } from "./manifest";

const ctor = (...inputs: Array<[string, string]>) => ({ type: "constructor", stateMutability: "nonpayable", inputs: inputs.map(([name, type]) => ({ name, type })) });
const abis = {
  RTXToken: [ctor()] as unknown as Abi,
  RTXPool: [ctor(["gd_", "address"], ["rtx_", "address"], ["rate_", "uint256"])] as unknown as Abi,
  Vault: [ctor(["pool_", "address"], ["owner_", "address"])] as unknown as Abi,
};
const contracts = Object.entries(abis).map(([name, abi]) => ({ name, abi }));
const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;

const manifest = (list: DeployManifest["contracts"]): DeployManifest => ({ contracts: list });

describe("planManifest", () => {
  it("sorts dependencies first even when the manifest lists them last", () => {
    const plan = planManifest(
      manifest([
        { name: "Vault", args: { pool_: "${RTXPool.address}", owner_: "${DEPLOYER}" } },
        { name: "RTXPool", args: { gd_: "${GOODDOLLAR}", rtx_: "${RTXToken.address}", rate_: "100" } },
        { name: "RTXToken", args: {} },
      ]),
      contracts,
    );
    expect(plan.ok && plan.steps.map((s) => s.name)).toEqual(["RTXToken", "RTXPool", "Vault"]);
  });

  it("keeps the manifest order when there are no dependencies", () => {
    const plan = planManifest(manifest([{ name: "RTXToken", args: {} }, { name: "Vault", args: { pool_: A, owner_: B } }]), contracts);
    expect(plan.ok && plan.steps.map((s) => s.name)).toEqual(["RTXToken", "Vault"]);
  });

  it("fails on a cycle and names it", () => {
    const cyc: DeployManifest["contracts"] = [
      { name: "Vault", args: { pool_: "${RTXPool.address}", owner_: A } },
      { name: "RTXPool", args: { gd_: A, rtx_: "${Vault.address}", rate_: 1 } },
    ];
    const plan = planManifest(manifest(cyc), contracts);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.issues[0].message).toMatch(/Circular deploy order: .*Vault.*RTXPool.*Vault|RTXPool.*Vault.*RTXPool/);
  });

  it("reports unknown contracts, missing and unknown arguments, bad references", () => {
    const plan = planManifest(
      manifest([
        { name: "Nope", args: {} },
        { name: "RTXPool", args: { gd_: "${Missing.address}", extra: 1, rate_: "1", rtx_: "${WHAT}" } },
      ]),
      contracts,
    );
    expect(plan.ok).toBe(false);
    const text = !plan.ok ? plan.issues.map((i) => i.message).join("\n") : "";
    expect(text).toMatch(/lists Nope/);
    expect(text).toMatch(/extra is not a constructor parameter/);
    expect(text).toMatch(/isn't in contracts\/deploy.json/);
    expect(text).toMatch(/unknown reference \$\{WHAT\}/);
  });

  it("rejects a contract that refers to itself", () => {
    const plan = planManifest(manifest([{ name: "Vault", args: { pool_: "${Vault.address}", owner_: A } }]), contracts);
    expect(plan.ok).toBe(false);
  });
});

describe("topoSort", () => {
  it("handles diamonds", () => {
    const r = topoSort([
      { name: "D", dependsOn: ["B", "C"] },
      { name: "B", dependsOn: ["A"] },
      { name: "C", dependsOn: ["A"] },
      { name: "A", dependsOn: [] },
    ]);
    expect(r).toEqual({ order: ["A", "B", "C", "D"] });
  });
});

describe("resolveArgs", () => {
  it("fills references and types the values", () => {
    const plan = planManifest(manifest([{ name: "RTXToken", args: {} }, { name: "RTXPool", args: { gd_: "${GOODDOLLAR}", rtx_: "${RTXToken.address}", rate_: "1000" } }]), contracts);
    if (!plan.ok) throw new Error("plan failed");
    const args = resolveArgs(plan.steps[1], abis.RTXPool, { deployed: { RTXToken: A }, gooddollar: B, deployer: A });
    expect(args).toEqual([B, A, BigInt(1000)]);
  });

  it("refuses a reference whose contract isn't deployed yet", () => {
    const plan = planManifest(manifest([{ name: "RTXToken", args: {} }, { name: "RTXPool", args: { gd_: A, rtx_: "${RTXToken.address}", rate_: 1 } }]), contracts);
    if (!plan.ok) throw new Error("plan failed");
    expect(() => resolveArgs(plan.steps[1], abis.RTXPool, { deployed: {}, gooddollar: null, deployer: A })).toThrow(/must be deployed before/);
  });

  it("refuses ${GOODDOLLAR} when the chain has no G$ address", () => {
    const plan = planManifest(manifest([{ name: "RTXPool", args: { gd_: "${GOODDOLLAR}", rtx_: A, rate_: 1 } }]), contracts);
    if (!plan.ok) throw new Error("plan failed");
    expect(() => resolveArgs(plan.steps[0], abis.RTXPool, { deployed: {}, gooddollar: null, deployer: A })).toThrow(/no G\$ address/);
  });
});

describe("coerceArg", () => {
  const p = (type: string, name = "x") => ({ name, type }) as never;
  it("parses integers exactly and rejects fractions, negatives and overflow", () => {
    expect(coerceArg(p("uint256"), "1000000000000000000")).toBe(BigInt(10) ** BigInt(18));
    expect(() => coerceArg(p("uint256"), "1.5")).toThrow(/whole number/);
    expect(() => coerceArg(p("uint256"), "-1")).toThrow();
    expect(() => coerceArg(p("uint8"), 256)).toThrow(/doesn't fit/);
    expect(coerceArg(p("int8"), -128)).toBe(BigInt(-128));
  });
  it("validates addresses and arrays", () => {
    expect(() => coerceArg(p("address"), "0x123")).toThrow(/0x address/);
    expect(coerceArg(p("address[]"), [A, B])).toEqual([A, B]);
    expect(() => coerceArg(p("address[2]"), [A])).toThrow(/exactly 2/);
  });
});

describe("parseManifest", () => {
  it("rejects bad JSON and bad shapes with readable messages", () => {
    expect(parseManifest("{").ok).toBe(false);
    const r = parseManifest(JSON.stringify({ contracts: [] }));
    expect(r.ok).toBe(false);
    expect(parseManifest(JSON.stringify({ contracts: [{ name: "A" }] })).ok).toBe(true);
  });
});
