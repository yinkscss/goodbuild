// @vitest-environment node
// GB-05 (security sweep, 14 Nov 2026): custodyOf missed several ways to hold other people's money.
// Every case compiles real Solidity through checkContracts / compileForDeploy, the same path the mainnet gate uses.
import { describe, expect, it } from "vitest";

import { checkContracts } from "@/server/agent/checks";
import { compileForDeploy } from "./compile";

const HEADER = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";
const IERC20 = 'import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";\n';

async function custody(body: string, imports = "", extra: Record<string, string> = {}) {
  const r = await checkContracts({ "contracts/C.sol": HEADER + imports + body, ...extra });
  expect(r.errors.filter((e) => e.source === "solc"), "the fixture must compile").toEqual([]);
  return (r.custody ?? []).map((c) => `${c.contract}.${c.fn}: ${c.how}`);
}

describe("GB-05: custodyOf finds the ways money comes in that the first version missed", { timeout: 180_000 }, () => {
  it("(a) a library function that pulls tokens, used by a contract with an innocuous function", async () => {
    const found = await custody(
      "library Pull { function take(IERC20 t, address from, uint256 a) internal { t.transferFrom(from, address(this), a); } }\n" +
        "contract C { IERC20 t; function chipIn(uint256 a) external { Pull.take(t, msg.sender, a); } }",
      IERC20,
    );
    expect(found.join("\n")).toMatch(/Pull\.take: pulls tokens in/);
  });

  it("(a) a file-level (free) function that pulls tokens", async () => {
    const found = await custody(
      "function pullIn(IERC20 t, address from, address to, uint256 a) { t.transferFrom(from, to, a); }\n" +
        "contract C { IERC20 t; function chipIn(uint256 a) external { pullIn(t, msg.sender, address(this), a); } }",
      IERC20,
    );
    expect(found.join("\n")).toMatch(/pullIn: pulls tokens in/);
  });

  it("(a) a modifier that pulls tokens", async () => {
    const found = await custody("contract C { IERC20 t; modifier paid(uint256 a) { t.transferFrom(msg.sender, address(this), a); _; } function enter(uint256 a) external paid(a) {} }", IERC20);
    expect(found.join("\n")).toMatch(/paid: pulls tokens in/);
  });

  it("(b) a constructor that pulls tokens (a factory deploying an escrow)", async () => {
    const found = await custody(
      "contract Escrow { constructor(IERC20 t, address buyer, uint256 amt) { t.transferFrom(buyer, address(this), amt); } }\n" +
        "contract Factory { function open(IERC20 t, address buyer, uint256 amt) external returns (Escrow) { return new Escrow(t, buyer, amt); } }",
      IERC20,
    );
    expect(found.join("\n")).toMatch(/Escrow\.constructor: pulls tokens in/);
  });

  it("(c) receivers inherited from OpenZeppelin: ERC721Holder, ERC1155Holder, TimelockController, VestingWallet", async () => {
    const cases: Array<[string, string, string]> = [
      ["ERC721Holder", 'import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";\n', "contract C is ERC721Holder { function f() external {} }"],
      ["ERC1155Holder", 'import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";\n', "contract C is ERC1155Holder { function f() external {} }"],
      ["TimelockController", 'import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";\n', "contract C is TimelockController { constructor() TimelockController(1, new address[](0), new address[](0), msg.sender) {} }"],
      ["VestingWallet", 'import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";\n', "contract C is VestingWallet { constructor(address b) VestingWallet(b, 0, 1) {} }"],
    ];
    for (const [name, imports, body] of cases) {
      const found = await custody(body, imports);
      expect.soft(found.join("\n"), name).toMatch(new RegExp(`C\\.contract: inherits ${name}`));
    }
  });

  it("(d) an ERC4626 vault imported under an alias", async () => {
    const found = await custody('import {ERC4626 as Base, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";\ncontract C is Base { constructor(IERC20 a) ERC20("s", "s") Base(a) {} }');
    expect(found).toEqual(["C.contract: is an ERC4626 vault that takes deposits"]);
  });

  it("(d) a Governor imported under an alias", async () => {
    const found = await custody(
      'import {Governor as Gov} from "@openzeppelin/contracts/governance/Governor.sol";\nimport {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";\nabstract contract C is Gov { constructor() Gov("g") {} }',
    );
    expect(found.join("\n")).toMatch(/C\.contract: is a Governor/);
  });

  it("(e) Address.functionCall / functionCallWithValue are refused by the guardrails, in the builder check and at deploy", async () => {
    for (const call of [
      'Address.functionCall(t, abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), a));',
      'Address.functionCallWithValue(t, abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), a), 0);',
    ]) {
      const files = { "contracts/C.sol": HEADER + 'import {Address} from "@openzeppelin/contracts/utils/Address.sol";\ncontract C { function chipIn(address t, uint256 a) external { ' + call + " } }" };
      const report = await checkContracts(files);
      expect.soft(report.errors.map((e) => e.message).join("\n"), call).toMatch(/functionCall/);
      const deploy = await compileForDeploy(files);
      expect.soft(deploy.ok, call).toBe(false);
      if (!deploy.ok) expect(deploy.errors.join("\n")).toMatch(/functionCall/);
    }
    // The same helper on an address (`using Address for address`).
    const using = { "contracts/C.sol": HEADER + 'import {Address} from "@openzeppelin/contracts/utils/Address.sol";\ncontract C { using Address for address; function chipIn(address t) external { t.functionCall(abi.encodeWithSignature("poke()")); } }' };
    expect((await checkContracts(using)).errors.map((e) => e.message).join("\n")).toMatch(/functionCall/);
  });

  it("(f) a contract that pays out its own token balance is flagged (decision D110: flagged, narrow form)", async () => {
    const found = await custody("contract C { IERC20 t; function payout(address to) external { t.transfer(to, t.balanceOf(address(this))); } }", IERC20);
    expect(found.join("\n")).toMatch(/C\.payout: pays out tokens it holds/);
  });

  it("ERC-1363 receiver hooks", async () => {
    const found = await custody("contract C { function onTransferReceived(address, address, uint256, bytes calldata) external pure returns (bytes4) { return 0x88a7ca5c; } function onApprovalReceived(address, uint256, bytes calldata) external pure returns (bytes4) { return 0x7b04a2d0; } }");
    expect(found).toEqual(["C.onTransferReceived: is called when tokens are sent to the contract", "C.onApprovalReceived: is called when tokens are sent to the contract"]);
  });
});

