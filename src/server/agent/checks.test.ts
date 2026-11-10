// @vitest-environment node
import { describe, expect, it } from "vitest";

import { addressMapIssues, assetRefIssues, checkApp, checkContracts, lucideIssues, namingProblem, pathProblem } from "./checks";
import { ALLOWED_DEPENDENCIES, starterFiles, withStarterHelpers } from "./template";

const SPDX = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";

describe("namingProblem (file-structure guide)", () => {
  it("accepts the conventions", () => {
    for (const p of ["src/pages/Home.tsx", "src/components/TipForm.tsx", "src/components/sections/Hero.tsx", "src/components/ui/tabs.tsx", "src/lib/useTipJar.ts", "src/lib/format.ts", "contracts/TipJar.sol", "contracts/test/TipJar.t.sol", "src/App.tsx", "src/styles.css"]) {
      expect(namingProblem(p), p).toBeNull();
    }
  });
  it("names the expected file for violations", () => {
    expect(namingProblem("src/pages/home.tsx")).toContain("src/pages/Home.tsx");
    expect(namingProblem("src/components/tip-form.tsx")).toContain("src/components/TipForm.tsx");
    expect(namingProblem("src/lib/use-tip-jar.ts")).toContain("src/lib/useTipJar.ts");
    expect(namingProblem("src/lib/Format.ts")).toContain("src/lib/format.ts");
    expect(namingProblem("contracts/tip_jar.sol")).toContain("contracts/TipJar.sol");
    expect(namingProblem("src/hooks/useX.ts")).toContain("src/lib");
    expect(namingProblem("src/screens/Home.tsx")).toContain("src/pages");
  });
});

describe("lucide icon names", () => {
  it("rejects icons lucide doesn't have (brand icons) and accepts real ones", () => {
    const files = { "src/App.tsx": 'import { Instagram, Mail, CheckCircle2 as Ok } from "lucide-react";\nexport default function App() { return null; }' };
    const issues = lucideIssues(files);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('no icon "Instagram"');
    expect(issues[0].message).toContain("no brand icons");
  });
  it("checks against the same lucide-react version generated apps pin", async () => {
    const { readFile } = await import("node:fs/promises");
    const installed = JSON.parse(await readFile("node_modules/lucide-react/package.json", "utf8")).version;
    expect(installed).toBe(ALLOWED_DEPENDENCIES["lucide-react"]);
  });
});

describe("asset references", () => {
  it("rejects /assets/ paths that weren't uploaded, and src/assets/ edits", () => {
    const files = { ...starterFiles(), "src/App.tsx": 'export default function App() { return <img src="/assets/logo.png" alt="" />; }', "public/index.html": '<link rel="icon" href="/assets/fav.svg">' };
    expect(assetRefIssues(files, ["logo.png"]).map((i) => i.file)).toEqual(["public/index.html"]);
    expect(checkApp(files, { assets: ["logo.png", "fav.svg"] }).ok).toBe(true);
    expect(checkApp(files, { assets: [] }).errors[0].message).toContain("hasn't uploaded any images");
    expect(pathProblem("src/assets/index.ts")).toMatch(/uploads/);
  });
});

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
  it("rejects the starter page and accepts a page that replaced it", () => {
    const starter = checkApp(starterFiles()).errors;
    expect(starter).toHaveLength(1);
    expect(starter[0]).toMatchObject({ file: "src/App.tsx", source: "paths" });
    expect(starter[0].message).toMatch(/starter page/);
    expect(checkApp({ ...starterFiles(), "src/App.tsx": "export default function App() { return <main>Ready</main>; }\n" }).errors).toEqual([]);
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
  it("is part of checkApp", () => {
    const files = { ...starterFiles(), "src/App.tsx": head + "export default function App() { return <p>{String(TipJarAddress)}</p>; }\n", "src/contracts/index.ts": "export const TipJarAddress = {}; export const TipJarAbi = [];\n" };
    expect(checkApp(files).errors.some((e) => e.message.includes("map from chain id"))).toBe(true);
    expect(checkApp({ ...starterFiles(), "src/App.tsx": "export default function App() { return <main>Ready</main>; }\n" }).errors).toEqual([]);
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
