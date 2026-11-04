// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkApp, checkContracts, pathProblem } from "./checks";
import { starterFiles } from "./template";

const SPDX = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";

describe("pathProblem", () => {
  it("allows app and contract files", () => {
    expect(pathProblem("src/App.tsx")).toBeNull();
    expect(pathProblem("src/components/RoundCard.tsx")).toBeNull();
    expect(pathProblem("contracts/SavingsCircle.sol")).toBeNull();
  });
  it("refuses traversal, absolute paths, package.json and the platform folder", () => {
    expect(pathProblem("../etc/passwd")).toMatch(/Invalid path/);
    expect(pathProblem("/src/App.tsx")).toMatch(/Invalid path/);
    expect(pathProblem("package.json")).toMatch(/add_dependency/);
    expect(pathProblem("src/contracts/TipJar.ts")).toMatch(/written by GoodBuild/);
    expect(pathProblem("scripts/x.sh")).toMatch(/must be under/);
  });
});

describe("checkContracts", { timeout: 60_000 }, () => {
  it("compiles a contract with OpenZeppelin imports and returns its ABI", async () => {
    const r = await checkContracts({
      "contracts/TipJar.sol":
        SPDX +
        'import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";\ncontract TipJar is ReentrancyGuard {\n  event Tipped(address indexed from, uint256 amount);\n  function tip() external payable nonReentrant { emit Tipped(msg.sender, msg.value); }\n}\n',
    });
    expect(r.errors).toEqual([]);
    expect(r.contracts.map((c) => c.name)).toEqual(["TipJar"]);
    expect(r.contracts[0].abi.length).toBeGreaterThan(0);
    expect(r.compilerVersion).toMatch(/^0\.8\.28/);
  });

  it("reports compile errors with a line number", async () => {
    const r = await checkContracts({ "contracts/Bad.sol": SPDX + "contract Bad {\n  function f() public { uint x = ; }\n}\n" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ file: "contracts/Bad.sol", line: 4, source: "solc" });
  });

  it("enforces the guardrails", async () => {
    const r = await checkContracts({
      "contracts/Danger.sol":
        SPDX +
        `contract Danger {
  address owner;
  function a(address t, bytes calldata d) external { (bool ok,) = t.delegatecall(d); require(ok); }
  function b() external { require(tx.origin == owner); }
  function c() external { selfdestruct(payable(owner)); }
  function d() external { assembly { let x := 1 } }
  function e(address t, bytes calldata data) external { (bool ok,) = t.call(data); require(ok); }
  function f(address payable t) external { (bool ok,) = t.call{value: 1}(""); require(ok); }
}
`,
    });
    const messages = r.errors.filter((e) => e.source === "guardrail").map((e) => e.message);
    expect(messages.some((m) => m.includes("delegatecall"))).toBe(true);
    expect(messages.some((m) => m.includes("tx.origin"))).toBe(true);
    expect(messages.some((m) => m.includes("selfdestruct"))).toBe(true);
    expect(messages.some((m) => m.includes("assembly"))).toBe(true);
    expect(messages.filter((m) => m.includes("Low-level .call"))).toHaveLength(1); // f() is a plain transfer
    expect(r.ok).toBe(false);
  });

  it("only allows OpenZeppelin imports", async () => {
    const r = await checkContracts({ "contracts/X.sol": SPDX + 'import "hardhat/console.sol";\ncontract X {}\n' });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/openzeppelin|not found|Only/i);
  });

  it("passes when there are no contracts", async () => {
    expect((await checkContracts({ "src/App.tsx": "" })).ok).toBe(true);
  });
});

describe("checkApp", () => {
  it("accepts the starter template", () => {
    expect(checkApp(starterFiles()).errors).toEqual([]);
  });
  it("reports syntax errors, missing files, aliases and unknown packages", () => {
    const files = {
      ...starterFiles(),
      "src/App.tsx": `import { X } from "./components/Missing";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
export default function App() { return <div>{ }</div> }
const broken = (;
`,
    };
    const errors = checkApp(files).errors;
    const text = errors.map((e) => `${e.source}:${e.message}`).join("\n");
    expect(text).toMatch(/imports:Import "\.\/components\/Missing"/);
    expect(text).toMatch(/framer-motion.*allowed package list/);
    expect(text).toMatch(/date-fns.*add_dependency/);
    expect(text).toMatch(/relative import instead of "@\/lib\/utils"/);
    expect(text).toMatch(/syntax:/);
  });
});
