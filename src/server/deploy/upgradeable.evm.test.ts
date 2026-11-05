// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { encodeDeployData, encodeFunctionData, erc20Abi, getAddress, parseAbi, type Abi, type Address, type Hex } from "viem";

import { runDeploy, type Plan, type PlanStep } from "@/lib/deploy/run";
import { ADMIN_SLOT, IMPLEMENTATION_SLOT, encodeUpgrade, proxyAdminAbi } from "@/lib/deploy/upgradeable";
import { checkContracts, runSolc, upgradeableIssues } from "@/server/agent/checks";
import { runContractTests } from "@/server/agent/contract-tests";
import { loadFiles, saveFiles } from "@/server/agent/store";
import { contractModule } from "@/server/agent/template";
import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { contractUpgrades, deployments } from "@/server/db/deploy-schema";
import { loadDeployedAddresses } from "./addresses";
import { compileForDeploy, PROXY_IDENTIFIER, PROXY_NAME, sourceKey, PROXY_FILE } from "./compile";
import { contractState } from "./contract-state";
import { LocalChain } from "./local-chain";
import { oldContractsWithFunds } from "./old-contracts";
import { DeployError, prepareDeploy, recordDeployment, type DeployPlan } from "./service";
import { compareLayouts } from "./upgrade-check";
import { hasChangeableContracts, isUpgradeableProject, liveStorage, setUpgradeable, upgradeChecksFor } from "./upgradeable";
import { verifyProxied } from "./verify";
import { createProjectFromPrompt } from "@/server/projects";

/**
 * Upgradeable contracts (D33), proved with real compiled bytecode in a real EVM, driving the same
 * prepareDeploy, runDeploy and recordDeployment the product uses. Only the wallet and RPC are stand-ins.
 */

const SEPOLIA = 11142220;
const WALLET = getAddress("0x7a3000000000000000000000000000000000e41c");
const ALICE = getAddress("0x0000000000000000000000000000000000a11ce0");
const STRANGER = getAddress("0x00000000000000000000000000000000baadf00d");
const ONE = BigInt(10) ** BigInt(18);
const SECONDS = 180_000;

const HEADER = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
`;
const BODY = `
  using SafeERC20 for IERC20;
  error Empty();
  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() { _disableInitializers(); }
  function initialize(IERC20 gd_, uint256 cap_) external initializer { __Ownable_init(msg.sender); gd = gd_; cap = cap_; }
  function deposit(uint256 amount) external nonReentrant {
    if (amount == 0) revert Empty();
    gd.safeTransferFrom(msg.sender, address(this), amount);
    balances[msg.sender] += amount;
    total += amount;
  }
  function withdraw(uint256 amount) external nonReentrant {
    balances[msg.sender] -= amount;
    total -= amount;
    gd.safeTransfer(msg.sender, amount);
  }
  receive() external payable {}
`;
const STATE = `  IERC20 public gd;
  uint256 public cap;
  uint256 public total;
  mapping(address => uint256) public balances;
