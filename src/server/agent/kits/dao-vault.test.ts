// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkApp } from "../checks";
import { starterFiles } from "../template";
import { exploitGate } from "../../deploy/exploit-gate";

import { daoVault, exploitTestIssues, rolesOf } from "./dao-vault";
import { detectKits, kitIdsOf, withKit } from "./index";

const HEADER = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";
const VAULT =
  HEADER +
  `import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SavingsVault is ERC4626, Ownable, ReentrancyGuard {
    uint256 public cap;

    constructor(IERC20 asset_) ERC20("Vault shares", "vSHR") ERC4626(asset_) Ownable(msg.sender) {}

    function setCap(uint256 cap_) external onlyOwner {
        cap = cap_;
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner_) public override nonReentrant returns (uint256) {
        return super.withdraw(assets, receiver, owner_);
    }
}
`;
const TEST =
  HEADER +
  `import {Test, Actor} from "@goodbuild/Test.sol";
import {MockGoodDollar} from "@goodbuild/MockGoodDollar.sol";
import {SavingsVault} from "../SavingsVault.sol";

contract SavingsVaultTest is Test {
    MockGoodDollar gd;
    SavingsVault vault;
    Actor alice;
    Actor bob;
    Actor mallory;

    function setUp() public {
        gd = new MockGoodDollar();
        vault = new SavingsVault(gd);
        alice = newActor();
        bob = newActor();
        mallory = newActor();
        gd.mint(address(alice), 1_000e18);
        gd.mint(address(bob), 1_000e18);
        gd.mint(address(mallory), 1_000e18);
    }

    function testDepositAndWithdraw() public {
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(vault), 100e18)));
        alice.exec(address(vault), abi.encodeCall(vault.deposit, (100e18, address(alice))));
        alice.exec(address(vault), abi.encodeCall(vault.withdraw, (100e18, address(alice), address(alice))));
        assertEq(gd.balanceOf(address(alice)), 1_000e18, "alice got everything back");
    }

    function testExploitUnauthorizedCall() public {
        expectRevert(mallory, address(vault), abi.encodeCall(vault.setCap, (1)), "a stranger can't set the cap");
    }

    function testExploitDonationInflation() public {
        mallory.exec(address(gd), abi.encodeCall(gd.approve, (address(vault), 1)));
        mallory.exec(address(vault), abi.encodeCall(vault.deposit, (1, address(mallory))));
        mallory.exec(address(gd), abi.encodeCall(gd.transfer, (address(vault), 500e18)));
        bob.exec(address(gd), abi.encodeCall(gd.approve, (address(vault), 100e18)));
        bob.exec(address(vault), abi.encodeCall(vault.deposit, (100e18, address(bob))));
        assertGt(vault.balanceOf(address(bob)), 0, "bob got shares");
        assertGe(vault.previewRedeem(vault.balanceOf(address(bob))), 99e18, "bob can still take out what he put in");
    }

    function testExploitReentrancyOverdraw() public {
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(vault), 100e18)));
        alice.exec(address(vault), abi.encodeCall(vault.deposit, (100e18, address(alice))));
        expectRevert(mallory, address(vault), abi.encodeCall(vault.withdraw, (100e18, address(mallory), address(alice))), "mallory can't take alice's deposit");
    }
}
`;
const files = (extra: Record<string, string> = {}): Record<string, string> => ({ ...withKit(starterFiles(), daoVault), "contracts/SavingsVault.sol": VAULT, "contracts/test/SavingsVault.t.sol": TEST, ...extra });

