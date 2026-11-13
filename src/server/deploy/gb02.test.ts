// @vitest-environment node
// GB-02 (Daybreak Blue review): a G$ pool whose entry and exit are joinPool / exitPool, with no kit marker,
// must still get GoodBuild's mainnet checks, and recording on mainnet must require code that passed them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Hex, PublicClient } from "viem";

import { checkContracts } from "@/server/agent/checks";
import { custodyOf } from "@/server/agent/custody";
import { kitIdsOf } from "@/server/agent/kits";
import { saveFiles } from "@/server/agent/store";
import { contractModule, starterFiles } from "@/server/agent/template";
import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { deployReviews } from "@/server/db/deploy-schema";
import { createProjectFromPrompt } from "@/server/projects";
import { setMainnetMode } from "@/server/settings/mainnet-access";
import { compileForDeploy } from "./compile";
import { prepareDeploy, recordDeployment } from "./service";

const HEADER = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";
const POOL = (extra = "") =>
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
${extra}}
`;
// The prohibited operation: an owner "rescue" that runs arbitrary code in the pool's context.
const DELEGATECALL = `
    function rescue(address target, bytes calldata data) external onlyOwner {
        (bool ok, ) = target.delegatecall(data);
        if (!ok) revert TransferFailed();
    }
`;
const TESTS =
  HEADER +
  `import {Test, Actor} from "@goodbuild/Test.sol";
import {MockGoodDollar} from "@goodbuild/MockGoodDollar.sol";
import {GoodPool} from "../GoodPool.sol";

