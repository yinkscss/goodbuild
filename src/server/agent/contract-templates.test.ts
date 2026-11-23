// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkContracts, pathProblem, runSolc } from "./checks";
import { TEMPLATES, TEMPLATE_DIR, templateById, templateFiles, templatesBrief, templatesFor, type TemplateId } from "./contract-templates";
import { runContractTests } from "./contract-tests";
import { parseSpec } from "./spec";

const PRAGMA = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";
const TEST_HEAD = `${PRAGMA}import {Test, Actor} from "@goodbuild/Test.sol";\nimport {MockGoodDollar} from "@goodbuild/MockGoodDollar.sol";\n`;

/** A builder-style child contract and its tests, the way the guide tells DeepSeek to write them. */
const CASES: Record<TemplateId, { files: Record<string, string>; tests: string[] }> = {
  token: {
    files: {
      "contracts/RTXToken.sol": `${PRAGMA}import {GoodToken} from "./goodbuild/GoodToken.sol";
contract RTXToken is GoodToken {
    constructor() GoodToken("Rotex", "RTX", 50_000_000e18, msg.sender) {}
}`,
      "contracts/test/RTXToken.t.sol": `${TEST_HEAD}import {RTXToken} from "../RTXToken.sol";
contract RTXTokenTest is Test {
    RTXToken rtx;
    Actor alice;
    function setUp() public { rtx = new RTXToken(); alice = newActor(); }
    function testSupplyToDeployer() public { assertEq(rtx.balanceOf(address(this)), 50_000_000e18, "all minted to the deployer"); assertEq(rtx.totalSupply(), 50_000_000e18, "fixed supply"); }
    function testTransferAndBurn() public {
        rtx.transfer(address(alice), 100e18);
        alice.exec(address(rtx), abi.encodeCall(rtx.burn, (40e18)));
        assertEq(rtx.balanceOf(address(alice)), 60e18, "alice burnt her own");
        assertEq(rtx.totalSupply(), 50_000_000e18 - 40e18, "supply went down");
    }
    function testCannotSpendOthers() public { expectRevert(alice, address(rtx), abi.encodeCall(rtx.transferFrom, (address(this), address(alice), 1e18)), "no allowance"); }
}`,
    },
    tests: ["testSupplyToDeployer", "testTransferAndBurn", "testCannotSpendOthers"],
  },
  nft: {
    files: {
      "contracts/CityPass.sol": `${PRAGMA}import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GoodNFT} from "./goodbuild/GoodNFT.sol";
contract CityPass is GoodNFT {
    constructor(IERC20 gd_) GoodNFT("City Pass", "PASS", gd_, 10e18, 3, 2, "https://example.org/pass/", msg.sender) {}
}`,
      "contracts/test/CityPass.t.sol": `${TEST_HEAD}import {CityPass} from "../CityPass.sol";
contract CityPassTest is Test {
    MockGoodDollar gd;
    CityPass pass;
    Actor alice;
    Actor bob;
    function setUp() public {
        gd = new MockGoodDollar(); pass = new CityPass(gd); alice = newActor(); bob = newActor();
        gd.mint(address(alice), 100e18); gd.mint(address(bob), 100e18);
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(pass), 100e18)));
        bob.exec(address(gd), abi.encodeCall(gd.approve, (address(pass), 100e18)));
    }
    function testPaidMint() public {
        alice.exec(address(pass), abi.encodeCall(pass.mint, ()));
        assertEq(pass.ownerOf(1), address(alice), "alice owns #1");
        assertEq(gd.balanceOf(address(pass)), 10e18, "price paid");
    }
    function testWalletLimitAndSoldOut() public {
        alice.exec(address(pass), abi.encodeCall(pass.mint, ()));
        alice.exec(address(pass), abi.encodeCall(pass.mint, ()));
        expectRevert(alice, address(pass), abi.encodeCall(pass.mint, ()), "two per wallet");
        bob.exec(address(pass), abi.encodeCall(pass.mint, ()));
        expectRevert(bob, address(pass), abi.encodeCall(pass.mint, ()), "sold out at 3");
    }
    function testOnlyOwnerWithdraws() public {
        alice.exec(address(pass), abi.encodeCall(pass.mint, ()));
        expectRevert(alice, address(pass), abi.encodeCall(pass.withdraw, (address(alice))), "stranger can't withdraw");
        pass.withdraw(address(bob));
        assertEq(gd.balanceOf(address(bob)), 110e18, "owner sent the takings");
    }
}`,
    },
    tests: ["testPaidMint", "testWalletLimitAndSoldOut", "testOnlyOwnerWithdraws"],
  },
  staking: {
    files: {
      "contracts/GDStaking.sol": `${PRAGMA}import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GoodStaking} from "./goodbuild/GoodStaking.sol";
contract GDStaking is GoodStaking {
    constructor(IERC20 gd_) GoodStaking(gd_, gd_, 30 days, msg.sender) {}
}`,
      "contracts/test/GDStaking.t.sol": `${TEST_HEAD}import {GDStaking} from "../GDStaking.sol";
contract GDStakingTest is Test {
    MockGoodDollar gd;
    GDStaking staking;
    Actor alice;
    function setUp() public {
        gd = new MockGoodDollar(); staking = new GDStaking(gd); alice = newActor();
        gd.mint(address(alice), 1_000e18); gd.mint(address(this), 1_000_000e18);
    }
    function testStakeWithdraw() public {
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(staking), 100e18)));
        alice.exec(address(staking), abi.encodeCall(staking.stake, (100e18)));
        assertEq(staking.stakedOf(address(alice)), 100e18, "staked");
        alice.exec(address(staking), abi.encodeCall(staking.withdraw, (100e18)));
        assertEq(gd.balanceOf(address(alice)), 1_000e18, "all back");
    }
    function testOneStepStake() public {
        alice.exec(address(gd), abi.encodeCall(gd.transferAndCall, (address(staking), 50e18, "")));
        assertEq(staking.stakedOf(address(alice)), 50e18, "transferAndCall staked");
    }
    function testFundingIsOwnerOnlyAndCannotUseStakes() public {
        alice.exec(address(gd), abi.encodeCall(gd.transferAndCall, (address(staking), 500e18, "")));
        expectRevert(alice, address(staking), abi.encodeCall(staking.notifyRewardAmount, (1e18)), "stranger can't fund");
        gd.approve(address(staking), 30_000e18);
        staking.notifyRewardAmount(30_000e18);
        assertGt(staking.rewardRate(), 0, "rate set");
        assertEq(staking.totalStaked(), 500e18, "stakes untouched");
    }
    function testExploitDonationAndStrangers() public {
        Actor mallory = newActor();
        gd.mint(address(mallory), 100e18);
        alice.exec(address(gd), abi.encodeCall(gd.transferAndCall, (address(staking), 10e18, "")));
        mallory.exec(address(gd), abi.encodeCall(gd.transfer, (address(staking), 100e18)));
        expectRevert(mallory, address(staking), abi.encodeCall(staking.withdraw, (1)), "a donation isn't a stake");
        expectRevert(mallory, address(staking), abi.encodeCall(staking.setDuration, (1)), "stranger can't change the period");
        assertEq(staking.totalStaked(), 10e18, "only real stakes count");
    }
    function testCannotWithdrawMoreThanStaked() public {
        alice.exec(address(gd), abi.encodeCall(gd.transferAndCall, (address(staking), 10e18, "")));
        expectRevert(alice, address(staking), abi.encodeCall(staking.withdraw, (11e18)), "only your own stake");
    }
}`,
    },
    tests: ["testStakeWithdraw", "testOneStepStake", "testFundingIsOwnerOnlyAndCannotUseStakes", "testCannotWithdrawMoreThanStaked", "testExploitDonationAndStrangers"],
  },
  escrow: {
    files: {
      "contracts/GigEscrow.sol": `${PRAGMA}import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GoodEscrow} from "./goodbuild/GoodEscrow.sol";
contract GigEscrow is GoodEscrow {
    constructor(IERC20 gd_) GoodEscrow(gd_) {}
}`,
      "contracts/test/GigEscrow.t.sol": `${TEST_HEAD}import {GigEscrow} from "../GigEscrow.sol";
contract GigEscrowTest is Test {
    MockGoodDollar gd;
    GigEscrow escrow;
    Actor payer;
    Actor payee;
    Actor judge;
    Actor mallory;
    function setUp() public {
        gd = new MockGoodDollar(); escrow = new GigEscrow(gd);
        payer = newActor(); payee = newActor(); judge = newActor(); mallory = newActor();
        gd.mint(address(payer), 100e18);
        payer.exec(address(gd), abi.encodeCall(gd.approve, (address(escrow), 100e18)));
        payer.exec(address(escrow), abi.encodeCall(escrow.createDeal, (address(payee), address(judge), 40e18, uint64(block.timestamp + 600))));
    }
    function testRelease() public {
        expectRevert(mallory, address(escrow), abi.encodeCall(escrow.release, (1)), "stranger can't release");
        payer.exec(address(escrow), abi.encodeCall(escrow.release, (1)));
        assertEq(gd.balanceOf(address(payee)), 40e18, "payee paid");
        expectRevert(payer, address(escrow), abi.encodeCall(escrow.release, (1)), "no double release");
    }
    function testExploitPayeeAndStrangers() public {
        expectRevert(payee, address(escrow), abi.encodeCall(escrow.release, (1)), "payee can't pay itself");
        expectRevert(mallory, address(escrow), abi.encodeCall(escrow.refund, (1)), "stranger can't refund");
        payee.exec(address(escrow), abi.encodeCall(escrow.refund, (1)));
        expectRevert(payer, address(escrow), abi.encodeCall(escrow.release, (1)), "a refunded deal can't be released");
        assertEq(gd.balanceOf(address(escrow)), 0, "nothing left behind");
    }
    function testArbiterRefund() public {
        expectRevert(payer, address(escrow), abi.encodeCall(escrow.refund, (1)), "payer waits for the deadline");
        judge.exec(address(escrow), abi.encodeCall(escrow.refund, (1)));
        assertEq(gd.balanceOf(address(payer)), 100e18, "payer refunded");
    }
}`,
    },
    tests: ["testRelease", "testArbiterRefund", "testExploitPayeeAndStrangers"],
  },
  vesting: {
    files: {
      "contracts/TeamVesting.sol": `${PRAGMA}import {GoodVesting} from "./goodbuild/GoodVesting.sol";
contract TeamVesting is GoodVesting {
    constructor(address beneficiary_) GoodVesting(beneficiary_, uint64(block.timestamp), 365 days, 90 days) {}
}`,
      "contracts/test/TeamVesting.t.sol": `${TEST_HEAD}import {TeamVesting} from "../TeamVesting.sol";
contract TeamVestingTest is Test {
    MockGoodDollar gd;
    TeamVesting vesting;
    Actor alice;
    function setUp() public { gd = new MockGoodDollar(); alice = newActor(); vesting = new TeamVesting(address(alice)); gd.mint(address(vesting), 1_000e18); }
    function testNothingBeforeCliff() public {
        assertEq(vesting.releasable(address(gd)), 0, "locked before the cliff");
        assertEq(vesting.vestedAmount(address(gd), uint64(block.timestamp + 89 days)), 0, "still locked at 89 days");
    }
    function testVestsAfterCliffAndAll() public {
        assertGt(vesting.vestedAmount(address(gd), uint64(block.timestamp + 180 days)), 0, "some after the cliff");
        assertEq(vesting.vestedAmount(address(gd), uint64(block.timestamp + 365 days)), 1_000e18, "all at the end");
        assertEq(vesting.owner(), address(alice), "alice is the beneficiary");
    }
}`,
    },
    tests: ["testNothingBeforeCliff", "testVestsAfterCliffAndAll"],
  },
  governance: {
    files: {
      "contracts/ClubToken.sol": `${PRAGMA}import {GoodVotesToken} from "./goodbuild/GoodVotesToken.sol";
contract ClubToken is GoodVotesToken {
    constructor() GoodVotesToken("Club Vote", "CLUB", 1_000_000e18, msg.sender) {}
}`,
      "contracts/ClubDAO.sol": `${PRAGMA}import {GoodGovernor} from "./goodbuild/GoodGovernor.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
contract ClubDAO is GoodGovernor {
    constructor(IVotes token_) GoodGovernor("Club DAO", token_, 1, 3 days, 0, 4) {}
}`,
      "contracts/test/ClubDAO.t.sol": `${TEST_HEAD}import {ClubToken} from "../ClubToken.sol";
import {ClubDAO} from "../ClubDAO.sol";
contract ClubDAOTest is Test {
    ClubToken token;
    ClubDAO dao;
    Actor alice;
    function setUp() public { token = new ClubToken(); dao = new ClubDAO(token); alice = newActor(); token.transfer(address(alice), 100_000e18); }
    function testDelegateGivesVotes() public {
        alice.exec(address(token), abi.encodeCall(token.delegate, (address(alice))));
        assertEq(token.getVotes(address(alice)), 100_000e18, "votes after delegating");
        assertEq(token.getVotes(address(this)), 0, "no votes without delegating");
    }
    function testProposeAndEarlyVoteFails() public {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory data = new bytes[](1);
        targets[0] = address(token);
        data[0] = abi.encodeCall(token.transfer, (address(alice), 1e18));
        uint256 id = dao.propose(targets, values, data, "Pay alice");
        assertEq(uint256(dao.state(id)), 0, "pending until the delay passes");
        expectRevert(alice, address(dao), abi.encodeCall(dao.castVote, (id, 1)), "can't vote before it opens");
    }
}`,
    },
    tests: ["testDelegateGivesVotes", "testProposeAndEarlyVoteFails"],
  },
  poll: {
    files: {
      "contracts/ClassPoll.sol": `${PRAGMA}import {GoodPoll} from "./goodbuild/GoodPoll.sol";
contract ClassPoll is GoodPoll {
    constructor() GoodPoll(false, msg.sender) {}
}`,
      "contracts/test/ClassPoll.t.sol": `${TEST_HEAD}import {ClassPoll} from "../ClassPoll.sol";
contract ClassPollTest is Test {
    ClassPoll poll;
    Actor alice;
    Actor bob;
    function setUp() public { poll = new ClassPoll(); alice = newActor(); bob = newActor(); poll.createPoll("Lunch?", 3, uint64(block.timestamp + 600)); }
    function testOneVoteEach() public {
        alice.exec(address(poll), abi.encodeCall(poll.vote, (1, 2)));
        bob.exec(address(poll), abi.encodeCall(poll.vote, (1, 2)));
        expectRevert(alice, address(poll), abi.encodeCall(poll.vote, (1, 0)), "no second vote");
        assertEq(poll.results(1)[2], 2, "two votes for choice 2");
        assertTrue(poll.choiceOf(1, address(alice)) == 2, "alice chose 2");
    }
    function testOnlyOwnerCreatesAndBadChoice() public {
        expectRevert(alice, address(poll), abi.encodeCall(poll.createPoll, ("Mine", 2, uint64(block.timestamp + 600))), "owner only");
        expectRevert(alice, address(poll), abi.encodeCall(poll.vote, (1, 3)), "choice out of range");
    }
}`,
    },
    tests: ["testOneVoteEach", "testOnlyOwnerCreatesAndBadChoice"],
  },
  savings: {
    files: {
      "contracts/GoalSavings.sol": `${PRAGMA}import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GoodSavings} from "./goodbuild/GoodSavings.sol";
contract GoalSavings is GoodSavings {
    constructor(IERC20 gd_) GoodSavings(gd_) {}
}`,
      "contracts/test/GoalSavings.t.sol": `${TEST_HEAD}import {GoalSavings} from "../GoalSavings.sol";
contract GoalSavingsTest is Test {
    MockGoodDollar gd;
    GoalSavings savings;
    Actor alice;
    Actor bob;
    function setUp() public {
        gd = new MockGoodDollar(); savings = new GoalSavings(gd); alice = newActor(); bob = newActor();
        gd.mint(address(alice), 100e18); gd.mint(address(bob), 100e18);
        alice.exec(address(savings), abi.encodeCall(savings.createGoal, ("Bike", 50e18, 0)));
        alice.exec(address(savings), abi.encodeCall(savings.createGoal, ("Rent", 0, uint64(block.timestamp + 600))));
    }
    function testDepositBothWaysAndWithdraw() public {
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(savings), 20e18)));
        alice.exec(address(savings), abi.encodeCall(savings.deposit, (1, 20e18)));
        bob.exec(address(gd), abi.encodeCall(gd.transferAndCall, (address(savings), 5e18, abi.encode(uint256(1)))));
        assertEq(savings.getGoal(1).saved, 25e18, "saved from both");
        alice.exec(address(savings), abi.encodeCall(savings.withdraw, (1, 25e18)));
        assertEq(gd.balanceOf(address(alice)), 105e18, "alice took it out");
    }
    function testExploitDonationAndOverdraw() public {
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(savings), 1e18)));
        alice.exec(address(savings), abi.encodeCall(savings.deposit, (1, 1e18)));
        bob.exec(address(gd), abi.encodeCall(gd.transfer, (address(savings), 50e18)));
        expectRevert(alice, address(savings), abi.encodeCall(savings.withdraw, (1, 2e18)), "a gift sent straight to the contract can't be withdrawn as savings");
        assertEq(savings.getGoal(1).saved, 1e18, "accounting ignores the donation");
    }
    function testOnlyOwnerAndLock() public {
        bob.exec(address(gd), abi.encodeCall(gd.transferAndCall, (address(savings), 5e18, abi.encode(uint256(2)))));
        expectRevert(bob, address(savings), abi.encodeCall(savings.withdraw, (2, 5e18)), "not bob's goal");
        expectRevert(alice, address(savings), abi.encodeCall(savings.withdraw, (2, 5e18)), "still locked");
    }
}`,
    },
    tests: ["testDepositBothWaysAndWithdraw", "testOnlyOwnerAndLock", "testExploitDonationAndOverdraw"],
  },
};

