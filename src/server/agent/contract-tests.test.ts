// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { checkContracts } from "./checks";
import { runContractTests } from "./contract-tests";

const RUN2 = readFileSync(new URL("./fixtures/rtx-run2.sol", import.meta.url), "utf8");
const FIXED = RUN2.replace("bool ok = transferFrom(from, to, amount);\n        if (!ok) revert TransferFailed();", "_transfer(from, to, amount);");

const TEST = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Actor} from "@goodbuild/Test.sol";
import {MockGoodDollar} from "@goodbuild/MockGoodDollar.sol";
import {RTX} from "../RTX.sol";

contract RTXTest is Test {
    MockGoodDollar gd;
    RTX rtx;
    Actor alice;

    function setUp() public {
        gd = new MockGoodDollar();
        rtx = new RTX(gd);
        gd.mint(address(this), 100_000e18);
        rtx.approve(address(rtx), 1_000_000e18);
        gd.approve(address(rtx), 100_000e18);
        rtx.addLiquidity(1_000_000e18, 100_000e18);
        alice = newActor();
        gd.mint(address(alice), 1_000e18);
    }

    function testBuyThenSell() public {
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(rtx), 1_000e18)));
        alice.exec(address(rtx), abi.encodeCall(rtx.buyRTX, (100e18, 1)));
        uint256 bought = rtx.balanceOf(address(alice));
        assertGt(bought, 0, "alice got RTX");
        alice.exec(address(rtx), abi.encodeCall(rtx.approve, (address(rtx), bought)));
        alice.exec(address(rtx), abi.encodeCall(rtx.sellRTX, (bought, 1)));
        assertEq(rtx.balanceOf(address(alice)), 0, "alice sold everything");
    }

    function testOneStepBuyWithTransferAndCall() public {
        alice.exec(address(gd), abi.encodeCall(gd.transferAndCall, (address(rtx), 50e18, "")));
        assertGt(rtx.balanceOf(address(alice)), 0, "one-step buy works");
    }

    function testSlippageGuard() public {
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(rtx), 1_000e18)));
        expectRevert(alice, address(rtx), abi.encodeCall(rtx.buyRTX, (100e18, type(uint256).max)), "minOut too high must revert");
    }
}
`;

describe("contract tests in a local EVM", { timeout: 120_000 }, () => {
  it("catch run 2's real bug: seeding the pool reverts on the self-allowance", async () => {
    const report = await checkContracts({ "contracts/RTX.sol": RUN2, "contracts/test/RTX.t.sol": TEST });
    expect(report.tests?.map((t) => t.name)).toEqual(["RTXTest"]);
    expect(report.contracts.map((c) => c.name)).toEqual(["RTX"]); // tests aren't deployable
    const { results, issues } = await runContractTests(report);
    expect(results).toHaveLength(3);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(issues[0].message).toMatch(/setUp\(\) failed: ERC20InsufficientAllowance\(/);
  });

  it("pass once the contract uses _transfer", async () => {
    const report = await checkContracts({ "contracts/RTX.sol": FIXED, "contracts/test/RTX.t.sol": TEST }, { gdToken: true });
    expect(report.errors).toEqual([]);
    const { results, issues } = await runContractTests(report);
    expect(issues).toEqual([]);
    expect(results.map((r) => `${r.test}:${r.ok}`)).toEqual(["testBuyThenSell:true", "testOneStepBuyWithTransferAndCall:true", "testSlippageGuard:true"]);
  });

  it("report a test that reverts with a readable assertion", async () => {
    const failing = TEST.replace('assertEq(rtx.balanceOf(address(alice)), 0, "alice sold everything");', 'assertEq(rtx.balanceOf(address(alice)), 7, "alice sold everything");');
    const report = await checkContracts({ "contracts/RTX.sol": FIXED, "contracts/test/RTX.t.sol": failing });
    const { issues } = await runContractTests(report);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/RTXTest\.testBuyThenSell failed: AssertionFailedUint\(alice sold everything, 0, 7\)/);
  });
});

describe("the test clock", { timeout: 120_000 }, () => {
  it("is a realistic timestamp, so expired deadlines can be tested", async () => {
    const test = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "@goodbuild/Test.sol";
contract ClockTest is Test {
    function testClock() public view {
        assertGt(block.timestamp, 1_600_000_000, "realistic time");
        assertTrue(block.timestamp - 1 < block.timestamp, "past deadline expressible");
    }
}
`;
    const report = await checkContracts({ "contracts/test/Clock.t.sol": test });
    expect(report.errors).toEqual([]);
    const { results } = await runContractTests(report);
    expect(results).toEqual([expect.objectContaining({ test: "testClock", ok: true })]);
  });
});

describe("native CELO in tests", { timeout: 120_000 }, () => {
  // The same shape as the tip jar the live test built: payable tip with a note, owner-only withdraw. Its AI-written tests could
  // never pass because actors couldn't send value and the test contract held no CELO.
  const JAR = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Jar {
    address public owner = msg.sender;
    uint256 public total;
    error NoTip();
    error NotOwner();
    error SendFailed();
    function tip(string calldata) external payable {
        if (msg.value == 0) revert NoTip();
        total += msg.value;
    }
    function withdraw() external {
        if (msg.sender != owner) revert NotOwner();
        (bool ok,) = owner.call{value: address(this).balance}("");
        if (!ok) revert SendFailed();
    }
}
`;
  const JAR_TEST = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test, Actor} from "@goodbuild/Test.sol";
import {Jar} from "../Jar.sol";
contract JarTest is Test {
    Jar jar;
    receive() external payable {}
    function setUp() public { jar = new Jar(); }
    function testActorTipsWithValue() public {
        Actor alice = newActor();
        fund(alice, 1 ether);
        alice.execValue(address(jar), abi.encodeCall(jar.tip, ("hi")), 0.25 ether);
        assertEq(jar.total(), 0.25 ether, "tip recorded");
        assertEq(address(jar).balance, 0.25 ether, "jar holds it");
    }
    function testEmptyTipReverts() public {
        Actor alice = newActor();
        expectRevertValue(alice, address(jar), abi.encodeCall(jar.tip, ("x")), 0, "no value must revert");
    }
    function testOwnerWithdraws() public {
        jar.tip{value: 1 ether}("mine");
        uint256 before = address(this).balance;
        jar.withdraw();
        assertEq(address(this).balance, before + 1 ether, "owner got the jar");
    }
    function testStrangerCannotWithdraw() public {
        Actor bob = newActor();
        jar.tip{value: 1 ether}("x");
        expectRevert(bob, address(jar), abi.encodeCall(jar.withdraw, ()), "only the owner");
    }
}
`;
  it("lets a payable contract be tested: the test contract holds CELO, actors can be funded and send value", async () => {
    const report = await checkContracts({ "contracts/Jar.sol": JAR, "contracts/test/Jar.t.sol": JAR_TEST });
    expect(report.errors).toEqual([]);
    const { results, issues } = await runContractTests(report);
    expect(issues).toEqual([]);
    expect(results.map((r) => `${r.test}:${r.ok}`).sort()).toEqual(["testActorTipsWithValue:true", "testEmptyTipReverts:true", "testOwnerWithdraws:true", "testStrangerCannotWithdraw:true"]);
  });
});
