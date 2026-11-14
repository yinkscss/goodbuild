// @vitest-environment node
// GB-04 (security sweep, 14 Nov 2026): the mainnet exploit gate could record "passed" when no exploit test ran.
// Every case here runs real Solidity through prepareDeploy / exploitGate, the same path a mainnet deploy takes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

import { stripSolidity } from "@/server/agent/solidity-text";
import { exploitTestIssues, exploitTests, rolesOf } from "@/server/agent/kits/dao-vault";
import { isTestFile } from "@/server/agent/checks";
import { saveFiles } from "@/server/agent/store";
import { contractModule, starterFiles } from "@/server/agent/template";
import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { deployReviews } from "@/server/db/deploy-schema";
import { createProjectFromPrompt } from "@/server/projects";
import { setMainnetMode } from "@/server/settings/mainnet-access";
import { compileForDeploy } from "./compile";
import { exploitGate } from "./exploit-gate";
import { prepareDeploy } from "./service";

const HEADER = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";
const POOL =
  HEADER +
  `import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// A members' G$ pool. Not a "deposit"/"withdraw" contract by name, but it holds everyone's G$.
contract GoodPool is Ownable, ReentrancyGuard {
    error NotEnough();
    error FeeTooHigh();
    error TransferFailed();

    IERC20 public immutable gd;
    uint256 public feeBps;
    mapping(address => uint256) public balances;

    constructor(IERC20 gd_) Ownable(msg.sender) {
        gd = gd_;
    }

    function setFee(uint256 bps) external onlyOwner {
        if (bps > 500) revert FeeTooHigh();
        feeBps = bps;
    }

    function joinPool(uint256 amount) external nonReentrant {
        balances[msg.sender] += amount;
        if (!gd.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    function exitPool(uint256 amount) external nonReentrant {
        if (balances[msg.sender] < amount) revert NotEnough();
        balances[msg.sender] -= amount;
        if (!gd.transfer(msg.sender, amount)) revert TransferFailed();
    }
}
`;

/** A test contract for GoodPool with the functions you give it. `suite` renames the contract; `from` is where it imports the pool from. */
const suite = (fns: string, { suite = "GoodPoolTest", from = "../GoodPool.sol" }: { suite?: string; from?: string } = {}) =>
  HEADER +
  `import {Test, Actor} from "@goodbuild/Test.sol";
import {MockGoodDollar} from "@goodbuild/MockGoodDollar.sol";
import {GoodPool} from "${from}";

contract ${suite} is Test {
    MockGoodDollar gd;
    GoodPool pool;
    Actor alice;
    Actor mallory;

    function setUp() public {
        gd = new MockGoodDollar();
        pool = new GoodPool(gd);
        alice = newActor();
        mallory = newActor();
        gd.mint(address(alice), 1_000e18);
        gd.mint(address(mallory), 1_000e18);
    }
${fns}}
`;

const UNAUTH = (name = "testExploitUnauthorizedCall", vis = "public") => `
    function ${name}() ${vis} {
        expectRevert(mallory, address(pool), abi.encodeCall(pool.setFee, (1)), "a stranger can't set the fee");
    }
`;
const REENTRANT = (name = "testExploitReentrancyOverdraw", vis = "public") => `
    function ${name}() ${vis} {
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(pool), 100e18)));
        alice.exec(address(pool), abi.encodeCall(pool.joinPool, (100e18)));
        expectRevert(mallory, address(pool), abi.encodeCall(pool.exitPool, (1)), "mallory can't take alice's G$");
    }
`;
const MANIFEST = JSON.stringify({ contracts: [{ name: "GoodPool", args: { gd_: "${GOODDOLLAR}" } }] });
const WALLET = "0x7a3000000000000000000000000000000000e41c";

let db: Db;
let projectId: string;

async function useFiles(contracts: Record<string, string>) {
  await saveFiles(db, projectId, { ...starterFiles(), ...contracts, "contracts/deploy.json": MANIFEST, "src/contracts/GoodPool.ts": contractModule("GoodPool", []) });
}
const refusal = async (ownerReviewed = true) => {
  const error = (await prepareDeploy(db, { projectId, chainId: 42220, wallet: WALLET, ownerReviewed }).then(
    () => null,
    (e: { code: string; details?: string[] }) => e,
  )) as { code: string; details?: string[] } | null;
  return error;
};