describe("GoodBuild's contract templates (D165)", { timeout: 240_000 }, () => {
  it("cover every template id", () => {
    expect(Object.keys(CASES).sort()).toEqual(TEMPLATES.map((t) => t.id).sort());
  });

  for (const t of TEMPLATES) {
    it(`${t.id}: a child contract compiles under GoodBuild's checks and its tests pass in a local EVM`, async () => {
      const files = { ...templateFiles(t), ...CASES[t.id].files };
      const report = await checkContracts(files, { gdToken: false });
      expect(report.errors).toEqual([]);
      // The template is abstract: only the builder's contract is deployable.
      expect(report.contracts.every((c) => !c.file.startsWith(TEMPLATE_DIR))).toBe(true);
      expect(report.contracts.every((c) => c.bytecodeBytes < 24_576 * 2)).toBe(true);
      const { results, issues } = await runContractTests(report);
      expect(issues).toEqual([]);
      expect(results.filter((r) => r.ok).map((r) => r.test).sort()).toEqual([...CASES[t.id].tests].sort());
    });
  }

  it("guard every function that moves tokens against re-entry", () => {
    const moves = /\bfunction\s+(\w+)\s*\([^)]*\)[^{;]*\{([\s\S]*?)\n {4}\}/g;
    for (const t of TEMPLATES) {
      for (const [file, source] of Object.entries(t.files)) {
        for (const m of source.matchAll(moves)) {
          const [header, name, body] = [m[0].slice(0, m[0].indexOf("{")), m[1], m[2]];
          if (!/safeTransfer(From)?\(|_mint\(/.test(body) || /\b(constructor|private|internal)\b/.test(header)) continue;
          // exit() only calls withdraw() and claim(), which are guarded.
          if (name === "exit") continue;
          expect(`${file} ${name}: ${/\bnonReentrant\b/.test(header)}`).toBe(`${file} ${name}: true`);
        }
      }
    }
  });

  it("compile with the older OpenZeppelin the paris fallback uses", async () => {
    const files = Object.assign({}, ...TEMPLATES.map((t) => ({ ...templateFiles(t), ...Object.fromEntries(Object.entries(CASES[t.id].files).filter(([p]) => !p.includes("/test/"))) })));
    const { output } = await runSolc(files, 120_000, { legacyOpenZeppelin: true, evmVersion: "paris" });
    expect((output.errors ?? []).filter((e) => e.severity === "error").map((e) => e.formattedMessage ?? e.message)).toEqual([]);
    expect(Object.keys(output.contracts ?? {})).toEqual(expect.arrayContaining(Object.keys(files)));
  });

  it("refuse a project contract that copies an audited base, but not a local interface", async () => {
    const report = await checkContracts({
      "contracts/Jar.sol": `${PRAGMA}interface IERC20 { function transfer(address to, uint256 amount) external returns (bool); }
contract ReentrancyGuard { uint256 private locked; }
contract GoodSavings is ReentrancyGuard { function hold() external {} }`,
    });
    expect(report.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/^Don't declare your own ReentrancyGuard: import it from @openzeppelin\/contracts/),
      expect.stringMatching(/^Don't declare your own GoodSavings: inherit it from \.\/goodbuild\/GoodSavings\.sol/),
    ]);
    expect(report.errors[0].line).toBe(4);
  });

  it("can't be edited by the builder", () => {
    expect(pathProblem("contracts/goodbuild/GoodToken.sol")).toMatch(/audited contract templates/);
    expect(pathProblem("contracts/RTXToken.sol")).toBeNull();
  });

  it("are picked from the spec: named, matched by words, or none", () => {
    const parsed = parseSpec({
      summary: "s",
      direction: "d",
      pages: [],
      acceptance: [],
      contracts: [
        { name: "GoalSavings", purpose: "hold G$ for goals", functions: [{ name: "deposit", does: "x" }], template: "savings" },
        { name: "ClubVote", purpose: "members vote on lunch", functions: [{ name: "vote", does: "x" }] },
        { name: "GameRules", purpose: "the board game's moves", functions: [{ name: "move", does: "x" }], template: "none" },
        { name: "Bad", purpose: "x", functions: [{ name: "f", does: "x" }], template: "rocket" },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.spec.contracts.map((c) => c.template)).toEqual(["savings", undefined, "none", undefined]);
    expect(templatesFor(parsed.spec).map((t) => t.id)).toEqual(["savings", "poll"]);
  });

  it("keep the app's contract from taking a template's name, and give a DAO its voting token", () => {
    const named = parseSpec({ summary: "s", direction: "d", pages: [], acceptance: [], contracts: [{ name: "GoodSavings", purpose: "x", functions: [{ name: "f", does: "x" }], template: "savings" }] });
    expect(named).toEqual({ ok: false, error: expect.stringMatching(/GoodSavings is the name of GoodBuild's template\. Name the app's contract after the app .* template "savings"/) });
    const dao = { contracts: [{ name: "ClubToken", purpose: "the club coin", template: "token" as const }, { name: "ClubDAO", purpose: "votes", template: "governance" as const }] };
    expect(templatesFor(dao as never).map((t) => t.id)).toEqual(["governance"]);
  });

  it("brief the contracts phase with the chosen ones only", () => {
    const brief = templatesBrief([templateById("escrow")!]);
    expect(brief).toMatch(/GoodEscrow \(contracts\/goodbuild\/GoodEscrow\.sol\)/);
    expect(brief).not.toMatch(/GoodToken/);
    expect(templatesBrief([])).toBe("");
  });
});
