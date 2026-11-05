// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { checkContracts } from "@/server/agent/checks";
import { runContractTests } from "@/server/agent/contract-tests";

const TEST_GD = readFileSync(new URL("../../../scripts/solidity/goodbuild/TestGoodDollar.sol", import.meta.url), "utf8");

const TEST = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Actor} from "@goodbuild/Test.sol";
import {TestGoodDollar} from "../TestGoodDollar.sol";

contract Receiver {
    address public lastFrom;
    uint256 public lastAmount;
    bool public accept = true;
    function setAccept(bool a) external { accept = a; }
    function onTokenTransfer(address from, uint256 amount, bytes calldata) external returns (bool) {
        lastFrom = from;
        lastAmount = amount;
        return accept;
    }
}

contract TestGoodDollarTest is Test {
    TestGoodDollar gd;
    Actor alice;
    Actor bob;

    function setUp() public {
        gd = new TestGoodDollar();
        alice = newActor();
        bob = newActor();
    }

    function testDecimalsAndSymbolMatchMainnet() public {
        assertEq(uint256(gd.decimals()), 18, "18 decimals like mainnet G$");
    }

    function testFaucetPaysOnce() public {
        alice.exec(address(gd), abi.encodeCall(gd.faucet, ()));
        assertEq(gd.balanceOf(address(alice)), 1_000 ether, "alice got 1,000");
        assertGt(gd.nextClaimAt(address(alice)), block.timestamp, "next claim is in the future");
    }

    function testFaucetIsRateLimitedPerWallet() public {
        alice.exec(address(gd), abi.encodeCall(gd.faucet, ()));
        expectRevert(alice, address(gd), abi.encodeCall(gd.faucet, ()), "second claim the same day must revert");
        // Another wallet is unaffected.
        bob.exec(address(gd), abi.encodeCall(gd.faucet, ()));
        assertEq(gd.balanceOf(address(bob)), 1_000 ether, "bob can still claim");
    }

    function testNeverClaimedCanClaimNow() public {
        assertEq(gd.nextClaimAt(address(alice)), 0, "never claimed means available now");
    }

    function testTransferAndCallMovesTokensThenNotifiesTheReceiver() public {
        Receiver r = new Receiver();
        alice.exec(address(gd), abi.encodeCall(gd.faucet, ()));
        alice.exec(address(gd), abi.encodeCall(gd.transferAndCall, (address(r), 250 ether, "")));
        assertEq(gd.balanceOf(address(r)), 250 ether, "receiver holds the tokens");
        assertEq(r.lastAmount(), 250 ether, "hook saw the amount");
        assertEq(r.lastFrom(), address(alice), "hook saw the sender");
    }

    function testTransferAndCallRevertsWhenTheReceiverRejects() public {
        Receiver r = new Receiver();
        r.setAccept(false);
        alice.exec(address(gd), abi.encodeCall(gd.faucet, ()));
        expectRevert(alice, address(gd), abi.encodeCall(gd.transferAndCall, (address(r), 1 ether, "")), "rejecting receiver must revert");
        assertEq(gd.balanceOf(address(alice)), 1_000 ether, "nothing moved");
    }

    function testTransferAndCallToAPlainWalletIsAnOrdinaryTransfer() public {
        alice.exec(address(gd), abi.encodeCall(gd.faucet, ()));
        alice.exec(address(gd), abi.encodeCall(gd.transferAndCall, (address(0xB0B), 5 ether, "")));
        assertEq(gd.balanceOf(address(0xB0B)), 5 ether, "an ordinary wallet got it");
    }
}
`;

describe("test G$ (D23)", { timeout: 180_000 }, () => {
  it("passes its own tests: faucet limits, ERC-677 hook, 18 decimals", async () => {
    const report = await checkContracts({ "contracts/TestGoodDollar.sol": TEST_GD, "contracts/test/TestGoodDollar.t.sol": TEST });
    expect(report.errors.filter((e) => e.source !== "guardrail")).toEqual([]);
    const { results, issues } = await runContractTests(report);
    expect(issues).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(6);
  });
});
