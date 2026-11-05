import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { createPublicClient, erc20Abi, getAddress, http, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { celo, celoSepolia } from "viem/chains";

import { goodDollarAddress, isTestGoodDollar } from "@/config/gooddollar";
import { isMainnetEnabled } from "@/config/networks";
import { chainLabel } from "@/lib/deploy/explorer";
import { MANIFEST_PATH, parseManifest, planManifest, referencesIn, type ArgValue } from "@/lib/deploy/manifest";
import type { ProxyInfo, UpgradeableStep } from "@/lib/deploy/upgradeable";
import { loadFiles } from "@/server/agent/store";
import { PLATFORM_DIR } from "@/server/agent/template";
import type { Db } from "@/server/db/client";
import { deployments, type Deployment } from "@/server/db/deploy-schema";
import { messages, projectFiles, projects } from "@/server/db/schema";
import { withCurrentAddresses } from "./addresses";
import { compileForDeploy, type DeployCompile, type EvmVersion } from "./compile";
import { DeployError } from "./deploy-error";
import {
  adoptUnchanged,
  assertUpgradeableChain,
  buildProblems,
  existingUpgrade,
  isUpgradeableProject,
  latestProxyRows,
  planProxyUpgrade,
  readAuthority,
  readProxy,
  recordProxyCreation,
  recordUpgrade,
  refusalError,
  type UpgradeRefusal,
} from "./upgradeable";

export { DeployError, type DeployErrorCode } from "./deploy-error";

export interface DeployStepPlan {
  name: string;
  file: string;
  abi: Abi;
  bytecode: Hex;
  deployedBytecode: Hex;
  bytecodeBytes: number;
  /** Constructor arguments by parameter name, references still unresolved. */
  args: Record<string, ArgValue>;
  dependsOn: string[];
  /** Behind a proxy (D33): a first deploy or a live proxy getting new code. */
  upgradeable?: UpgradeableStep;
}

export interface DeployPlan {
  runId: string;
  projectId: string;
  version: number;
  chainId: number;
  evmVersion: EvmVersion;
  compilerVersion: string;
  openZeppelin: string;
  sourceHash: Hex;
  /** G$ for this chain, or null when there isn't one yet (test G$ not deployed). */
  gooddollar: Address | null;
  isTestGooddollar: boolean;
  /** Everything GoodBuild generates is unaudited (CONTRACTS_AND_DEPLOYMENT.md §2). */
  unaudited: true;
  steps: DeployStepPlan[];
  /** Steps already deployed from this exact source on this chain, so a retry resumes. */
  alreadyDeployed: Record<string, Address>;
  /** Live contracts this deploy leaves behind. They keep their funds and history. */
  replaces: ReplacedContract[];
  /** This project opted in to upgradeable contracts (D33). */
  upgradeable: boolean;
  /** Live proxies that get new code at the same address. They aren't replaced: nothing is left behind. */
  upgrades: Array<{ name: string; address: Address }>;
  /** Live proxies by contract name, with who can still change each one (read from the chain). */
  proxies: Record<string, ProxyInfo>;
}

export interface ReplacedContract {
  name: string;
  address: Address;
  /** G$ the old contract holds, in wei as a string, or null if there's no G$ here or the read failed. */
  gdBalance: string | null;
}

export function assertChain(chainId: number, mainnetEnabled = isMainnetEnabled(process.env.NEXT_PUBLIC_ENABLE_MAINNET)) {
  if (chainId === celo.id) {
    if (!mainnetEnabled) throw new DeployError("mainnet_disabled", "Celo mainnet deploys are switched off for now. Use Celo Sepolia.");
    return;
  }
  if (chainId !== celoSepolia.id) throw new DeployError("unsupported_chain", "GoodBuild deploys to Celo Sepolia or Celo.");
}

/**
 * Compile the saved project, validate its deploy manifest, and return the ordered plan the browser
 * walks through (one wallet signature per contract). The browser fills references as it goes.
 */
export async function prepareDeploy(
  db: Db,
  input: {
    projectId: string;
    chainId: number;
    evmVersion?: EvmVersion;
    /** The session wallet: it must hold a proxy's upgrade authority. */
    wallet?: string;
    /** After a refused upgrade: deploy what changed as new contracts at new addresses instead. */
    fresh?: boolean;
  },
  deps: { compile?: typeof compileForDeploy; client?: Pick<PublicClient, "readContract" | "getStorageAt"> } = {},
): Promise<DeployPlan> {
  assertChain(input.chainId);
  // Keyed on the chain this request names, not only the project's: this is the rule at the server.
  const upgradeable = await isUpgradeableProject(db, input.projectId);
  if (upgradeable) assertUpgradeableChain(input.chainId);
  const files = await loadFiles(db, input.projectId);
  const [project] = await db.select({ version: projects.currentVersion }).from(projects).where(eq(projects.id, input.projectId)).limit(1);

  const manifestSource = files[MANIFEST_PATH];
  if (!manifestSource) {
    throw new DeployError("manifest_missing", `This project has no deploy manifest (${MANIFEST_PATH}) yet. Ask the builder to add one.`);
  }
  const parsed = parseManifest(manifestSource);
  if (!parsed.ok) throw new DeployError("manifest_invalid", "The deploy manifest has problems.", parsed.issues.map((i) => i.message));

  const compiled = await (deps.compile ?? compileForDeploy)(files, input.evmVersion ?? "cancun", undefined, { upgradeable });
  if (!compiled.ok) throw new DeployError("compile_failed", "The contracts didn't compile.", compiled.errors.slice(0, 8));

  const plan = planManifest(parsed.manifest, compiled.artifacts.map((a) => ({ name: a.name, abi: a.abi })), { upgradeable });
  if (!plan.ok) {
    if (upgradeable) throw new DeployError("upgradeable_not_ready", NOT_READY, plan.issues.map((i) => i.message));
    throw new DeployError("manifest_invalid", "The deploy manifest has problems.", plan.issues.map((i) => i.message));
  }
  if (compiled.upgradeable) {
    const problems = buildProblems(compiled.upgradeable, plan.steps.map((s) => s.name));
    if (problems.length) throw new DeployError("upgradeable_not_ready", NOT_READY, problems.slice(0, 12));
  }

  const gooddollar = goodDollarAddress(input.chainId);
  const usesGd = plan.steps.some((s) => Object.values(s.args).some((v) => referencesIn(v).some((r) => r.ref?.kind === "gooddollar")));
  if (usesGd && !gooddollar) {
    throw new DeployError("gooddollar_missing", "There's no test G$ on Celo Sepolia yet. Deploy it first (pnpm deploy:test-gd) and set NEXT_PUBLIC_TEST_GD_ADDRESS.");
  }

  const byName = new Map(compiled.artifacts.map((a) => [a.name, a]));
  const rows = await db
    .select()
    .from(deployments)
    .where(and(eq(deployments.projectId, input.projectId), eq(deployments.chainId, input.chainId), eq(deployments.sourceHash, compiled.sourceHash)))
    .orderBy(desc(deployments.createdAt));
  const alreadyDeployed: Record<string, Address> = {};
  for (const r of rows) alreadyDeployed[r.contractName] ??= r.address as Address;

  const replaced = await db
    .select({ name: deployments.contractName, address: deployments.address })
    .from(deployments)
    .where(and(eq(deployments.projectId, input.projectId), eq(deployments.chainId, input.chainId)))
    .orderBy(desc(deployments.createdAt));
  const latest = new Map<string, Address>();
  for (const r of replaced) if (!latest.has(r.name)) latest.set(r.name, r.address as Address);

  const routes = compiled.upgradeable ? await routeProxies(db, input, compiled, plan.steps, alreadyDeployed, deps.client) : null;
  if (routes) Object.assign(alreadyDeployed, routes.unchanged);

  const replaces = await Promise.all(
    plan.steps
      .filter((s) => !alreadyDeployed[s.name] && latest.has(s.name) && !routes?.upgrades[s.name])
      .map(async (s): Promise<ReplacedContract> => {
        const address = latest.get(s.name)!;
        return { name: s.name, address, gdBalance: gooddollar ? await readGdBalance(deps.client ?? publicClientFor(input.chainId), gooddollar, address) : null };
      }),
  );

  const stepPlan = (s: (typeof plan.steps)[number]): UpgradeableStep | undefined => {
    if (!compiled.upgradeable) return undefined;
    const upgrade = routes?.upgrades[s.name];
    if (upgrade) return { kind: "upgrade", proxy: upgrade.address, admin: upgrade.admin };
    return { kind: "first", proxyAbi: compiled.upgradeable.proxy.abi, proxyBytecode: compiled.upgradeable.proxy.bytecode };
  };

  return {
    runId: randomUUID(),
    projectId: input.projectId,
    version: project?.version ?? 0,
    chainId: input.chainId,
    evmVersion: compiled.evmVersion,
    compilerVersion: compiled.compilerVersion,
    openZeppelin: compiled.openZeppelin,
    sourceHash: compiled.sourceHash,
    gooddollar,
    isTestGooddollar: isTestGoodDollar(input.chainId),
    unaudited: true,
    steps: plan.steps.map((s) => {
      const a = byName.get(s.name)!;
      return { name: s.name, file: a.file, abi: a.abi, bytecode: a.bytecode, deployedBytecode: a.deployedBytecode, bytecodeBytes: (a.bytecode.length - 2) / 2, args: s.args, dependsOn: s.dependsOn, upgradeable: stepPlan(s) };
    }),
    alreadyDeployed,
    replaces,
    upgradeable,
    upgrades: Object.values(routes?.upgrades ?? {}).map((u) => ({ name: u.name, address: u.address })),
    proxies: routes?.proxies ?? {},
  };
}

const NOT_READY = "These contracts aren't ready to be upgradeable yet. Ask the builder to convert them, or turn upgrades off for this project.";

/**
 * For each contract with a live proxy: nothing changed, a safe upgrade, or a refusal. A refused
 * upgrade stops the whole plan unless the user chose a normal new deploy (`fresh`), and that choice
 * also covers anything built on what becomes a new address.
 */
async function routeProxies(
  db: Db,
  input: { projectId: string; chainId: number; wallet?: string; fresh?: boolean },
  compiled: DeployCompile,
  steps: Array<{ name: string; dependsOn: string[] }>,
  alreadyDeployed: Record<string, Address>,
  client: Pick<PublicClient, "readContract" | "getStorageAt"> = publicClientFor(input.chainId),
) {
  const proxyRows = await latestProxyRows(db, { id: input.projectId, chainId: input.chainId });
  const artifacts = new Map(compiled.artifacts.map((a) => [a.name, a]));
  const unchanged: Record<string, Address> = {};
  const upgrades: Record<string, { name: string; address: Address; admin: Address }> = {};
  const proxies: Record<string, ProxyInfo> = {};
  const refusals: UpgradeRefusal[] = [];

  for (const step of steps) {
    const row = proxyRows.get(step.name);
    if (!row?.proxy) continue;
    const artifact = artifacts.get(step.name)!;
    if (alreadyDeployed[step.name]) {
      const live = await readProxy(client, getAddress(row.address)).catch(() => null);
      if (live) proxies[step.name] = { address: getAddress(row.address), admin: live.admin, implementation: live.implementation, authority: await readAuthority(client, live.admin, input.wallet) };
      continue;
    }
    const outcome = await planProxyUpgrade(client, row, artifact, compiled.upgradeable!, input.wallet);
    if ("reason" in outcome) {
      if (!input.fresh) refusals.push(outcome);
      continue;
    }
    proxies[step.name] = outcome.info;
    if (outcome.kind === "unchanged") unchanged[step.name] = getAddress(row.address);
    else if (!input.fresh) upgrades[step.name] = { name: step.name, address: getAddress(row.address), admin: outcome.info.admin };
  }
  if (refusals.length) throw refusalError(refusals);

  // A contract is built with the addresses it depends on, so a dependency at a new address means it is new too.
  if (input.fresh) {
    for (const step of steps) {
      if (unchanged[step.name] && step.dependsOn.some((d) => !unchanged[d] && !alreadyDeployed[d])) delete unchanged[step.name];
    }
  }
  if (Object.keys(unchanged).length) await adoptUnchanged(db, compiled, { id: input.projectId, chainId: input.chainId }, Object.keys(unchanged));
  return { unchanged, upgrades, proxies };
}

/** A warning shouldn't block a deploy, so a failed read just means the balance isn't shown. */
async function readGdBalance(client: Pick<PublicClient, "readContract">, token: Address, holder: Address): Promise<string | null> {
  try {
    return String(await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] }));
  } catch {
    return null;
  }
}