`;
const vault = (state: string, extra = "", header = HEADER) => `${header}contract Vault is Initializable, OwnableUpgradeable, ReentrancyGuard {\n${state}${BODY}${extra}\n}\n`;

const V1 = vault(STATE);
const V2_SAFE = vault(`${STATE}  uint256 public bonus;\n`, `  function setBonus(uint256 b) external onlyOwner { bonus = b; }\n  function version() external pure returns (uint256) { return 2; }`);

const MANIFEST = JSON.stringify({ contracts: [{ name: "Vault", args: { gd_: "${GOODDOLLAR}", cap_: "1000" } }] });
const vaultAbi = parseAbi([
  "function initialize(address gd_, uint256 cap_)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function gd() view returns (address)",
  "function cap() view returns (uint256)",
  "function total() view returns (uint256)",
  "function balances(address) view returns (uint256)",
  "function owner() view returns (address)",
  "function setBonus(uint256 b)",
  "function bonus() view returns (uint256)",
  "function version() view returns (uint256)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
]);

let db: Db;
let chain: LocalChain;
let projectId: string;
let userId: string;
let gd: Address;
let mockAbi: Abi;

/** Real solc, for the G$ stand-in the agent's own tests also use. */
async function deployMockGd(): Promise<Address> {
  const { output } = await runSolc({ "contracts/test/Mock.t.sol": `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\nimport {MockGoodDollar} from "@goodbuild/MockGoodDollar.sol";\n` });
  const mock = output.contracts!["@goodbuild/MockGoodDollar.sol"].MockGoodDollar;
  mockAbi = mock.abi as Abi;
  const hash = await chain.send({ from: WALLET, data: `0x${mock.evm.bytecode.object}` });
  return chain.receipts.get(hash)!.contractAddress!;
}

async function writeContract(file: string, manifest = MANIFEST) {
  const compiled = await compileForDeploy({ "contracts/Vault.sol": file, "contracts/deploy.json": manifest }, "cancun", undefined, { upgradeable: true });
  await saveFiles(db, projectId, {
    "contracts/Vault.sol": file,
    "contracts/deploy.json": manifest,
    "src/contracts/Vault.ts": contractModule("Vault", compiled.ok ? (compiled.artifacts[0].abi as never) : []),
  });
}

function envFor(from: Address, plan: DeployPlan) {
  return {
    account: from,
    simulate: async ({ data, to }: { data: Hex; to?: Address }) => {
      const out = await chain.dryRun({ from, to, data });
      if (!out.ok) throw Object.assign(new Error(`execution reverted ${out.returned}`), { code: "reverted" });
      return { gas: out.gas };
    },
    send: (data: Hex, _gas: bigint, to?: Address) => chain.send({ from, to, data }),
    waitForReceipt: async (hash: Hex) => chain.receipts.get(hash)!,
    record: async (step: PlanStep, txHash: Hex, implementationTx?: Hex) => {
      const row = await recordDeployment(
        db,
        {
          projectId,
          userId,
          wallet: from,
          runId: plan.runId,
          chainId: plan.chainId,
          contractName: step.name,
          txHash,
          sourceHash: plan.sourceHash,
          evmVersion: plan.evmVersion,
          proxied: step.upgradeable && implementationTx ? { kind: step.upgradeable.kind === "upgrade" ? "upgrade" : "proxy", implementationTxHash: implementationTx } : undefined,
        },
        { client: chain.client() },
      );
      return { address: getAddress(row.address) };
    },
  };
}

const prepare = (extra: { fresh?: boolean } = {}) => prepareDeploy(db, { projectId, chainId: SEPOLIA, wallet: WALLET, ...extra }, { client: chain.client() });

/** Deploy or upgrade the saved code the way the deploy modal does. */
async function deploy(extra: { fresh?: boolean } = {}) {
  const plan = await prepare(extra);
  const addresses = await runDeploy(plan as unknown as Plan, envFor(WALLET, plan));
  return { plan, address: addresses.Vault };
}

async function liveAtV1() {
  await writeContract(V1);
  return (await deploy()).address;
}

async function aliceDeposits(proxy: Address, amount: bigint) {
  await chain.send({ from: ALICE, to: gd, data: encodeFunctionData({ abi: mockAbi, functionName: "mint", args: [ALICE, amount * BigInt(2)] }) });
  await chain.send({ from: ALICE, to: gd, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [proxy, amount] }) });
  const hash = await chain.send({ from: ALICE, to: proxy, data: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [amount] }) });
  expect(chain.receipts.get(hash)!.status).toBe("success");
}

const addressIn = (word: Hex) => getAddress(`0x${word.slice(26)}`);

async function refusal(run: () => Promise<unknown>): Promise<DeployError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DeployError) return error;
    throw error;
  }
  throw new Error("expected a refusal, but it went through");
}

beforeEach(async () => {
  db = await createTestDb();
  chain = await LocalChain.start();
  gd = await deployMockGd();
  process.env.NEXT_PUBLIC_TEST_GD_ADDRESS = gd;
  delete process.env.NEXT_PUBLIC_ENABLE_MAINNET;
  const user = await signInUser(db, { wallet: WALLET.toLowerCase(), walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  const project = await createProjectFromPrompt(db, userId, { prompt: "G$ vault", network: "celo-sepolia" });
  projectId = project.id;
  await setUpgradeable(db, project, true);
}, SECONDS);

describe("deploy, write, upgrade, read", () => {
  it("keeps the address, data and balances, and the new function works", { timeout: SECONDS }, async () => {
    await writeContract(V1);
    const first = await deploy();
    expect(first.plan.steps[0].upgradeable?.kind).toBe("first");
    const proxy = first.address;

    // The proxy is stock OpenZeppelin, it ran initialize, and the wallet holds both kinds of authority.
    const admin = addressIn(await chain.slot(proxy, ADMIN_SLOT));
    const implV1 = addressIn(await chain.slot(proxy, IMPLEMENTATION_SLOT));
    expect(await chain.read(admin, proxyAdminAbi, "owner")).toBe(WALLET);
    expect(await chain.read(proxy, vaultAbi, "owner")).toBe(WALLET);
    expect(await chain.read(proxy, vaultAbi, "gd")).toBe(getAddress(gd));
    expect(await chain.read(proxy, vaultAbi, "cap")).toBe(BigInt(1000));

    // Write state: G$ through a nonReentrant function, native CELO and a mapping entry.
    await aliceDeposits(proxy, ONE);
    await chain.send({ from: WALLET, to: proxy, data: "0x", value: BigInt(7) });
    expect(await chain.read(proxy, vaultAbi, "total")).toBe(ONE);
    const slotsBefore = [BigInt(0), BigInt(1), BigInt(2)].map((n) => `0x${n.toString(16).padStart(64, "0")}` as Hex);
    const before = await Promise.all(slotsBefore.map((s) => chain.slot(proxy, s)));

    // v1 can't do v2's things.
    await expect(chain.read(proxy, vaultAbi, "version")).rejects.toThrow();

    await writeContract(V2_SAFE);
    const state = await contractState(db, { id: projectId, chainId: SEPOLIA }, await loadFiles(db, projectId));
    expect(state.outdated).toEqual(["Vault"]);
    expect(state.upgradable).toEqual(["Vault"]);

    const second = await deploy();
    expect(second.plan.steps[0].upgradeable?.kind).toBe("upgrade");
    expect(second.plan.upgrades).toEqual([{ name: "Vault", address: proxy }]);

    // No "new contract" notice in any form.
    expect(second.plan.replaces).toEqual([]);

    // Same address, new code.
    expect(second.address).toBe(proxy);
    expect(addressIn(await chain.slot(proxy, IMPLEMENTATION_SLOT))).not.toBe(implV1);
    expect(addressIn(await chain.slot(proxy, ADMIN_SLOT))).toBe(admin);

    // Data, slots and balances survived.
    expect(await Promise.all(slotsBefore.map((s) => chain.slot(proxy, s)))).toEqual(before);
    expect(await chain.read(proxy, vaultAbi, "owner")).toBe(WALLET);
    expect(await chain.read(proxy, vaultAbi, "cap")).toBe(BigInt(1000));
    expect(await chain.read(proxy, vaultAbi, "total")).toBe(ONE);
    expect(await chain.read(proxy, vaultAbi, "balances", [ALICE])).toBe(ONE);
    expect(await chain.read(gd, erc20Abi, "balanceOf", [proxy])).toBe(ONE);
    expect(await chain.balance(proxy)).toBe(BigInt(7));

    // v2's new function and variable work, and only the owner can set it.
    expect(await chain.read(proxy, vaultAbi, "version")).toBe(BigInt(2));
    expect(await chain.read(proxy, vaultAbi, "bonus")).toBe(BigInt(0));
    const set = await chain.send({ from: WALLET, to: proxy, data: encodeFunctionData({ abi: vaultAbi, functionName: "setBonus", args: [BigInt(5)] }) });
    expect(chain.receipts.get(set)!.status).toBe("success");
    expect(await chain.read(proxy, vaultAbi, "bonus")).toBe(BigInt(5));
    const denied = await chain.send({ from: STRANGER, to: proxy, data: encodeFunctionData({ abi: vaultAbi, functionName: "setBonus", args: [BigInt(9)] }) });
    expect(chain.receipts.get(denied)!.status).toBe("reverted");

    // Old functions still work on the old data.
    const out = await chain.send({ from: ALICE, to: proxy, data: encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [ONE] }) });
    expect(chain.receipts.get(out)!.status).toBe("success");
    expect(await chain.read(gd, erc20Abi, "balanceOf", [proxy])).toBe(BigInt(0));

    // Server state: one row, in sync with the chain, no warnings left anywhere.
    const rows = await db.select().from(deployments).where(eq(deployments.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0].proxy?.implementation).toBe(addressIn(await chain.slot(proxy, IMPLEMENTATION_SLOT)).toLowerCase());
    expect(await db.select().from(contractUpgrades)).toHaveLength(1);
    const after = await contractState(db, { id: projectId, chainId: SEPOLIA }, await loadFiles(db, projectId));
    expect(after).toMatchObject({ live: ["Vault"], outdated: [], upgradable: [] });
    expect((await loadDeployedAddresses(db, projectId)).Vault[SEPOLIA].toLowerCase()).toBe(proxy.toLowerCase());
    expect(await oldContractsWithFunds(db, { id: projectId, chainId: SEPOLIA }, chain.client())).toEqual([]);
    expect((await loadFiles(db, projectId))["src/contracts/Vault.ts"].toLowerCase()).toContain(proxy.toLowerCase());
  });

  it("asks for nothing when the code is the same, and a retried record changes nothing", { timeout: SECONDS }, async () => {
    const proxy = await liveAtV1();
    await writeContract(V2_SAFE);
    const plan = await prepare();
    let upgradeTx: Hex | undefined;
    const env = envFor(WALLET, plan);
    await runDeploy(plan as unknown as Plan, {
      ...env,
      record: async (step, txHash, implementationTx) => {
        upgradeTx = txHash;
        const once = await env.record(step, txHash, implementationTx);
        // The browser retries a lost response: same row, no second history entry.
        await env.record(step, txHash, implementationTx);
        return once;
      },
    });
    expect(upgradeTx).toBeDefined();
    expect(await db.select().from(contractUpgrades)).toHaveLength(1);

    const again = await prepare();
    expect(again.alreadyDeployed.Vault.toLowerCase()).toBe(proxy.toLowerCase());
    expect(again.upgrades).toEqual([]);

    // Only the manifest changed: same code, so no signature, and nothing is shown as outdated.
    const txCount = chain.txs.size;
    await writeContract(V2_SAFE, MANIFEST.replace("1000", "2000"));
    const sameCode = await prepare();
    expect(sameCode.alreadyDeployed.Vault.toLowerCase()).toBe(proxy.toLowerCase());
    expect(sameCode.upgrades).toEqual([]);
    expect(chain.txs.size).toBe(txCount);
    expect((await contractState(db, { id: projectId, chainId: SEPOLIA }, await loadFiles(db, projectId))).outdated).toEqual([]);
    expect(await chain.read(proxy, vaultAbi, "cap")).toBe(BigInt(1000)); // initialize doesn't run again
  });

  it("upgrades only the contract that changed, and references keep pointing at permanent addresses", { timeout: SECONDS }, async () => {
    const token = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
contract Tok is Initializable, ERC20Upgradeable {
  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() { _disableInitializers(); }
  function initialize() external initializer { __ERC20_init("Tok", "TOK"); _mint(msg.sender, 1000); }
}
`;
    const pool = (extra: string) => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