describe("the DAOs and vaults kit", { timeout: 180_000 }, () => {
  it("is picked for DAOs, treasuries and vaults, and not for ordinary apps", () => {
    const wants = (r: string) => detectKits(r, starterFiles()).includes(daoVault);
    for (const yes of ["A DAO for our church", "A vault where members save USDC", "A community treasury with votes", "a staking pool"]) expect(wants(yes), yes).toBe(true);
    for (const no of ["A tip jar for our football club", "A flappy bird game"]) expect(wants(no), no).toBe(false);
  });

  it("reads what a project's contracts do", () => {
    expect(rolesOf(files())).toEqual(["vault"]);
    expect(rolesOf({ "contracts/Club.sol": "contract Club { function propose() external {} function vote() external {} }" })).toEqual(["dao"]);
    expect(rolesOf({ "contracts/Tip.sol": "contract Tip { function tip() external payable {} }" })).toEqual([]);
    // An escrow that takes money through fundDeal and pays it out through claimPayment / withdraw (live check, D76).
    expect(rolesOf({ "contracts/Escrow.sol": "contract Escrow { function fundDeal(uint256 id) external {} function claimPayment(uint256 id) external {} }" })).toEqual(["vault"]);
  });

  it("asks for each missing exploit test by name, and for tests that check something", () => {
    expect(exploitTestIssues(files())).toEqual([]);
    const without = (name: string) => files({ "contracts/test/SavingsVault.t.sol": TEST.replace(new RegExp(`function ${name}\\(\\)`), "function helper()") });
    expect(exploitTestIssues(without("testExploitDonationInflation")).map((i) => i.message).join()).toMatch(/testExploitDonationInflation/);
    expect(exploitTestIssues(without("testExploitUnauthorizedCall")).map((i) => i.message).join()).toMatch(/testExploitUnauthorizedCall/);
    expect(exploitTestIssues({ ...files(), "contracts/test/SavingsVault.t.sol": HEADER + "contract SavingsVaultTest { }\n" }).length).toBeGreaterThanOrEqual(3);
    const empty = TEST.replace(/(function testExploitReentrancyOverdraw\(\) public \{)[\s\S]*?\n    \}/, "$1\n    }");
    expect(exploitTestIssues(files({ "contracts/test/SavingsVault.t.sol": empty })).map((i) => i.message).join()).toMatch(/doesn't check anything/);
    // a DAO needs the vote attacks too
    const dao = { ...withKit(starterFiles(), daoVault), "contracts/Club.sol": "contract Club { function propose() external {} function vote() external {} }" };
    expect(exploitTestIssues(dao).map((i) => i.message).join()).toMatch(/testExploitDoubleVote[\s\S]*testExploitFlashVotes|testExploitFlashVotes[\s\S]*testExploitDoubleVote/);
  });

  it("runs as part of the app check, and still runs on a vault-shaped contract with the kit off", () => {
    const missing = { ...files(), "contracts/test/SavingsVault.t.sol": HEADER + "contract SavingsVaultTest { }\n", "src/App.tsx": "export default function App() { return <main>Vault</main>; }\n" };
    expect(checkApp(missing).errors.some((e) => e.source === "test")).toBe(true);
    const off = { ...missing };
    delete (off as Record<string, string>)["src/goodbuild.json"];
    expect(kitIdsOf(off)).toEqual([]);
    const offErrors = checkApp(off).errors.filter((e) => e.source === "test");
    expect(offErrors.length).toBeGreaterThan(0);
    expect(offErrors[0].message).toMatch(/add_kit\("dao-vault"\)/);
    const tipJar = { ...off, "contracts/Tip.sol": "contract Tip { function tip() external payable {} }" };
    delete (tipJar as Record<string, string>)["contracts/SavingsVault.sol"];
    expect(checkApp(tipJar).errors.some((e) => e.source === "test")).toBe(false);
  });

  it("lets a real vault with real exploit tests through to mainnet", async () => {
    expect(await exploitGate(files())).toEqual([]);
  });

  it("stops a vault whose exploit test fails, and one with a test missing, before mainnet", async () => {
    // A vault that lets anyone set the cap: the unauthorized-call test must now fail.
    const leaky = VAULT.replace("function setCap(uint256 cap_) external onlyOwner", "function setCap(uint256 cap_) external");
    const failing = await exploitGate(files({ "contracts/SavingsVault.sol": leaky }));
    expect(failing.join("\n")).toMatch(/testExploitUnauthorizedCall failed|a stranger can't set the cap/);
    const missing = await exploitGate(files({ "contracts/test/SavingsVault.t.sol": TEST.replace(/function testExploitDonationInflation\(\)/, "function helper()") }));
    expect(missing.join("\n")).toMatch(/testExploitDonationInflation/);
  });

  it("stops a vault without the kit too, and leaves contracts that hold no deposits alone", async () => {
    expect((await exploitGate({ ...starterFiles(), "contracts/SavingsVault.sol": VAULT })).join("\n")).toMatch(/testExploit/);
    expect(await exploitGate({ ...starterFiles(), "contracts/Tip.sol": "contract Tip { function tip() external payable {} }" })).toEqual([]);
  });
});