/** Public client for a Celo chain. RPC overridable with CELO_RPC_URL / CELO_SEPOLIA_RPC_URL. */
export function publicClientFor(chainId: number): PublicClient {
  const chain = chainId === celo.id ? celo : celoSepolia;
  const url = chainId === celo.id ? process.env.CELO_RPC_URL : process.env.CELO_SEPOLIA_RPC_URL;
  return createPublicClient({ chain, transport: http(url || undefined) }) as PublicClient;
}

export interface RecordInput {
  projectId: string;
  userId: string;
  /** The session wallet (lowercase). The transaction must come from it. */
  wallet: string;
  runId: string;
  chainId: number;
  contractName: string;
  txHash: Hex;
  sourceHash: Hex;
  evmVersion: EvmVersion;
  /** Behind a proxy (D33): what `txHash` is, and the transaction that deployed the new code. */
  proxied?: { kind: "proxy" | "upgrade"; implementationTxHash: Hex };
}

/**
 * Record a deployment, trusting only the chain: the address, sender and constructor arguments come
 * from the receipt and transaction, never from the browser (CONTRACTS_AND_DEPLOYMENT.md §3). The
 * creation input must start with the bytecode GoodBuild compiled for that contract.
 */
export async function recordDeployment(
  db: Db,
  input: RecordInput,
  deps: { client?: PublicClient; compile?: typeof compileForDeploy } = {},
): Promise<Deployment> {
  assertChain(input.chainId);
  const client = deps.client ?? publicClientFor(input.chainId);

  const existing = await db
    .select()
    .from(deployments)
    .where(and(eq(deployments.chainId, input.chainId), eq(deployments.txHash, input.txHash.toLowerCase())))
    .limit(1);
  if (existing[0]) {
    if (existing[0].userId !== input.userId || existing[0].projectId !== input.projectId) throw new DeployError("wrong_sender", "That transaction belongs to another project.");
    return existing[0]; // idempotent: a retried request returns the same row
  }

  const upgradeable = await isUpgradeableProject(db, input.projectId);
  if (upgradeable || input.proxied) {
    assertUpgradeableChain(input.chainId);
    if (!upgradeable) throw new DeployError("wrong_upgrade", "This project isn't upgradeable, so GoodBuild won't record a proxy for it.");
    if (!input.proxied) throw new DeployError("wrong_upgrade", "This project's contracts deploy behind a proxy. Start the deploy again.");
    const proxiedInput = { ...input, implementationTxHash: input.proxied.implementationTxHash };
    const retried = await existingUpgrade(db, input);
    if (retried) return retried;
    const row = input.proxied.kind === "upgrade" ? await recordUpgrade(db, proxiedInput, { client, compile: deps.compile }) : await recordProxyCreation(db, proxiedInput, { client, compile: deps.compile });
    await syncContractModules(db, input.projectId);
    await db.update(projects).set({ status: "deployed" }).where(eq(projects.id, input.projectId));
    return row;
  }

  const [receipt, tx] = await Promise.all([
    client.waitForTransactionReceipt({ hash: input.txHash, timeout: 45_000 }).catch(() => null),
    client.getTransaction({ hash: input.txHash }).catch(() => null),
  ]);
  if (!receipt || !tx) throw new DeployError("tx_not_found", "The network doesn't know that transaction yet. Try again in a moment.");
  if (receipt.status !== "success") throw new DeployError("tx_failed", "That deployment transaction failed on-chain.");
  if (tx.to !== null || !receipt.contractAddress) throw new DeployError("not_contract_creation", "That transaction didn't create a contract.");
  if (tx.from.toLowerCase() !== input.wallet.toLowerCase()) {
    throw new DeployError("wrong_sender", "That transaction wasn't sent by your signed-in wallet.");
  }

  const files = await loadFiles(db, input.projectId);
  const compiled = await (deps.compile ?? compileForDeploy)(files, input.evmVersion);
  if (!compiled.ok || compiled.sourceHash !== input.sourceHash) {
    throw new DeployError("source_changed", "The project's code changed since this deploy started. Start the deploy again.");
  }
  const artifact = compiled.artifacts.find((a) => a.name === input.contractName);
  if (!artifact) throw new DeployError("wrong_contract", `${input.contractName} isn't a contract in this project.`);
  const creation = tx.input.toLowerCase();
  if (!creation.startsWith(artifact.bytecode.toLowerCase())) {
    throw new DeployError("bytecode_mismatch", `That transaction didn't deploy GoodBuild's compiled ${input.contractName}.`);
  }
  const address = getAddress(receipt.contractAddress);
  const [project] = await db.select({ version: projects.currentVersion }).from(projects).where(eq(projects.id, input.projectId)).limit(1);

  const [row] = await db
    .insert(deployments)
    .values({
      projectId: input.projectId,
      userId: input.userId,
      version: project?.version ?? 0,
      runId: input.runId,
      chainId: input.chainId,
      contractName: input.contractName,
      address: address.toLowerCase(),
      deployer: tx.from.toLowerCase(),
      txHash: input.txHash.toLowerCase(),
      blockNumber: Number(receipt.blockNumber),
      constructorArgs: `0x${creation.slice(artifact.bytecode.length)}`,
      compilerVersion: compiled.compilerVersion,
      evmVersion: compiled.evmVersion,
      sourceHash: compiled.sourceHash,
      abi: artifact.abi as unknown[],
      stdJsonInput: compiled.stdJsonInput,
    })
    .returning();

  await syncContractModules(db, input.projectId);
  await db.insert(messages).values({ projectId: input.projectId, role: "system", content: `${input.contractName} is live on ${chainLabel(input.chainId)} at ${address}` });
  await db.update(projects).set({ status: "deployed" }).where(eq(projects.id, input.projectId));
  return row;
}

/** Write deployed addresses into the project's platform-owned src/contracts modules. */
export async function syncContractModules(db: Db, projectId: string): Promise<void> {
  const files = await loadFiles(db, projectId);
  const next = await withCurrentAddresses(db, projectId, files);
  for (const [path, content] of Object.entries(next)) {
    if (!path.startsWith(PLATFORM_DIR) || content === files[path]) continue;
    await db.update(projectFiles).set({ content, updatedAt: new Date() }).where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path)));
  }
}

/** A deployment as the browser sees it (no source blobs). */
export function publicDeployment(d: Deployment) {
  return {
    id: d.id,
    runId: d.runId,
    chainId: d.chainId,
    contractName: d.contractName,
    address: getAddress(d.address),
    txHash: d.txHash,
    version: d.version,
    verifyStatus: d.verifyStatus,
    verifyProvider: d.verifyProvider,
    verifyDetail: d.verifyDetail,
    upgradeable: Boolean(d.proxy),
    createdAt: d.createdAt,
  };
}
