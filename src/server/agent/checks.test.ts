// @vitest-environment node
import { describe, expect, it } from "vitest";

import { addressMapIssues, checkApp, checkContracts, pathProblem } from "./checks";
import { starterFiles, withStarterHelpers } from "./template";

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

describe("addressMapIssues", () => {
  const head = 'import { TipJarAbi, TipJarAddress } from "./contracts";\nimport { chain } from "./lib/chain";\n';
  it("accepts indexing the chain-id map", () => {
    const ok = head + "const address = TipJarAddress[chain.id];\nconst live = chain.id in TipJarAddress;\nconst b = TipJarAddress?.[chain.id];\n";
    expect(addressMapIssues("src/App.tsx", ok)).toEqual([]);
  });
  it("rejects passing the map as an address", () => {
    const bad = head + "publicClient.readContract({ address: TipJarAddress, abi: TipJarAbi, functionName: 'gd' });\n";
    const issues = addressMapIssues("src/App.tsx", bad);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 3 });
    expect(issues[0].message).toMatch(/TipJarAddress\[chain\.id\]/);
  });
  it("follows renamed imports and the per-contract module path", () => {
    const bad = 'import { TipJarAddress as jar } from "../contracts/TipJar";\nconst x = { address: jar };\n';
    expect(addressMapIssues("src/components/Jar.tsx", bad)).toHaveLength(1);
  });
  it("is part of checkApp, and the starter passes", () => {
    const files = { ...starterFiles(), "src/App.tsx": head + "export default function App() { return <p>{String(TipJarAddress)}</p>; }\n", "src/contracts/index.ts": "export const TipJarAddress = {}; export const TipJarAbi = [];\n" };
    expect(checkApp(files).errors.some((e) => e.message.includes("map from chain id"))).toBe(true);
    expect(checkApp(starterFiles()).errors).toEqual([]);
  });
});

describe("withStarterHelpers", () => {
  it("adds missing helpers and UI pieces without overwriting the project's files", () => {
    const old = { "src/App.tsx": "x", "src/lib/utils.ts": "custom", "src/components/ui/button.tsx": "mine", "contracts/A.sol": "c" };
    const out = withStarterHelpers(old);
    expect(out["src/lib/utils.ts"]).toBe("custom");
    expect(out["src/components/ui/button.tsx"]).toBe("mine");
    expect(out["src/App.tsx"]).toBe("x");
    expect(out["src/lib/hooks.ts"]).toContain("export function useTx");
    expect(out["src/lib/format.ts"]).toContain("export function formatAmount");
    expect(out["src/components/ui/notice.tsx"]).toBeDefined();
    expect(out["package.json"]).toBeUndefined();
  });
});

describe("own-token transferFrom guardrail", { timeout: 60_000 }, () => {
  it("flags run 2's RTX.sol calling its own public transferFrom", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./fixtures/rtx-run2.sol", import.meta.url), "utf8");
    const r = await checkContracts({ "contracts/RTX.sol": src }, { gdToken: true });
    expect(r.errors.some((e) => e.source === "guardrail" && /own public transferFrom\(\)/.test(e.message))).toBe(true);
  });
  it("allows calling another token's transferFrom and _transfer on its own", async () => {
    const r = await checkContracts({
      "contracts/Tok.sol":
        SPDX +
        'import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";\nimport {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";\nimport {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";\ncontract Tok is ERC20 {\n  using SafeERC20 for IERC20;\n  IERC20 public immutable gd;\n  constructor(IERC20 gd_) ERC20("T", "T") { gd = gd_; _mint(msg.sender, 1e24); }\n  function sell(uint256 a) external { _transfer(msg.sender, address(this), a); gd.safeTransfer(msg.sender, a); }\n}\n',
    }, { gdToken: true });
    expect(r.errors).toEqual([]);
  });
});
