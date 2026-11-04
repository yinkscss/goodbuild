// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkApp, checkContracts, mentionsGd, mentionsNativeCelo } from "./checks";
import { DEMO_APP, DEMO_TIP_JAR_DRAFT, DEMO_TIP_JAR_FIXED } from "./demo-model";
import { starterFiles } from "./template";

const HEAD = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\nimport {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";\nimport {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";\n';
const sol = (body: string) => ({ "contracts/X.sol": HEAD + body });
const guardrails = (r: Awaited<ReturnType<typeof checkContracts>>) => r.errors.filter((e) => e.source === "guardrail").map((e) => e.message);

// The M4 demo tip jar, which wrongly took native CELO for a "G$" request.
const CELO_TIP_JAR = `contract X {
  error ZeroTip();
  address payable public immutable coach;
  constructor(address payable c) { coach = c; }
  function tip() external payable { if (msg.value == 0) revert ZeroTip(); (bool ok, ) = coach.call{value: msg.value}(""); if (!ok) revert ZeroTip(); }
}`;

describe("G$ detection", () => {
  it("treats G$ / GoodDollar as the token, and only uppercase CELO as native", () => {
    expect(mentionsGd("splits G$ 70/30")).toBe(true);
    expect(mentionsGd("pay in GoodDollar")).toBe(true);
    expect(mentionsGd("a poll on Celo")).toBe(false);
    expect(mentionsNativeCelo("deploy on Celo")).toBe(false);
    expect(mentionsNativeCelo("accept CELO or G$")).toBe(true);
  });
});

describe("G$ guardrails", { timeout: 60_000 }, () => {
  it("reject a native-CELO contract for a G$ request", async () => {
    const r = await checkContracts(sol(CELO_TIP_JAR), { gdToken: true });
    const m = guardrails(r).join("\n");
    expect(r.ok).toBe(false);
    expect(m).toMatch(/msg\.value \(native CELO\)/);
    expect(m).toMatch(/payable/);
    expect(m).toMatch(/no contract handles an ERC-20/);
  });

  it("don't apply when the project isn't about G$", async () => {
    expect((await checkContracts(sol(CELO_TIP_JAR))).ok).toBe(true);
  });

  it("allow payable when the user explicitly asks for CELO too", async () => {
    const both = `contract X { using SafeERC20 for IERC20; IERC20 public immutable gd; error Z();
      constructor(IERC20 g) { gd = g; }
      function payGd(uint256 a) external { gd.safeTransferFrom(msg.sender, address(this), a); }
      function payCelo() external payable { if (msg.value == 0) revert Z(); } }`;
    expect((await checkContracts(sol(both), { gdToken: true, allowNative: true })).ok).toBe(true);
  });

  it("require onTokenTransfer to check msg.sender", async () => {
    const r = await checkContracts(
      sol(`contract X { function onTokenTransfer(address, uint256, bytes calldata) external pure returns (bool) { return true; } }`),
      { gdToken: true },
    );
    expect(guardrails(r).join("\n")).toMatch(/onTokenTransfer must first check that msg.sender is the G\$ token/);
  });

  it("require SafeERC20 instead of raw transfer / transferFrom", async () => {
    const r = await checkContracts(
      sol(`contract X { IERC20 public immutable gd; error F(); constructor(IERC20 g) { gd = g; }
        function pull(uint256 a) external { if (!gd.transferFrom(msg.sender, address(this), a)) revert F(); }
        function push(address to, uint256 a) external { if (!gd.transfer(to, a)) revert F(); } }`),
      { gdToken: true },
    );
    const m = guardrails(r).join("\n");
    expect(m).toMatch(/SafeERC20 \(safeTransferFrom\) instead of calling transferFrom/);
    expect(m).toMatch(/SafeERC20 \(safeTransfer\) instead of calling transfer /);
  });

  it("the regenerated demo tip jar passes every check as G$ (after the scripted fix)", async () => {
    const r = await checkContracts({ "contracts/TipJar.sol": DEMO_TIP_JAR_FIXED }, { gdToken: true });
    expect(r.errors).toEqual([]);
    expect(r.contracts.map((c) => c.name)).toEqual(["TipJar"]);
    const abi = r.contracts[0].abi as Array<{ name?: string; stateMutability?: string }>;
    expect(abi.find((f) => f.name === "onTokenTransfer")).toBeDefined();
    expect(abi.find((f) => f.name === "tip")?.stateMutability).toBe("nonpayable");
    expect(abi.some((f) => f.stateMutability === "payable")).toBe(false);
    // And its front end passes the app checks with the template.
    expect(checkApp({ ...starterFiles(), "src/App.tsx": DEMO_APP, "src/contracts/index.ts": 'export * from "./TipJar";', "src/contracts/TipJar.ts": "export const TipJarAbi = [] as const; export const TipJarAddress = {};" }).errors).toEqual([]);
  });

  it("the demo draft fails to compile, so the demo shows an auto-fix", async () => {
    const r = await checkContracts({ "contracts/TipJar.sol": DEMO_TIP_JAR_DRAFT }, { gdToken: true });
    expect(r.errors[0]).toMatchObject({ source: "solc" });
  });
});

describe("custom errors only", { timeout: 60_000 }, () => {
  it("reject require without a custom error, and revert with a string", async () => {
    const r = await checkContracts(
      sol(`contract X { error E();
        function a(uint256 x) external pure { require(x > 0, "x is zero"); }
        function b(uint256 x) external pure { require(x > 0); }
        function c() external pure { revert("nope"); }
        function d(uint256 x) external pure { require(x > 0, E()); }
        function e(uint256 x) external pure { if (x == 0) revert E(); } }`),
    );
    const m = guardrails(r);
    expect(m.filter((x) => x.includes("instead of require"))).toHaveLength(2);
    expect(m.filter((x) => x.includes('instead of revert("...")'))).toHaveLength(1);
  });
});