contract Pool is Initializable {
  address public tok;
  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() { _disableInitializers(); }
  function initialize(address tok_) external initializer { tok = tok_; }
  ${extra}
}
`;
    const manifest = JSON.stringify({ contracts: [{ name: "Pool", args: { tok_: "\${Tok.address}" } }, { name: "Tok", args: {} }] });
    const save = async (poolSource: string) => {
      const files = { "contracts/Tok.sol": token, "contracts/Pool.sol": poolSource, "contracts/deploy.json": manifest };
      const compiled = await compileForDeploy(files, "cancun", undefined, { upgradeable: true });
      if (!compiled.ok) throw new Error(compiled.errors.join());
      await saveFiles(db, projectId, { ...files, ...Object.fromEntries(compiled.artifacts.map((a) => [`src/contracts/${a.name}.ts`, contractModule(a.name, a.abi as never)])) });
    };
    await save(pool(""));
    const first = await prepare();
    expect(first.steps.map((s) => s.name)).toEqual(["Tok", "Pool"]);
    const before = chain.txs.size;
    const addresses = await runDeploy(first as unknown as Plan, envFor(WALLET, first));
    expect(chain.txs.size - before).toBe(4); // code and proxy for each
    const poolAbi = parseAbi(["function tok() view returns (address)", "function added() view returns (uint256)"]);
    expect(await chain.read(addresses.Pool, poolAbi, "tok")).toBe(addresses.Tok);
    const tokAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
    expect(await chain.read(addresses.Tok, tokAbi, "balanceOf", [WALLET])).toBe(BigInt(1000)); // msg.sender in initialize is the wallet

    await save(pool("function added() external pure returns (uint256) { return 1; }"));
    const second = await prepare();
    expect(second.upgrades.map((u) => u.name)).toEqual(["Pool"]);
    expect(second.alreadyDeployed.Tok.toLowerCase()).toBe(addresses.Tok.toLowerCase());
    expect(second.replaces).toEqual([]);
    const mid = chain.txs.size;
    const next = await runDeploy(second as unknown as Plan, envFor(WALLET, second));
    expect(chain.txs.size - mid).toBe(2); // only Pool: new code and the switch
    expect(next.Pool).toBe(addresses.Pool);
    expect(await chain.read(addresses.Pool, poolAbi, "tok")).toBe(addresses.Tok);
    expect(await chain.read(addresses.Pool, poolAbi, "added")).toBe(BigInt(1));
    const state = await contractState(db, { id: projectId, chainId: SEPOLIA }, await loadFiles(db, projectId));
    expect(state.outdated).toEqual([]);
    expect(state.live.sort()).toEqual(["Pool", "Tok"]);
  });
});

describe("attackers", () => {
  it("refuses a stranger's upgrade, at the ProxyAdmin and at the proxy", { timeout: SECONDS }, async () => {
    const proxy = await liveAtV1();
    const admin = addressIn(await chain.slot(proxy, ADMIN_SLOT));
    const implV1 = await chain.slot(proxy, IMPLEMENTATION_SLOT);

    // Evil code that would take the funds. It never gets used.
    const evil = await compileForDeploy({ "contracts/Evil.sol": `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract Evil { function version() external pure returns (uint256) { return 666; } }\n`, "contracts/deploy.json": `{"contracts":[{"name":"Evil","args":{}}]}` });
    if (!evil.ok) throw new Error(evil.errors.join());
    const evilTx = await chain.send({ from: STRANGER, data: evil.artifacts[0].bytecode });
    const evilAddress = chain.receipts.get(evilTx)!.contractAddress!;

    const viaAdmin = await chain.send({ from: STRANGER, to: admin, data: encodeUpgrade(proxy, evilAddress) });
    expect(chain.receipts.get(viaAdmin)!.status).toBe("reverted");
    const viaProxy = await chain.send({ from: STRANGER, to: proxy, data: encodeFunctionData({ abi: vaultAbi, functionName: "upgradeToAndCall", args: [evilAddress, "0x"] }) });
    expect(chain.receipts.get(viaProxy)!.status).toBe("reverted");
    const steal = await chain.send({ from: STRANGER, to: admin, data: encodeFunctionData({ abi: proxyAdminAbi, functionName: "transferOwnership", args: [STRANGER] }) });
    expect(chain.receipts.get(steal)!.status).toBe("reverted");

    expect(await chain.slot(proxy, IMPLEMENTATION_SLOT)).toBe(implV1);
    expect(await chain.read(admin, proxyAdminAbi, "owner")).toBe(WALLET);
  });

  it("refuses a second run of the initializer, on the proxy and on the bare code", { timeout: SECONDS }, async () => {
    const proxy = await liveAtV1();
    const impl = addressIn(await chain.slot(proxy, IMPLEMENTATION_SLOT));
    const data = encodeFunctionData({ abi: vaultAbi, functionName: "initialize", args: [STRANGER, BigInt(1)] });

    const onProxy = await chain.send({ from: STRANGER, to: proxy, data });
    expect(chain.receipts.get(onProxy)!.status).toBe("reverted");
    expect(await chain.read(proxy, vaultAbi, "owner")).toBe(WALLET);
    expect(await chain.read(proxy, vaultAbi, "cap")).toBe(BigInt(1000));

    const onCode = await chain.send({ from: STRANGER, to: impl, data });
    expect(chain.receipts.get(onCode)!.status).toBe("reverted");
    await expect(chain.read(impl, vaultAbi, "owner")).resolves.toBe("0x0000000000000000000000000000000000000000");
  });

  it("still blocks re-entry through the proxy, even though ReentrancyGuard's constructor never ran there", { timeout: SECONDS }, async () => {
    // A token that calls back into the vault in the middle of a deposit.
    const compiled = await compileForDeploy({
      "contracts/Reenter.sol": `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IVault { function deposit(uint256 amount) external; }