describe("GB-05: what held up must not be newly flagged", { timeout: 180_000 }, () => {
  it("a payable constructor, super.transferFrom in a token's own override, comments and names", async () => {
    expect(await custody("contract C { constructor() payable {} }")).toEqual([]);
    expect(await custody('import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";\ncontract C is ERC20 { constructor() ERC20("t", "t") {} function transferFrom(address f, address t, uint256 v) public override returns (bool) { return super.transferFrom(f, t, v); } }')).toEqual([]);
    expect(await custody("// function deposit() function withdraw() t.transferFrom(a, b, c) receive() payable\ncontract C { function deposit() external {} function withdraw() external {} function onTokenTransferred() external {} }")).toEqual([]);
    expect(await custody('contract C { string public s = "t.transferFrom(a, b, c) function onTokenTransfer("; }')).toEqual([]);
  });

  it("plain ERC20 / ERC721 / roles / pausing, and contracts that take in no money", async () => {
    const oz = (p: string, n: string) => `import {${n}} from "@openzeppelin/contracts/${p}.sol";\n`;
    expect(await custody('contract C is ERC20 { constructor() ERC20("t", "t") {} function mint(address to, uint256 a) external { _mint(to, a); } }', oz("token/ERC20/ERC20", "ERC20"))).toEqual([]);
    expect(await custody('contract C is ERC20, ERC20Burnable, Ownable { constructor() ERC20("t", "t") Ownable(msg.sender) {} }', oz("token/ERC20/ERC20", "ERC20") + oz("token/ERC20/extensions/ERC20Burnable", "ERC20Burnable") + oz("access/Ownable", "Ownable"))).toEqual([]);
    expect(await custody('contract C is ERC721 { constructor() ERC721("n", "n") {} function mint(address to, uint256 id) external { _mint(to, id); } }', oz("token/ERC721/ERC721", "ERC721"))).toEqual([]);
    expect(await custody('contract C is ERC1155 { constructor() ERC1155("u") {} }', oz("token/ERC1155/ERC1155", "ERC1155"))).toEqual([]);
    expect(await custody("contract C is AccessControl, Pausable, ReentrancyGuard { function f() external nonReentrant whenNotPaused {} }", oz("access/AccessControl", "AccessControl") + oz("utils/Pausable", "Pausable") + oz("utils/ReentrancyGuard", "ReentrancyGuard"))).toEqual([]);
    expect(await custody("contract C { uint256 public n; function inc() external { n++; } }")).toEqual([]);
    // Reading a token balance that isn't this contract's own, and sending tokens, is not holding other people's money.
    expect(await custody("contract C { IERC20 t; function send(address to, uint256 a) external { t.transfer(to, a); } function peek(address who) external view returns (uint256) { return t.balanceOf(who); } }", IERC20)).toEqual([]);
  });

  it("a test file's own helpers never count (tests don't deploy)", async () => {
    const found = await custody("contract C { uint256 public n; function inc() external { n++; } }", "", {
      "contracts/test/C.t.sol": HEADER + 'import {Test} from "@goodbuild/Test.sol";\ncontract CTest is Test { function receiveHelper() external payable {} function onTokenTransfer(address, uint256, bytes calldata) external returns (bool) { return true; } }',
    });
    expect(found).toEqual([]);
  });
});
