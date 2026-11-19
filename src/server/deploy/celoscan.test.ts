import { describe, expect, it, vi } from "vitest";

import type { Deployment } from "@/server/db/deploy-schema";
import { verifyOnCeloscan } from "./celoscan";

const base = {
  chainId: 42220,
  address: "0x1111111111111111111111111111111111111111",
  contractName: "Tip",
  compilerVersion: "0.8.28+commit.7893614a",
  constructorArgs: "0xabcd",
  stdJsonInput: { sources: { "contracts/Tip.sol": { content: "x" } } },
  proxy: null,
} as unknown as Deployment;
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const noWait = async () => {};

describe("verifyOnCeloscan", () => {
  it("skips testnet and a missing key", async () => {
    const f = vi.fn();
    expect((await verifyOnCeloscan({ ...base, chainId: 11142220 }, f as never, { key: "k" })).status).toBe("skipped");
    expect((await verifyOnCeloscan(base, f as never, { key: "" })).status).toBe("skipped");
    expect(f).not.toHaveBeenCalled();
  });
  it("submits standard JSON for chain 42220 and polls to verified", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ status: "1", result: "guid1" })).mockResolvedValueOnce(json({ status: "1", result: "Pass - Verified" }));
    const out = await verifyOnCeloscan(base, f as never, { key: "k", sleep: noWait });
    expect(out.status).toBe("verified");
    const [url, init] = f.mock.calls[0];
    expect(url).toContain("chainid=42220");
    const body = new URLSearchParams((init as RequestInit).body as URLSearchParams);
    expect(body.get("contractname")).toBe("contracts/Tip.sol:Tip");
    expect(body.get("compilerversion")).toBe("v0.8.28+commit.7893614a");
    expect(body.get("constructorArguments")).toBe("abcd");
  });
  it("submits a proxied contract as code with no arguments, then the proxy with its own", async () => {
    const f = vi.fn().mockResolvedValue(json({ status: "0", result: "Contract source code already verified" }));
    await verifyOnCeloscan({ ...base, proxy: { implementation: "0x2222222222222222222222222222222222222222" } } as unknown as Deployment, f as never, { key: "k" });
    const args = f.mock.calls.map(([, init]) => new URLSearchParams((init as RequestInit).body as URLSearchParams));
    expect([args[0].get("contractaddress"), args[0].get("constructorArguments")]).toEqual(["0x2222222222222222222222222222222222222222", ""]);
    expect([args[1].get("contractaddress"), args[1].get("constructorArguments")]).toEqual([base.address, "abcd"]);
  });
  it("treats already verified as verified and a rejection as failed", async () => {
    const ok = vi.fn().mockResolvedValue(json({ status: "0", result: "Contract source code already verified" }));
    expect((await verifyOnCeloscan(base, ok as never, { key: "k" })).status).toBe("verified");
    const bad = vi.fn().mockResolvedValue(json({ status: "0", result: "Invalid API Key" }));
    expect((await verifyOnCeloscan(base, bad as never, { key: "k" })).status).toBe("failed");
  });
});