beforeEach(async () => {
  vi.stubEnv("MAINNET_DEFAULT_MODE", "everyone");
  process.env.NEXT_PUBLIC_TEST_GD_ADDRESS = "0x00000000000000000000000000000000000000d1";
  db = await createTestDb();
  const user = await signInUser(db, { wallet: WALLET, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  projectId = (await createProjectFromPrompt(db, user.id, { prompt: "a G$ savings pool", network: "celo" })).id;
  await setMainnetMode(db, "everyone", null);
});

describe("GB-04: the gate records passed only when the exploit tests ran and passed", { timeout: 180_000 }, () => {
  it("control: two real tests in contracts/test/ pass, and the audit row says so", async () => {
    await useFiles({ "contracts/GoodPool.sol": POOL, "contracts/test/GoodPool.t.sol": suite(UNAUTH() + REENTRANT()) });
    const plan = await prepareDeploy(db, { projectId, chainId: 42220, wallet: WALLET, ownerReviewed: true });
    const [row] = await db.select().from(deployReviews).where(and(eq(deployReviews.projectId, projectId), eq(deployReviews.sourceHash, plan.sourceHash)));
    expect(row.exploitTests).toBe("passed");
  });

  it("(a) a testExploitReentrancy that exists only in a comment is refused", async () => {
    const commented = suite(UNAUTH() + "    // function testExploitReentrancy() public { expectRevert(mallory, address(pool), abi.encodeCall(pool.exitPool, (1)), \"x\"); }\n    /* function testExploitReentrancyBlock() public { assertTrue(1 > 0, \"x\"); } */\n");
    await useFiles({ "contracts/GoodPool.sol": POOL, "contracts/test/GoodPool.t.sol": commented });
    const error = await refusal();
    expect(error?.code).toBe("exploit_tests_failed");
    expect(error?.details?.join("\n")).toMatch(/testExploitReentrancy/);
  });

  it("(b) the same tests in contracts/GoodPool.t.sol, outside contracts/test/, are tests (never a deployable contract) and run", async () => {
    const files = { "contracts/GoodPool.sol": POOL, "contracts/GoodPool.t.sol": suite(UNAUTH() + REENTRANT(), { from: "./GoodPool.sol" }) };
    expect(isTestFile("contracts/GoodPool.t.sol")).toBe(true);
    expect(isTestFile("contracts/test/GoodPool.t.sol")).toBe(true);
    expect(isTestFile("contracts/GoodPool.sol")).toBe(false);
    const compiled = await compileForDeploy({ ...starterFiles(), ...files });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.artifacts.map((a) => a.name)).toEqual(["GoodPool"]); // GoodPoolTest is not deployable
    // And it is run: the gate passes only because the executed results hold both tests.
    const gate = await exploitGate({ ...starterFiles(), ...files });
    expect(gate.problems).toEqual([]);
    expect(gate.exploitTests).toBe("passed");
    // A test outside contracts/test/ that fails now fails the gate (it used to be skipped).
    const failing = await exploitGate({ ...starterFiles(), ...files, "contracts/GoodPool.t.sol": suite(UNAUTH() + REENTRANT().replace("expectRevert(mallory,", "expectRevert(alice,"), { from: "./GoodPool.sol" }) });
    expect(failing.problems.join("\n")).toMatch(/testExploitReentrancyOverdraw/);
    expect(failing.exploitTests).toBe("failed");
  });

  it("(c) tests that only assert a literal constant are refused", async () => {
    const hollow = (name: string) => `\n    function ${name}() public {\n        assertTrue(true, "ok");\n        assertEq(1, 1, "same");\n    }\n`;
    await useFiles({ "contracts/GoodPool.sol": POOL, "contracts/test/GoodPool.t.sol": suite(hollow("testExploitUnauthorizedCall") + hollow("testExploitReentrancy")) });
    const error = await refusal();
    expect(error?.code).toBe("exploit_tests_failed");
    expect(error?.details?.join("\n")).toMatch(/doesn't check anything|asserts only constants|only constants/);
  });

  it("(d) one function name can't satisfy several needs", async () => {
    await useFiles({ "contracts/GoodPool.sol": POOL, "contracts/test/GoodPool.t.sol": suite(UNAUTH("testExploitUnauthorizedReentrancyDonation")) });
    const error = await refusal();
    expect(error?.code).toBe("exploit_tests_failed");
    expect(error?.details?.join("\n")).toMatch(/testExploitReentrancy|testExploitUnauthorizedCall/);
  });

  it("(e) zero executed tests with money-holding code is a refusal, never a pass", async () => {
    // The test contract isn't named *Test, so it is never compiled as a suite and nothing runs.
    await useFiles({ "contracts/GoodPool.sol": POOL, "contracts/test/GoodPool.t.sol": suite(UNAUTH() + REENTRANT(), { suite: "GoodPoolSpec" }) });
    const error = await refusal();
    expect(error?.code).toBe("exploit_tests_failed");
    expect(error?.details?.join("\n")).toMatch(/no tests ran|didn't run|none of the tests ran/i);
    const rows = await db.select().from(deployReviews).where(eq(deployReviews.projectId, projectId));
    expect(rows).toEqual([]);
  });

  it("(e) the gate itself: an empty run result with custody present is not a pass", async () => {
    const files = { ...starterFiles(), "contracts/GoodPool.sol": POOL, "contracts/test/GoodPool.t.sol": suite(UNAUTH() + REENTRANT()) };
    const gate = await exploitGate(files, { run: async () => ({ results: [], issues: [] }) });
    expect(gate.problems.join("\n")).toMatch(/no tests ran|didn't run|none of the tests ran/i);
    expect(gate.exploitTests).not.toBe("passed");
  });

  it("(e) a named test that was never executed, or executed and failed, doesn't satisfy its need", async () => {
    const files = { ...starterFiles(), "contracts/GoodPool.sol": POOL, "contracts/test/GoodPool.t.sol": suite(UNAUTH() + REENTRANT()) };
    const result = (test: string, ok: boolean) => ({ contract: "GoodPoolTest", file: "contracts/test/GoodPool.t.sol", test, ok });
    const onlyOne = await exploitGate(files, { run: async () => ({ results: [result("testExploitUnauthorizedCall", true)], issues: [] }) });
    expect(onlyOne.problems.join("\n")).toMatch(/testExploitReentrancy/);
    const failed = await exploitGate(files, { run: async () => ({ results: [result("testExploitUnauthorizedCall", true), result("testExploitReentrancyOverdraw", false)], issues: [] }) });
    expect(failed.problems.join("\n")).toMatch(/testExploitReentrancy/);
    const both = await exploitGate(files, { run: async () => ({ results: [result("testExploitUnauthorizedCall", true), result("testExploitReentrancyOverdraw", true)], issues: [] }) });
    expect(both.problems).toEqual([]);
    expect(both.exploitTests).toBe("passed");
  });

  it("a test that isn't public or external is refused (it never runs)", async () => {
    await useFiles({ "contracts/GoodPool.sol": POOL, "contracts/test/GoodPool.t.sol": suite(UNAUTH() + REENTRANT("testExploitReentrancyOverdraw", "internal")) });
    const error = await refusal();
    expect(error?.code).toBe("exploit_tests_failed");
    expect(error?.details?.join("\n")).toMatch(/testExploitReentrancy/);
  });

  it("(f) a money-holding contract whose only mention of deposit/withdraw is a comment still needs the owner's review", async () => {
    const commented = POOL.replace("// A members' G$ pool.", "// function deposit(uint256 a) external; function withdraw(uint256 a) external;\n// A members' G$ pool.");
    await useFiles({ "contracts/GoodPool.sol": commented, "contracts/test/GoodPool.t.sol": suite(UNAUTH() + REENTRANT()) });
    expect(rolesOf({ "contracts/GoodPool.sol": commented })).toEqual([]);
    const error = await refusal(false);
    expect(error?.code).toBe("needs_owner_review");
    const gate = await exploitGate({ ...starterFiles(), "contracts/GoodPool.sol": commented, "contracts/test/GoodPool.t.sol": suite(UNAUTH() + REENTRANT()) });
    expect(gate.knownShape).toBe(false);
    expect(gate.custody.length).toBeGreaterThan(0);
  });
});

describe("GB-04: text rules ignore comments and string literals", () => {
  it("stripSolidity blanks comments and strings, keeps offsets and lines", () => {
    const src = 'a // function deposit(\nb /* function withdraw( \n */ c "function vote(" d \'x//y\' e unicode"é" f hex"00"\ng';
    const out = stripSolidity(src);
    expect(out).toHaveLength(src.length);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
    expect(out).not.toMatch(/deposit|withdraw|vote/);
    expect(out.split("\n")[0]).toMatch(/^a +$/);
    expect(out.split("\n")[1]).toMatch(/^b +$/);
    // quotes stay (so a string argument still looks like one); what was inside them is blank
    expect(out.split("\n")[2].replace(/ +/g, " ")).toBe(' c " " d \' \' e unicode" " f hex" "');
    expect(out.split("\n")[3]).toBe("g");
    // an escaped quote doesn't end the string; a comment marker inside a string isn't a comment
    expect(stripSolidity('x "a\\"b // c" y // z')).toMatch(/^x " +" y +$/);
  });

  it("rolesOf ignores comments and strings", () => {
    const noise = `// function deposit() function withdraw() function propose() function vote()
/* function stake( ) function claim( ) */
contract Tip { string s = "function deposit( function withdraw("; function tip() external payable {} }`;
    expect(rolesOf({ "contracts/Tip.sol": noise })).toEqual([]);
    expect(rolesOf({ "contracts/Real.sol": "contract Real { function deposit(uint256) external {} function withdraw(uint256) external {} }" })).toEqual(["vault"]);
  });

  it("exploitTests / exploitTestIssues: only public or external functions in test files, found outside comments, each need met by its own test", () => {
    const files = (tests: string) => ({ "contracts/Vault.sol": "contract Vault { function deposit(uint256) external {} function withdraw(uint256) external {} }", "contracts/test/Vault.t.sol": tests });
    const ok = (name: string, body = "expectRevert(a, b, c, \"m\");", vis = "public") => `function ${name}() ${vis} { ${body} }\n`;
    expect(exploitTests(files("// " + ok("testExploitReentrancy") + "/* " + ok("testExploitUnauthorizedCall") + " */")).map((t) => t.name)).toEqual([]);
    expect(exploitTests(files(ok("testExploitReentrancy", undefined, "internal") + ok("testExploitUnauthorizedCall", undefined, "private"))).map((t) => t.name)).toEqual([]);
    expect(exploitTests(files(ok("testExploitReentrancy") + ok("testExploitUnauthorizedCall", undefined, "external"))).map((t) => t.name)).toEqual(["testExploitReentrancy", "testExploitUnauthorizedCall"]);
    // one name can't meet two needs (vault: access, reentrancy, inflation)
    const one = exploitTestIssues(files(ok("testExploitUnauthorizedReentrancyDonation"))).map((i) => i.message).join("\n");
    expect(one).toMatch(/testExploitReentrancy|testExploitUnauthorizedCall|testExploitDonationInflation/);
    const three = exploitTestIssues(files(ok("testExploitUnauthorizedCall") + ok("testExploitReentrancyOverdraw") + ok("testExploitDonationInflation")));
    expect(three).toEqual([]);
    // constant-only assertions
    const hollow = exploitTestIssues(files(ok("testExploitUnauthorizedCall", 'assertTrue(true, "x");') + ok("testExploitReentrancyOverdraw", 'assertEq(1, 1, "x"); assertEq(uint256(2), 2, "y");') + ok("testExploitDonationInflation", 'assertGt(2, 1, "z");')));
    expect(hollow.filter((i) => /doesn't check anything/.test(i.message)).length).toBe(3);
    // a real assertion on state passes
    expect(exploitTestIssues(files(ok("testExploitUnauthorizedCall", 'assertEq(vault.owner(), owner, "m");') + ok("testExploitReentrancyOverdraw", 'assertGt(vault.total(), before, "m");') + ok("testExploitDonationInflation", 'assertTrue(vault.shares(bob) > 0, "m");')))).toEqual([]);
  });
});