contract GoodPoolTest is Test {
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

    function testJoinAndExit() public {
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(pool), 100e18)));
        alice.exec(address(pool), abi.encodeCall(pool.joinPool, (100e18)));
        alice.exec(address(pool), abi.encodeCall(pool.exitPool, (100e18)));
        assertEq(gd.balanceOf(address(alice)), 1_000e18, "alice got everything back");
    }

    function testExploitUnauthorizedCall() public {
        expectRevert(mallory, address(pool), abi.encodeCall(pool.setFee, (1)), "a stranger can't set the fee");
    }

    function testExploitReentrancyOverdraw() public {
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(pool), 100e18)));
        alice.exec(address(pool), abi.encodeCall(pool.joinPool, (100e18)));
        expectRevert(mallory, address(pool), abi.encodeCall(pool.exitPool, (1)), "mallory can't take alice's G$");
    }
}
`;
const MANIFEST = JSON.stringify({ contracts: [{ name: "GoodPool", args: { gd_: "${GOODDOLLAR}" } }] });
const WALLET = "0x7a3000000000000000000000000000000000e41c";

let db: Db;
let userId: string;
let projectId: string;

async function useFiles(contracts: Record<string, string>) {
  const files = { ...starterFiles(), ...contracts, "contracts/deploy.json": MANIFEST, "src/contracts/GoodPool.ts": contractModule("GoodPool", []) };
  expect(kitIdsOf(files)).toEqual([]); // no DAOs-and-vaults kit marker
  await saveFiles(db, projectId, files);
}

beforeEach(async () => {
  vi.stubEnv("MAINNET_DEFAULT_MODE", "everyone");
  process.env.NEXT_PUBLIC_TEST_GD_ADDRESS = "0x00000000000000000000000000000000000000d1";
  db = await createTestDb();
  const user = await signInUser(db, { wallet: WALLET, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  projectId = (await createProjectFromPrompt(db, userId, { prompt: "a G$ savings pool", network: "celo" })).id;
  await setMainnetMode(db, "everyone", null);
});

describe("GB-02: money-holding contracts outside the vault/DAO names", { timeout: 180_000 }, () => {
  it("refuses a joinPool/exitPool G$ pool with a prohibited operation at mainnet prepare, with no kit marker", async () => {
    await useFiles({ "contracts/GoodPool.sol": POOL(DELEGATECALL), "contracts/test/GoodPool.t.sol": TESTS });
    await expect(prepareDeploy(db, { projectId, chainId: 42220, wallet: WALLET, ownerReviewed: true })).rejects.toMatchObject({ details: expect.arrayContaining([expect.stringMatching(/delegatecall/)]) });
    // Testnet too: the deploy compile itself now refuses it, not only the builder's loop.
    await expect(prepareDeploy(db, { projectId, chainId: 11142220, wallet: WALLET })).rejects.toMatchObject({ code: "compile_failed", details: [expect.stringMatching(/GoodPool\.sol:\d+: delegatecall isn't allowed/)] });
  });

  it("refuses the same pool without exploit tests, naming the two it needs", async () => {
    await useFiles({ "contracts/GoodPool.sol": POOL() });
    const refused = prepareDeploy(db, { projectId, chainId: 42220, wallet: WALLET, ownerReviewed: true });
    await expect(refused).rejects.toMatchObject({ code: "exploit_tests_failed" });
    const details = ((await refused.catch((e: { details: string[] }) => e)) as { details: string[] }).details.join("\n");
    expect(details).toMatch(/testExploitUnauthorizedCall/);
    expect(details).toMatch(/testExploitReentrancy/);
  });

  it("with passing tests, still needs the owner's review on mainnet, then records an audit row", async () => {
    await useFiles({ "contracts/GoodPool.sol": POOL(), "contracts/test/GoodPool.t.sol": TESTS });
    await expect(prepareDeploy(db, { projectId, chainId: 42220, wallet: WALLET })).rejects.toMatchObject({
      code: "needs_owner_review",
      details: expect.arrayContaining([expect.stringMatching(/GoodPool\.joinPool pulls tokens in with transferFrom/)]),
    });
    const plan = await prepareDeploy(db, { projectId, chainId: 42220, wallet: WALLET, ownerReviewed: true });
    const [row] = await db.select().from(deployReviews).where(and(eq(deployReviews.projectId, projectId), eq(deployReviews.sourceHash, plan.sourceHash)));
    expect(row).toMatchObject({ chainId: 42220, exploitTests: "passed", wallet: WALLET });
    expect(row.ownerReviewedAt).toBeInstanceOf(Date);
    expect(row.custody.join("\n")).toMatch(/joinPool/);
    // Sepolia is for trying things: no review there.
    await expect(prepareDeploy(db, { projectId, chainId: 11142220, wallet: WALLET })).resolves.toBeDefined();
  });

  it("won't record a mainnet deployment of code that never passed the mainnet checks", async () => {
    await useFiles({ "contracts/GoodPool.sol": POOL(), "contracts/test/GoodPool.t.sol": TESTS });
    // Compiled and deployed around GoodBuild: same code, no prepare on mainnet.
    const compiled = await compileForDeploy(await import("@/server/agent/store").then((m) => m.loadFiles(db, projectId)));
    if (!compiled.ok) throw new Error(compiled.errors.join("\n"));
    const pool = compiled.artifacts.find((a) => a.name === "GoodPool")!;
    const client = {
      waitForTransactionReceipt: async () => ({ status: "success", contractAddress: "0x1111111111111111111111111111111111111111", blockNumber: BigInt(1) }),
      getTransactionReceipt: async () => ({ status: "success", contractAddress: "0x1111111111111111111111111111111111111111", blockNumber: BigInt(1) }),
      getTransaction: async () => ({ from: WALLET, to: null, input: pool.bytecode }),
    } as unknown as PublicClient;
    const input = { projectId, userId, wallet: WALLET, runId: "r1", chainId: 42220, contractName: "GoodPool", txHash: ("0x" + "cd".repeat(32)) as Hex, sourceHash: compiled.sourceHash as Hex, evmVersion: compiled.evmVersion };
    // The record step runs the gate itself, and this pool needs the owner's review, so it is refused.
    await expect(recordDeployment(db, input, { client })).rejects.toMatchObject({ code: "not_reviewed" });
    // After the real prepare (gate, tests, owner review) the same transaction records.
    await prepareDeploy(db, { projectId, chainId: 42220, wallet: WALLET, ownerReviewed: true });
    await expect(recordDeployment(db, input, { client })).resolves.toMatchObject({ address: "0x1111111111111111111111111111111111111111" });
  });

  it("records code with no passed prepare when the gate, run at record time, passes and needs no review", async () => {
    await useFiles({ "contracts/GoodPool.sol": HEADER + "contract GoodPool { uint256 public n; constructor(address gd_) { gd_; } function inc() external { n++; } }" });
    const compiled = await compileForDeploy(await import("@/server/agent/store").then((m) => m.loadFiles(db, projectId)));
    if (!compiled.ok) throw new Error(compiled.errors.join("\n"));
    const bytecode = compiled.artifacts[0].bytecode;
    const client = {
      waitForTransactionReceipt: async () => ({ status: "success", contractAddress: "0x2222222222222222222222222222222222222222", blockNumber: BigInt(1) }),
      getTransactionReceipt: async () => ({ status: "success", contractAddress: "0x2222222222222222222222222222222222222222", blockNumber: BigInt(1) }),
      getTransaction: async () => ({ from: WALLET, to: null, input: bytecode + "0".repeat(64) }),
    } as unknown as PublicClient;
    const input = { projectId, userId, wallet: WALLET, runId: "r2", chainId: 42220, contractName: "GoodPool", txHash: ("0x" + "ef".repeat(32)) as Hex, sourceHash: compiled.sourceHash as Hex, evmVersion: compiled.evmVersion };
    await expect(recordDeployment(db, input, { client })).resolves.toMatchObject({ address: "0x2222222222222222222222222222222222222222" });
    const [row] = await db.select().from(deployReviews).where(eq(deployReviews.sourceHash, compiled.sourceHash));
    expect(row).toMatchObject({ exploitTests: "not_required", ownerReviewedAt: null });
  });

  it("code that holds nobody's money needs no tests or review, and still gets an audit row so it can be recorded", async () => {
    await useFiles({ "contracts/GoodPool.sol": HEADER + "contract GoodPool { uint256 public n; constructor(address gd_) { gd_; } function inc() external { n++; } }" });
    const plan = await prepareDeploy(db, { projectId, chainId: 42220, wallet: WALLET });
    const [row] = await db.select().from(deployReviews).where(eq(deployReviews.sourceHash, plan.sourceHash));
    expect(row).toMatchObject({ exploitTests: "not_required", custody: [], ownerReviewedAt: null });
  });
});

describe("deploy-time guardrails", { timeout: 60_000 }, () => {
  it("block the security rules but not house style, so a safe older contract with require strings still deploys", async () => {
    const tidy = await compileForDeploy({ "contracts/Old.sol": HEADER + 'contract Old { uint256 public n; function set(uint256 v) external { require(v < 10, "too big"); n = v; } }' });
    expect(tidy.ok).toBe(true);
    for (const bad of ["function f() external { selfdestruct(payable(msg.sender)); }", "function f() external view returns (address) { return tx.origin; }", "function f() external { assembly { sstore(0, 1) } }", 'function f(address t) external { (bool ok, ) = t.call(abi.encodeWithSignature("x()")); ok; }']) {
      const out = await compileForDeploy({ "contracts/Bad.sol": HEADER + `contract Bad { ${bad} }` });
      expect(out.ok, bad).toBe(false);
    }
  });
});

describe("custodyOf", { timeout: 60_000 }, () => {
  const custody = async (body: string, imports = "") => {
    const r = await checkContracts({ "contracts/C.sol": HEADER + imports + body });
    return (r.custody ?? []).map((c) => `${c.contract}.${c.fn}: ${c.how}`);
  };
  const IERC20 = 'import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";\n';

  it("finds every way money comes in, whatever the function is called", async () => {
    expect(await custody("contract C { function chipIn() external payable {} }")).toEqual(["C.chipIn: accepts CELO (payable)"]);
    expect(await custody("contract C { receive() external payable {} }")).toEqual(["C.receive: receives CELO sent to the contract"]);
    expect(await custody("contract C { fallback() external payable {} }")).toEqual(["C.fallback: accepts CELO in its fallback"]);
    expect(await custody("contract C { IERC20 t; function joinPool(uint256 a) external { t.transferFrom(msg.sender, address(this), a); } }", IERC20)).toEqual(["C.joinPool: pulls tokens in with transferFrom"]);
    expect(await custody("contract C { function onTokenTransfer(address, uint256, bytes calldata) external returns (bool) { return true; } }")).toEqual(["C.onTokenTransfer: is called when tokens are sent to the contract"]);
    expect(await custody('import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";\ncontract C is ERC4626 { constructor(IERC20 a) ERC20("s", "s") ERC4626(a) {} }')).toEqual(["C.contract: is an ERC4626 vault that takes deposits"]);
  });

  it("ignores a payable constructor, a token's own super.transferFrom, comments and names", async () => {
    expect(await custody("contract C { constructor() payable {} }")).toEqual([]);
    expect(await custody('import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";\ncontract C is ERC20 { constructor() ERC20("t", "t") {} function transferFrom(address f, address t, uint256 v) public override returns (bool) { return super.transferFrom(f, t, v); } }')).toEqual([]);
    expect(await custody("// function deposit() function withdraw()\ncontract C { function deposit() external {} function withdraw() external {} }")).toEqual([]);
  });

  it("custodyOf reads an AST directly", () => {
    expect(custodyOf([])).toEqual([]);
  });
});