contract Reenter {
  address public vault;
  bool public blocked;
  function transferFrom(address, address, uint256) external returns (bool) {
    try IVault(vault).deposit(1) { blocked = false; } catch { blocked = true; }
    return true;
  }
  function attack(address vault_) external { vault = vault_; IVault(vault_).deposit(1); }
}
`,
      "contracts/deploy.json": `{"contracts":[{"name":"Reenter","args":{}}]}`,
    });
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const created = await chain.send({ from: STRANGER, data: compiled.artifacts[0].bytecode });
    const evil = chain.receipts.get(created)!.contractAddress!;
    const evilAbi = parseAbi(["function attack(address vault_)", "function blocked() view returns (bool)"]);

    await writeContract(V1, JSON.stringify({ contracts: [{ name: "Vault", args: { gd_: evil, cap_: "1000" } }] }));
    const { address: proxy } = await deploy();
    const attack = await chain.send({ from: STRANGER, to: evil, data: encodeFunctionData({ abi: evilAbi, functionName: "attack", args: [proxy] }) });
    expect(chain.receipts.get(attack)!.status).toBe("success");
    expect(await chain.read(evil, evilAbi, "blocked")).toBe(true);
    expect(await chain.read(proxy, vaultAbi, "total")).toBe(BigInt(1)); // only the outer deposit counted
  });

  it("won't record a wallet's upgrade when another wallet sent it, or when the code isn't GoodBuild's", { timeout: SECONDS }, async () => {
    const proxy = await liveAtV1();
    const admin = addressIn(await chain.slot(proxy, ADMIN_SLOT));
    await writeContract(V2_SAFE);
    const plan = await prepare();
    const step = plan.steps[0];
    const codeTx = await chain.send({ from: WALLET, data: step.bytecode });
    const code = chain.receipts.get(codeTx)!.contractAddress!;

    // A stranger names the real upgrade's hash from their own session: refused for the wrong sender.
    const realTx = await chain.send({ from: WALLET, to: admin, data: encodeUpgrade(proxy, code) });
    const shared = { projectId, userId, runId: plan.runId, chainId: SEPOLIA, contractName: "Vault", sourceHash: plan.sourceHash, evmVersion: plan.evmVersion };
    const client = chain.client();
    const asStranger = await refusal(() => recordDeployment(db, { ...shared, wallet: STRANGER, txHash: realTx, proxied: { kind: "upgrade", implementationTxHash: codeTx } }, { client }));
    expect(asStranger.code).toBe("wrong_sender");

    // A transaction that doesn't upgrade this proxy, or new code that isn't what GoodBuild compiled.
    const notAnUpgrade = await chain.send({ from: WALLET, to: gd, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ALICE, BigInt(1)] }) });
    expect((await refusal(() => recordDeployment(db, { ...shared, wallet: WALLET, txHash: notAnUpgrade, proxied: { kind: "upgrade", implementationTxHash: codeTx } }, { client }))).code).toBe("wrong_upgrade");
    const otherCode = await chain.send({ from: WALLET, data: step.bytecode.replace(/.{4}$/, "0000") as Hex });
    expect((await refusal(() => recordDeployment(db, { ...shared, wallet: WALLET, txHash: realTx, proxied: { kind: "upgrade", implementationTxHash: otherCode } }, { client }))).code).toBe("bytecode_mismatch");

    expect(await db.select().from(contractUpgrades)).toHaveLength(0);
  });

  it("won't record a proxy whose upgrade right is given to someone else", { timeout: SECONDS }, async () => {
    await writeContract(V1);
    const plan = await prepare();
    const step = plan.steps[0];
    if (step.upgradeable?.kind !== "first") throw new Error("expected a first deploy");
    const codeTx = await chain.send({ from: WALLET, data: step.bytecode });
    const code = chain.receipts.get(codeTx)!.contractAddress!;
    const init = encodeFunctionData({ abi: step.abi, functionName: "initialize", args: [gd, BigInt(1000)] });
    const data = encodeDeployData({ abi: step.upgradeable.proxyAbi, bytecode: step.upgradeable.proxyBytecode, args: [code, STRANGER, init] });
    const proxyTx = await chain.send({ from: WALLET, data });
    const out = await refusal(() =>
      recordDeployment(db, { projectId, userId, wallet: WALLET, runId: plan.runId, chainId: SEPOLIA, contractName: "Vault", txHash: proxyTx, sourceHash: plan.sourceHash, evmVersion: plan.evmVersion, proxied: { kind: "proxy", implementationTxHash: codeTx } }, { client: chain.client() }),
    );
    expect(out.code).toBe("wrong_upgrade");
  });
});

/** Each of these would misread what's stored. Each is refused before anyone signs. */
const BREAKING: Record<string, string> = {
  reordered: vault(`  uint256 public cap;\n  IERC20 public gd;\n  uint256 public total;\n  mapping(address => uint256) public balances;\n`),
  removed: vault(`  IERC20 public gd;\n  uint256 public cap;\n  mapping(address => uint256) public balances;\n  uint256 public total2;\n`, "").replace(/total \+= amount;|total -= amount;/g, "total2 = 0;"),
  retyped: vault(STATE.replace("uint256 public cap", "int256 public cap")).replace("cap = cap_;", "cap = int256(cap_);"),
  "retyped, with a note asking the check to allow it": vault(STATE.replace("uint256 public cap", "/// @custom:oz-retyped-from uint256\n  int256 public cap")).replace("cap = cap_;", "cap = int256(cap_);"),
  "inserted in the middle": vault(`  IERC20 public gd;\n  uint256 public added;\n  uint256 public cap;\n  uint256 public total;\n  mapping(address => uint256) public balances;\n`),
  renamed: vault(STATE.replace("public cap", "public limit")).replace("cap = cap_;", "limit = cap_;"),
  "mapping value retyped": vault(STATE.replace("mapping(address => uint256)", "mapping(address => uint128)")).replace("balances[msg.sender] += amount;", "balances[msg.sender] += uint128(amount);").replace("balances[msg.sender] -= amount;", "balances[msg.sender] -= uint128(amount);"),
  "parent removed": `${HEADER}contract Vault is Initializable, ReentrancyGuard {\n${STATE}${BODY.replace("__Ownable_init(msg.sender); ", "")}\n}\n`,
};

describe("storage check", () => {
  for (const [name, source] of Object.entries(BREAKING)) {
    it(`refuses a v2 with storage ${name}, before signing`, { timeout: SECONDS }, async () => {
      const proxy = await liveAtV1();
      const before = chain.txs.size;
      await writeContract(source);
      const error = await refusal(() => prepare());
      expect(chain.txs.size).toBe(before); // refused before anything reached the wallet
      expect(addressIn(await chain.slot(proxy, ADMIN_SLOT))).toBeDefined();
      if (name.includes("note")) {
        expect(error.code).toBe("upgradeable_not_ready");
      } else {
        expect(error.code).toBe("upgrade_refused");
        expect(error.message).toMatch(/scramble/);
        expect(error.message).toMatch(/new contract at a new address/);
      }
    });
  }

  it("needs the note ban: upgrades-core alone would let the noted retype through", { timeout: SECONDS }, async () => {
    const annotated = BREAKING["retyped, with a note asking the check to allow it"];
    const files = (src: string) => ({ "contracts/Vault.sol": src, "contracts/deploy.json": MANIFEST });
    const [a, b] = await Promise.all([compileForDeploy(files(V1), "cancun", undefined, { upgradeable: true }), compileForDeploy(files(annotated), "cancun", undefined, { upgradeable: true })]);
    if (!a.ok || !b.ok) throw new Error("compile failed");
    const raw = await compareLayouts(a.upgradeable!.analyses.Vault.layout, b.upgradeable!.analyses.Vault.layout);
    expect(raw.ok).toBe(true); // the library takes the source's word for it
    expect(b.upgradeable!.issues.map((i) => i.message).join()).toMatch(/Only one @custom note/);
    await writeContract(V1);
    await deploy();
    await writeContract(annotated);
    expect((await refusal(() => prepare())).code).toBe("upgradeable_not_ready");
  });

  it("offers a normal new deploy as the way forward, and says what's left behind", { timeout: SECONDS }, async () => {
    const proxy = await liveAtV1();
    await aliceDeposits(proxy, ONE);
    await writeContract(BREAKING.reordered);
    expect((await refusal(() => prepare())).code).toBe("upgrade_refused");

    const fresh = await deploy({ fresh: true });
    expect(fresh.plan.steps[0].upgradeable?.kind).toBe("first");
    expect(fresh.plan.replaces).toEqual([{ name: "Vault", address: proxy.toLowerCase(), gdBalance: String(ONE) }]);
    expect(fresh.address).not.toBe(proxy);

    // The old proxy still holds its money, and the old-funds card can see it.
    expect(await chain.read(proxy, vaultAbi, "total")).toBe(ONE);
    const old = await oldContractsWithFunds(db, { id: projectId, chainId: SEPOLIA }, chain.client());
    expect(old.map((o) => o.address.toLowerCase())).toEqual([proxy.toLowerCase()]);
    expect(old[0].exits.length).toBeGreaterThan(0);
  });

  it("refuses to build on code changed outside GoodBuild, and on a locked contract", { timeout: SECONDS }, async () => {
    const proxy = await liveAtV1();
    const admin = addressIn(await chain.slot(proxy, ADMIN_SLOT));
    await writeContract(V2_SAFE);
    const plan = await prepare();
    const codeTx = await chain.send({ from: WALLET, data: plan.steps[0].bytecode });
    const code = chain.receipts.get(codeTx)!.contractAddress!;

    // The owner upgrades with another tool. Their right, but GoodBuild no longer knows the layout.
    await chain.send({ from: WALLET, to: admin, data: encodeUpgrade(proxy, code) });
    const elsewhere = await refusal(() => prepare());
    expect(elsewhere.code).toBe("upgrade_refused");
    expect(elsewhere.message).toMatch(/outside GoodBuild/);

    // A second project, locked by its owner.
    const project2 = await createProjectFromPrompt(db, userId, { prompt: "second", network: "celo-sepolia" });
    projectId = project2.id;
    await setUpgradeable(db, project2, true);
    const proxy2 = await liveAtV1();
    const admin2 = addressIn(await chain.slot(proxy2, ADMIN_SLOT));
    const files2 = await loadFiles(db, projectId);
    expect(await hasChangeableContracts(db, { id: projectId, chainId: SEPOLIA }, files2, chain.client())).toBe(true);
    const lockedBefore = await chain.send({ from: STRANGER, to: admin2, data: encodeFunctionData({ abi: proxyAdminAbi, functionName: "renounceOwnership" }) });
    expect(chain.receipts.get(lockedBefore)!.status).toBe("reverted");
    const lock = await chain.send({ from: WALLET, to: admin2, data: encodeFunctionData({ abi: proxyAdminAbi, functionName: "renounceOwnership" }) });
    expect(chain.receipts.get(lock)!.status).toBe("success");
    expect(await hasChangeableContracts(db, { id: projectId, chainId: SEPOLIA }, files2, chain.client())).toBe(false);
    await writeContract(V2_SAFE);
    const locked = await refusal(() => prepare());
    expect(locked.code).toBe("upgrade_refused");
    expect(locked.message).toMatch(/was locked/);
    // The upgrade itself is refused on-chain too, whatever the server would say.
    const forced = await chain.send({ from: WALLET, to: admin2, data: encodeUpgrade(proxy2, code) });
    expect(chain.receipts.get(forced)!.status).toBe("reverted");
  });
});

describe("guardrails: generated code still can't delegatecall", () => {
  const generated = (body: string, imports = "") => `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n${imports}\ncontract Sneaky {\n${body}\n}\n`;
  const CASES: Record<string, string> = {
    "a raw delegatecall": generated(`function f(address t) external { (bool ok, ) = t.delegatecall(""); ok; }`),
    "Address.functionDelegateCall": generated(`function f(address t) external { Address.functionDelegateCall(t, ""); }`, `import {Address} from "@openzeppelin/contracts/utils/Address.sol";`),
    "importing the proxy itself": generated(`function f(address t) external returns (address) { return address(new ERC1967Proxy(t, "")); }`, `import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";`),
    "the upgrade helper": generated(`function f(address t) external { ERC1967Utils.upgradeToAndCall(t, ""); }`, `import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";`),
    Multicall: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\nimport {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";\ncontract Sneaky is Multicall {}\n`,
  };
  for (const [name, source] of Object.entries(CASES)) {
    it(`refuses ${name}, upgradeable or not`, { timeout: SECONDS }, async () => {
      for (const upgradeable of [false, true]) {
        const report = await checkContracts({ "contracts/Sneaky.sol": source }, { upgradeable });
        expect(report.ok).toBe(false);
        expect(report.errors.some((e) => e.source === "guardrail" && /delegatecall|can't import/i.test(e.message))).toBe(true);
      }
    });
  }

  it("refuses storage-slot tricks, and only allows the sealed constructor note", { timeout: SECONDS }, async () => {
    const report = await checkContracts({ "contracts/Sneaky.sol": generated(`function f() external { StorageSlot.getAddressSlot(bytes32(0)).value = address(0); }`, `import {StorageSlot} from "@openzeppelin/contracts/utils/StorageSlot.sol";`) }, { upgradeable: true });
    expect(report.errors.some((e) => /StorageSlot/.test(e.message))).toBe(true);
    const ok = await checkContracts({ "contracts/Vault.sol": V1 }, { upgradeable: true });
    expect(ok.errors.filter((e) => e.source === "guardrail")).toEqual([]);
    for (const note of ["@custom:oz-upgrades-unsafe-allow delegatecall", "@custom:oz-renamed-from cap", "@custom:oz-upgrades-unsafe-allow-reachable delegatecall"]) {
      const tagged = upgradeableIssues("contracts/Vault.sol", { nodes: [] }, `/// ${note}\ncontract Vault {}`);
      expect(tagged.map((i) => i.message).join()).toMatch(/Only one @custom note/);
    }
  });

  it("refuses the upgradeable imports in a normal project", { timeout: SECONDS }, async () => {
    const report = await checkContracts({ "contracts/Vault.sol": V1 });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => /contracts-upgradeable/.test(e.message) || /Only @openzeppelin\/contracts imports/.test(e.message))).toBe(true);
  });

  it("refuses a generated delegatecall at the server's prepare, whatever the agent checks did", { timeout: SECONDS }, async () => {
    const sneaky = vault(STATE, `  function hack(address t) external { (bool ok, ) = t.delegatecall(""); ok; }`);
    await writeContract(sneaky);
    const error = await refusal(() => prepare());
    expect(error.code).toBe("upgradeable_not_ready");
    expect(error.details.join()).toMatch(/delegatecall/);
  });

  it("the platform's own proxy is compiled outside contracts/ and is the only one in the build", { timeout: SECONDS }, async () => {
    const compiled = await compileForDeploy({ "contracts/Vault.sol": V1, "contracts/deploy.json": MANIFEST }, "cancun", undefined, { upgradeable: true });
    if (!compiled.ok) throw new Error(compiled.errors.join());
    expect(compiled.artifacts.map((a) => a.name)).toEqual(["Vault"]);
    expect(compiled.upgradeable?.issues).toEqual([]);
    expect(compiled.upgradeable?.analyses.Vault.errors).toEqual([]);
    expect(PROXY_IDENTIFIER).toBe(`${PROXY_FILE}:${PROXY_NAME}`);
  });

  it("tells the agent during the build, so most breaks never reach the deploy button", { timeout: SECONDS }, async () => {
    await liveAtV1();
    await writeContract(BREAKING.reordered);
    const report = await checkContracts(await loadFiles(db, projectId), { upgradeable: true, upgradeChecks: upgradeChecksFor(db, projectId) });
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => e.message).join()).toMatch(/scramble its stored data/);
    await writeContract(V2_SAFE);
    expect((await checkContracts(await loadFiles(db, projectId), { upgradeable: true, upgradeChecks: upgradeChecksFor(db, projectId) })).ok).toBe(true);
    expect(await liveStorage(db, { id: projectId, chainId: SEPOLIA })).toEqual([{ name: "Vault", variables: expect.arrayContaining(["cap (uint256)", "total (uint256)"]) }]);
  });

  it("the contract test the rules tell the agent to write really deploys through the proxy", { timeout: SECONDS }, async () => {
    const test = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "@goodbuild/Test.sol";
import {MockGoodDollar} from "@goodbuild/MockGoodDollar.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vault} from "../Vault.sol";
contract VaultTest is Test {
  Vault v;
  MockGoodDollar gd;
  function setUp() public {
    gd = new MockGoodDollar();
    v = Vault(payable(address(new TransparentUpgradeableProxy(address(new Vault()), address(this), abi.encodeCall(Vault.initialize, (IERC20(address(gd)), 1000))))));
  }
  function testDeposit() public {
    gd.mint(address(this), 5);
    gd.approve(address(v), 5);
    v.deposit(5);
    assertEq(v.total(), 5, "total");
    assertEq(v.cap(), 1000, "cap");
  }
}
`;
    const files = { "contracts/Vault.sol": V1, "contracts/test/Vault.t.sol": test, "contracts/deploy.json": MANIFEST };
    const report = await checkContracts(files, { upgradeable: true });
    expect(report.errors).toEqual([]);
    const results = await runContractTests(report);
    expect(results.results.map((r) => [r.test, r.ok, r.reason])).toEqual([["testDeposit", true, undefined]]);
  });

  it("refuses an unsafe v1: initial values, immutables, a real constructor, a forgotten parent init", { timeout: SECONDS }, async () => {
    const cases = [
      vault(STATE.replace("uint256 public cap;", "uint256 public cap = 5;")),
      vault(STATE.replace("IERC20 public gd;", "IERC20 public gd;\n  uint256 public immutable forever = 1;")),
      vault(STATE, "").replace("constructor() { _disableInitializers(); }", "constructor() { }"),
      vault(STATE, "").replace("__Ownable_init(msg.sender); ", ""),
    ];
    for (const source of cases) {
      await writeContract(source);
      expect((await refusal(() => prepare())).code).toBe("upgradeable_not_ready");
    }
  });
});

describe("mainnet", () => {
  it("refuses the option at the server even with mainnet switched on, and other projects are untouched", { timeout: SECONDS }, async () => {
    process.env.NEXT_PUBLIC_ENABLE_MAINNET = "true"; // so mainnet_disabled can't be why
    const mainnetProject = await createProjectFromPrompt(db, userId, { prompt: "mainnet", network: "celo" });
    expect((await refusal(() => setUpgradeable(db, mainnetProject, true))).code).toBe("upgradeable_testnet_only");
    expect(await isUpgradeableProject(db, mainnetProject.id)).toBe(false);

    // An upgradeable project can't take its deploy to mainnet by naming the chain in the request.
    await writeContract(V1);
    const atPrepare = await refusal(() => prepareDeploy(db, { projectId, chainId: 42220, wallet: WALLET }, { client: chain.client() }));
    expect(atPrepare.code).toBe("upgradeable_testnet_only");

    // Nor by recording directly, even for a project that never opted in.
    const hash = await chain.send({ from: WALLET, data: "0x00" });
    const input = { userId, wallet: WALLET, runId: "run-00000", chainId: 42220, contractName: "Vault", txHash: hash, sourceHash: `0x${"0".repeat(64)}` as Hex, evmVersion: "cancun" as const, proxied: { kind: "proxy" as const, implementationTxHash: hash } };
    expect((await refusal(() => recordDeployment(db, { ...input, projectId }, { client: chain.client() }))).code).toBe("upgradeable_testnet_only");
    expect((await refusal(() => recordDeployment(db, { ...input, projectId: mainnetProject.id }, { client: chain.client() }))).code).toBe("upgradeable_testnet_only");

    // A normal project on mainnet still prepares normally: the gate is only about this option.
    await saveFiles(db, mainnetProject.id, { "contracts/Plain.sol": `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract Plain { uint256 public x; }\n`, "contracts/deploy.json": `{"contracts":[{"name":"Plain","args":{}}]}` });
    const plain = await prepareDeploy(db, { projectId: mainnetProject.id, chainId: 42220, wallet: WALLET }, { client: chain.client() });
    expect(plain.upgradeable).toBe(false);
    expect(plain.steps[0].upgradeable).toBeUndefined();
  });

  it("is off by default, and a normal project keeps its hashes and its plain deploy", { timeout: SECONDS }, async () => {
    const project = await createProjectFromPrompt(db, userId, { prompt: "plain", network: "celo-sepolia" });
    expect(await isUpgradeableProject(db, project.id)).toBe(false);
    const files = { "contracts/Plain.sol": "contract Plain {}", "contracts/deploy.json": "{}" };
    expect(sourceKey(files, "cancun")).toBe(sourceKey(files, "cancun", { upgradeable: false }));
    expect(sourceKey(files, "cancun")).not.toBe(sourceKey(files, "cancun", { upgradeable: true }));
  });
});

describe("verification", () => {
  it("the saved standard JSON rebuilds both contracts byte for byte", { timeout: SECONDS }, async () => {
    const compiled = await compileForDeploy({ "contracts/Vault.sol": V1, "contracts/deploy.json": MANIFEST }, "cancun", undefined, { upgradeable: true });
    if (!compiled.ok || !compiled.upgradeable) throw new Error("compile failed");
    const input = compiled.stdJsonInput as { sources: Record<string, { content: string }>; settings: { evmVersion: "cancun" } };
    // What a verifier does: only the saved sources, with no import resolver, and its own output list.
    const { output } = await runSolc(Object.fromEntries(Object.entries(input.sources).map(([k, v]) => [k, v.content])), undefined, { evmVersion: input.settings.evmVersion, upgradeable: true });
    expect(`0x${output.contracts!["contracts/Vault.sol"].Vault.evm.bytecode.object}`).toBe(compiled.artifacts[0].bytecode);
    expect(`0x${output.contracts![PROXY_FILE][PROXY_NAME].evm.bytecode.object}`).toBe(compiled.upgradeable.proxy.bytecode);
  });

  it("submits the code and the proxy separately, and is only green when both match", { timeout: SECONDS }, async () => {
    await liveAtV1();
    const [row] = await db.select().from(deployments);
    const sent: Array<{ url: string; contractIdentifier: string; creationTransactionHash: string }> = [];
    let proxyFails = true;
    const fake = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { contractIdentifier: string; creationTransactionHash: string };
        sent.push({ url, ...body });
        return new Response(JSON.stringify({ verificationId: body.contractIdentifier === PROXY_IDENTIFIER ? "proxy" : "code" }), { status: 202 });
      }
      const failed = url.endsWith("proxy") && proxyFails;
      return new Response(JSON.stringify({ isJobCompleted: true, contract: { match: failed ? null : "exact_match" }, error: failed ? { message: "no match" } : undefined }));
    }) as typeof fetch;

    const partly = await verifyProxied(row, fake, { pollMs: 1, polls: 1 });
    expect(partly.status).toBe("failed");
    expect(partly.detail).toMatch(/The proxy/);
    expect(sent.map((s) => s.contractIdentifier)).toEqual(["contracts/Vault.sol:Vault", PROXY_IDENTIFIER]);
    expect(sent[0].url).toContain(row.proxy!.implementation);
    expect(sent[0].creationTransactionHash).toBe(row.proxy!.implementationTx);
    expect(sent[1].url).toContain(row.address);
    expect(sent[1].creationTransactionHash).toBe(row.txHash);

    proxyFails = false;
    expect((await verifyProxied(row, fake, { pollMs: 1, polls: 1 })).status).toBe("verified");
  });
});
