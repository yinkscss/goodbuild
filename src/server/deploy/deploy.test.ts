// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, type Address, type Hex, type PublicClient } from "viem";

import { signInUser } from "@/server/auth/service";
import { loadFiles, saveFiles } from "@/server/agent/store";
import { createTestDb, type Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { messages } from "@/server/db/schema";
import { createProjectFromPrompt } from "@/server/projects";
import { abisInModules, deploymentsBlock, loadDeployedAddresses, withDeployedAddresses } from "./addresses";
import { compileForDeploy, sourceKey } from "./compile";
import { DeployError, prepareDeploy, recordDeployment } from "./service";
import { verifyOnSourcify } from "./verify";
import { contractModule } from "@/server/agent/template";

const HEADER = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";
const TOKEN = HEADER + `import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract RTXToken is ERC20 { constructor() ERC20("RTX", "RTX") { _mint(msg.sender, 1000 ether); } }
`;
const POOL = HEADER + `import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract RTXPool { IERC20 public immutable gd; IERC20 public immutable rtx; constructor(IERC20 gd_, IERC20 rtx_) { gd = gd_; rtx = rtx_; } }
`;
// SignatureChecker uses MCOPY in OpenZeppelin 5.6, so it can't compile for paris without the pinned release.
const SIG = HEADER + `import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
contract Verifier { function ok(address s, bytes32 h, bytes calldata sig) external view returns (bool) { return SignatureChecker.isValidSignatureNow(s, h, sig); } }
`;
const MANIFEST = JSON.stringify({
  contracts: [
    { name: "RTXPool", args: { gd_: "${GOODDOLLAR}", rtx_: "${RTXToken.address}" } },
    { name: "RTXToken", args: {} },
  ],
});

const WALLET = "0x7a3000000000000000000000000000000000e41c";
const TEST_GD: Address = "0x00000000000000000000000000000000000000d1";

let db: Db;
let userId: string;
let projectId: string;

beforeEach(async () => {
  process.env.NEXT_PUBLIC_TEST_GD_ADDRESS = TEST_GD;
  db = await createTestDb();
  const user = await signInUser(db, { wallet: WALLET, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  const project = await createProjectFromPrompt(db, userId, { prompt: "RTX token and pool", network: "celo-sepolia" });
  projectId = project.id;
  await saveFiles(db, projectId, {
    "contracts/RTXToken.sol": TOKEN,
    "contracts/RTXPool.sol": POOL,
    "contracts/deploy.json": MANIFEST,
    "src/contracts/RTXToken.ts": contractModule("RTXToken", []),
    "src/contracts/RTXPool.ts": contractModule("RTXPool", []),
  });
});

describe("compileForDeploy", () => {
  it("returns creation bytecode, ABI and a standard JSON input with the imports", async () => {
    const out = await compileForDeploy({ "contracts/RTXToken.sol": TOKEN });
    if (!out.ok) throw new Error(out.errors.join("\n"));
    expect(out.evmVersion).toBe("cancun");
    expect(out.compilerVersion).toMatch(/^0\.8\.\d+\+commit\.[0-9a-f]+$/);
    expect(out.artifacts[0].bytecode).toMatch(/^0x60/);
    const sources = Object.keys((out.stdJsonInput as { sources: object }).sources);
    expect(sources).toContain("contracts/RTXToken.sol");
    expect(sources).toContain("@openzeppelin/contracts/token/ERC20/ERC20.sol");
  }, 60_000);

  it("compiles for paris with no PUSH0 or MCOPY (D17)", async () => {
    const out = await compileForDeploy({ "contracts/RTXToken.sol": TOKEN }, "paris");
    if (!out.ok) throw new Error(out.errors.join("\n"));
    const hex = out.artifacts[0].bytecode;
    expect(out.evmVersion).toBe("paris");
    expect(out.openZeppelin).toBe("5.6.1");
    // Solidity 0.8.28 emits PUSH0 (0x5f) for Shanghai+; a paris build uses PUSH1 0x00 instead.
    const cancun = await compileForDeploy({ "contracts/RTXToken.sol": TOKEN }, "cancun");
    if (!cancun.ok) throw new Error("cancun failed");
    expect(hex).not.toBe(cancun.artifacts[0].bytecode);
  }, 60_000);

  it("falls back to the pinned pre-MCOPY OpenZeppelin when a dependency needs Cancun", async () => {
    const cancun = await compileForDeploy({ "contracts/Verifier.sol": SIG }, "cancun");
    expect(cancun.ok).toBe(true);
    const paris = await compileForDeploy({ "contracts/Verifier.sol": SIG }, "paris");
    if (!paris.ok) throw new Error(paris.errors.join("\n"));
    expect(paris.openZeppelin).toBe("5.1.0");
  }, 120_000);

  it("reports compile errors without throwing", async () => {
    const out = await compileForDeploy({ "contracts/Bad.sol": HEADER + "contract Bad { function f() external { oops } }" });
    expect(out.ok).toBe(false);
  }, 60_000);
});

describe("prepareDeploy", () => {
  it("orders the manifest, prefills the test G$ on Sepolia and leaves references for the browser", async () => {
    const plan = await prepareDeploy(db, { projectId, chainId: 11142220 });
    expect(plan.steps.map((s) => s.name)).toEqual(["RTXToken", "RTXPool"]);
    expect(plan.gooddollar).toBe(TEST_GD);
    expect(plan.isTestGooddollar).toBe(true);
    expect(plan.steps[1].args.rtx_).toBe("${RTXToken.address}");
    expect(plan.steps[0].bytecode).toMatch(/^0x/);
  }, 60_000);

  it("uses the real G$ on mainnet, but only when mainnet is enabled", async () => {
    await expect(prepareDeploy(db, { projectId, chainId: 42220 })).rejects.toMatchObject({ code: "mainnet_disabled" });
    process.env.NEXT_PUBLIC_ENABLE_MAINNET = "true";
    try {
      const plan = await prepareDeploy(db, { projectId, chainId: 42220 });
      expect(plan.gooddollar).toBe("0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
      expect(plan.isTestGooddollar).toBe(false);
    } finally {
      delete process.env.NEXT_PUBLIC_ENABLE_MAINNET;
    }
  }, 60_000);

  it("asks for the test G$ when Sepolia has none", async () => {
    delete process.env.NEXT_PUBLIC_TEST_GD_ADDRESS;
    await expect(prepareDeploy(db, { projectId, chainId: 11142220 })).rejects.toMatchObject({ code: "gooddollar_missing" });
  });

  it("fails clearly without a manifest, on a cycle, and on a bad reference", async () => {
    const files = await loadFiles(db, projectId);
    const rest = { ...files };
    delete rest["contracts/deploy.json"];
    await saveFiles(db, projectId, rest);
    await expect(prepareDeploy(db, { projectId, chainId: 11142220 })).rejects.toMatchObject({ code: "manifest_missing" });

    const cyc = JSON.stringify({
      contracts: [
        { name: "RTXToken", args: {} },
        { name: "RTXPool", args: { gd_: "${RTXPool.address}", rtx_: "${RTXToken.address}" } },
      ],
    });
    await saveFiles(db, projectId, { ...rest, "contracts/deploy.json": cyc });
    await expect(prepareDeploy(db, { projectId, chainId: 11142220 })).rejects.toBeInstanceOf(DeployError);
  });
});

/** A chain stand-in: one mined contract creation. */
function fakeChain(over: { from?: string; to?: string | null; status?: "success" | "reverted"; input?: Hex; contractAddress?: Address | null } = {}) {
  const calls = { input: "0x" as Hex };
  const client = {
    waitForTransactionReceipt: async () => ({
      status: over.status ?? "success",
      contractAddress: over.contractAddress === undefined ? "0x1111111111111111111111111111111111111111" : over.contractAddress,
      blockNumber: BigInt(123),
    }),
    getTransaction: async () => ({ from: over.from ?? WALLET, to: over.to === undefined ? null : over.to, input: over.input ?? calls.input }),
  } as unknown as PublicClient;
  return { client, calls };
}

describe("recordDeployment", () => {
  async function plan() {
    return prepareDeploy(db, { projectId, chainId: 11142220 });
  }
  const base = async (p: Awaited<ReturnType<typeof plan>>, step = 0) => ({
    projectId,
    userId,
    wallet: WALLET,
    runId: p.runId,
    chainId: 11142220,
    contractName: p.steps[step].name,
    txHash: ("0x" + "ab".repeat(32)) as Hex,
    sourceHash: p.sourceHash,
    evmVersion: p.evmVersion,
  });

  it("takes the address and arguments from the chain and writes them into the contract module", async () => {
    const p = await plan();
    const args = encodeAbiParameters([{ type: "address" }, { type: "address" }], [TEST_GD, "0x2222222222222222222222222222222222222222"]);
    const { client } = fakeChain({ input: (p.steps[1].bytecode + args.slice(2)) as Hex, contractAddress: "0x3333333333333333333333333333333333333333" });
    const row = await recordDeployment(db, await base(p, 1), { client });
    expect(row.address).toBe("0x3333333333333333333333333333333333333333");
    expect(row.constructorArgs).toBe(args);
    expect(row.deployer).toBe(WALLET);

    const files = await loadFiles(db, projectId);
    expect(files["src/contracts/RTXPool.ts"]).toContain('"11142220": "0x3333333333333333333333333333333333333333"');
    expect(files["src/contracts/RTXToken.ts"]).not.toContain("0x3333");
    const notes = await db.select().from(messages).where(eq(messages.projectId, projectId));
    expect(notes.find((m) => m.role === "system")?.content).toContain("RTXPool is live on Celo Sepolia at 0x3333");

    const addresses = await loadDeployedAddresses(db, projectId);
    expect(deploymentsBlock(addresses)).toContain("RTXPool on chain 11142220: 0x3333");
    expect(deploymentsBlock({})).toBe("");
    // A rebuild that changed the ABI must not point the new ABI at the old contract.
    expect((await loadDeployedAddresses(db, projectId, { RTXPool: [{ type: "function", name: "changed" }] })).RTXPool).toBeUndefined();
    expect((await loadDeployedAddresses(db, projectId, { RTXPool: row.abi })).RTXPool).toBeDefined();
    // A jsonb column reorders keys, and that alone must not count as a changed ABI.
    const reordered = (row.abi as Array<Record<string, unknown>>).map((item) => Object.fromEntries(Object.entries(item).reverse()));
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(row.abi));
    expect((await loadDeployedAddresses(db, projectId, { RTXPool: reordered })).RTXPool).toBeDefined();
  }, 90_000);

  it("is idempotent for the same transaction", async () => {
    const p = await plan();
    const { client } = fakeChain({ input: p.steps[0].bytecode });
    const a = await recordDeployment(db, await base(p, 0), { client });
    const b = await recordDeployment(db, await base(p, 0), { client });
    expect(b.id).toBe(a.id);
  }, 90_000);

  it("refuses a transaction from another wallet, a non-creation, a failure and foreign bytecode", async () => {
    const p = await plan();
    const input = base(p, 0);
    await expect(recordDeployment(db, await input, { client: fakeChain({ from: "0x9999999999999999999999999999999999999999", input: p.steps[0].bytecode }).client })).rejects.toMatchObject({ code: "wrong_sender" });
    await expect(recordDeployment(db, await input, { client: fakeChain({ to: "0x1234567890123456789012345678901234567890", input: p.steps[0].bytecode }).client })).rejects.toMatchObject({ code: "not_contract_creation" });
    await expect(recordDeployment(db, await input, { client: fakeChain({ status: "reverted", input: p.steps[0].bytecode }).client })).rejects.toMatchObject({ code: "tx_failed" });
    await expect(recordDeployment(db, await input, { client: fakeChain({ input: "0x6080604052" }).client })).rejects.toMatchObject({ code: "bytecode_mismatch" });
    expect((await db.select().from(deployments)).length).toBe(0);
  }, 90_000);

  it("refuses when the source changed since prepare", async () => {
    const p = await plan();
    const files = await loadFiles(db, projectId);
    await saveFiles(db, projectId, { ...files, "contracts/RTXToken.sol": TOKEN.replace("1000 ether", "2000 ether") });
    await expect(recordDeployment(db, await base(p, 0), { client: fakeChain({ input: p.steps[0].bytecode }).client })).rejects.toMatchObject({ code: "source_changed" });
  }, 90_000);

  it("a changed manifest is a new deployment, even with the same contracts", async () => {
    const files = { "contracts/Token.sol": TOKEN, "contracts/deploy.json": MANIFEST };
    expect(sourceKey(files, "cancun")).not.toBe(sourceKey({ ...files, "contracts/deploy.json": MANIFEST + " " }, "cancun"));
    expect(sourceKey(files, "cancun")).toBe(sourceKey({ ...files, "src/App.tsx": "x" }, "cancun"));
  });

  it("resumes: a second prepare reports what is already deployed from the same source", async () => {
    const p = await plan();
    await recordDeployment(db, await base(p, 0), { client: fakeChain({ input: p.steps[0].bytecode, contractAddress: "0x4444444444444444444444444444444444444444" }).client });
    const again = await plan();
    expect(again.alreadyDeployed.RTXToken).toBe("0x4444444444444444444444444444444444444444");
    expect(again.alreadyDeployed.RTXPool).toBeUndefined();
  }, 120_000);
});

describe("addresses survive rebuilds", () => {
  it("empties a module's stale map, and reads the ABI back out of the module", () => {
    const abi = [{ type: "function", name: "x" }];
    const files = { "src/contracts/RTXToken.ts": contractModule("RTXToken", abi, { 11142220: "0x4444444444444444444444444444444444444444" }), "src/contracts/index.ts": 'export * from "./RTXToken";\n' };
    expect(withDeployedAddresses(files, {})["src/contracts/RTXToken.ts"]).not.toContain("0x4444");
    expect(withDeployedAddresses(files, {})["src/contracts/index.ts"]).toBe(files["src/contracts/index.ts"]);
    expect(abisInModules(files)).toEqual({ RTXToken: abi });
  });

  it("withDeployedAddresses rewrites only the address map of a regenerated module", async () => {
    const regenerated = { "src/contracts/RTXToken.ts": contractModule("RTXToken", [{ type: "function", name: "x" }]), "src/App.tsx": "x" };
    const out = withDeployedAddresses(regenerated, { RTXToken: { 11142220: "0x4444444444444444444444444444444444444444" } });
    expect(out["src/contracts/RTXToken.ts"]).toContain("0x4444444444444444444444444444444444444444");
    expect(out["src/contracts/RTXToken.ts"]).toContain('"name": "x"');
    expect(out["src/App.tsx"]).toBe("x");
    expect(await loadDeployedAddresses(db, projectId)).toEqual({});
  });
});

describe("verifyOnSourcify", () => {
  const dep = {
    chainId: 11142220,
    address: "0x3333333333333333333333333333333333333333",
    txHash: "0x" + "ab".repeat(32),
    contractName: "RTXToken",
    compilerVersion: "0.8.28+commit.7893614a",
    stdJsonInput: { language: "Solidity", sources: { "contracts/RTXToken.sol": { content: "x" } } },
  } as never;

  it("submits the standard JSON and reports a match", async () => {
    const seen: string[] = [];
    let posted: Record<string, unknown> = {};
    const f = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "POST") posted = JSON.parse(String(init.body));
      if (init?.method === "POST") return Response.json({ verificationId: "550e8400-e29b-41d4-a716-446655440000" }, { status: 202 });
      return Response.json({ isJobCompleted: true, contract: { match: "exact_match" } });
    }) as typeof fetch;
    const out = await verifyOnSourcify(dep, f, { pollMs: 1 });
    expect(out.status).toBe("verified");
    expect(seen[0]).toMatch(/POST .*\/v2\/verify\/11142220\/0x3333/);
    expect(posted).toMatchObject({ compilerVersion: "0.8.28+commit.7893614a", contractIdentifier: "contracts/RTXToken.sol:RTXToken", creationTransactionHash: "0x" + "ab".repeat(32) });
  });

  it("reports a failed match and stays pending while the job runs", async () => {
    const failing = (async (_u: string, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ verificationId: "550e8400-e29b-41d4-a716-446655440000" }, { status: 202 }) : Response.json({ isJobCompleted: true, contract: { match: null }, error: { message: "no match" } })) as typeof fetch;
    expect((await verifyOnSourcify(dep, failing, { pollMs: 1 })).status).toBe("failed");
    const slow = (async (_u: string, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ verificationId: "550e8400-e29b-41d4-a716-446655440000" }, { status: 202 }) : Response.json({ isJobCompleted: false })) as typeof fetch;
    expect((await verifyOnSourcify(dep, slow, { pollMs: 1, polls: 2 })).status).toBe("pending");
  });
});

