import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { decodeAbiParameters, decodeFunctionData, getAddress, keccak256, toFunctionSelector, zeroAddress, type AbiFunction, type Address, type Hex, type PublicClient } from "viem";

import { chainLabel } from "@/lib/deploy/explorer";
import { MANIFEST_PATH, parseManifest } from "@/lib/deploy/manifest";
import { ADMIN_SLOT, IMPLEMENTATION_SLOT, INITIALIZER, isUpgradeableChain, proxyAdminAbi, type ProxyInfo, type UpgradeAuthority } from "@/lib/deploy/upgradeable";
import type { CheckIssue } from "@/server/agent/checks";
import { loadFiles } from "@/server/agent/store";
import type { Db } from "@/server/db/client";
import { contractUpgrades, deployments, upgradeableProjects, type Deployment, type ProxyRecord } from "@/server/db/deploy-schema";
import { messages, projects } from "@/server/db/schema";
import { compileForDeploy, type DeployArtifact, type DeployCompile, type EvmVersion, type UpgradeableBuild } from "./compile";
import { DeployError } from "./deploy-error";
import { compareLayouts, safetyMessage, storageProblemWords } from "./upgrade-check";

/**
 * The server side of upgradeable contracts (D33). Everything here trusts the chain and GoodBuild's
 * own compile, never the browser. The storage check gates GoodBuild's own flow: the wallet owner can
 * always call their ProxyAdmin with another tool. When they do, the next prepare sees code it didn't
 * record and refuses to build on it.
 */

export async function isUpgradeableProject(db: Db, projectId: string): Promise<boolean> {
  const [row] = await db.select({ id: upgradeableProjects.projectId }).from(upgradeableProjects).where(eq(upgradeableProjects.projectId, projectId)).limit(1);
  return Boolean(row);
}

/** The rule itself. Mainnet is refused even when mainnet deploys are switched on. */
export function assertUpgradeableChain(chainId: number) {
  if (!isUpgradeableChain(chainId)) {
    throw new DeployError("upgradeable_testnet_only", "Upgradeable contracts are a testnet trial for now, so they aren't available on Celo mainnet.");
  }
}

/** Turn the project's upgradeable option on or off. Off is the default and is always allowed. */
export async function setUpgradeable(db: Db, project: { id: string; chainId: number }, enabled: boolean): Promise<void> {
  if (!enabled) {
    await db.delete(upgradeableProjects).where(eq(upgradeableProjects.projectId, project.id));
    return;
  }
  assertUpgradeableChain(project.chainId);
  await db.insert(upgradeableProjects).values({ projectId: project.id }).onConflictDoNothing();
}

type ChainReader = Pick<PublicClient, "getStorageAt" | "readContract">;

function addressFromSlot(word: Hex | undefined): Address {
  const hex = (word ?? "0x").replace(/^0x/, "").padStart(64, "0");
  return getAddress(`0x${hex.slice(24)}`);
}

/** The proxy's EIP-1967 slots, at `latest` unless a block is given. */
export async function readProxy(client: Pick<PublicClient, "getStorageAt">, proxy: Address, blockNumber?: bigint): Promise<{ implementation: Address; admin: Address }> {
  const at = blockNumber === undefined ? {} : { blockNumber };
  const [implementation, admin] = await Promise.all([client.getStorageAt({ address: proxy, slot: IMPLEMENTATION_SLOT, ...at }), client.getStorageAt({ address: proxy, slot: ADMIN_SLOT, ...at })]);
  return { implementation: addressFromSlot(implementation), admin: addressFromSlot(admin) };
}

/** How long to keep asking a node that hasn't caught up yet. Injectable so tests don't wait. */
export interface ChainWait {
  /** Total time spent waiting between attempts. Default 15s, so a record request stays well inside Cloudflare's 100s. */
  timeoutMs?: number;
  /** First wait; it doubles each time, up to 4s. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Celo's public RPC is load-balanced, so just after a block is mined some answers still come from a
 * node that hasn't seen it: the transaction is unknown, the block is "not found", or storage reads
 * return the old values (the Celo Sepolia live test, 6 Nov 2026). Ask again with backoff until the
 * answer is settled or the time is up, then return the last answer (undefined if every read failed).
 */
async function untilSettled<T>(read: () => Promise<T>, settled: (value: T) => boolean, wait: ChainWait = {}): Promise<T | undefined> {
  const timeout = wait.timeoutMs ?? 15_000;
  const sleep = wait.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let delay = wait.delayMs ?? 500;
  let waited = 0;
  for (;;) {
    let last: T | undefined;
    try {
      last = await read();
      if (settled(last)) return last;
    } catch {
      last = undefined;
    }
    if (waited >= timeout) return last;
    const nap = Math.min(delay, 4000);
    await sleep(nap);
    waited += nap;
    delay *= 2;
  }
}

/**
 * The proxy as of the block that mined its transaction. A slot that still reads as zero, or as code
 * listed in `stale` (the code before an upgrade), means the node is behind, so it asks again. Any
 * other address is the chain's real answer and is returned at once, so a wrong upgrade is refused
 * straight away. Throws a retryable chain_read_failed if the node never catches up in time.
 */
export async function readProxyAt(
  client: Pick<PublicClient, "getStorageAt">,
  proxy: Address,
  at: { blockNumber: bigint; expected: Address; stale?: Address[] },
  wait?: ChainWait,
): Promise<{ implementation: Address; admin: Address }> {
  const behind = new Set([zeroAddress, ...(at.stale ?? [])].map((a) => a.toLowerCase()));
  const live = await untilSettled(
    () => readProxy(client, proxy, at.blockNumber),
    (p) => p.implementation.toLowerCase() === at.expected.toLowerCase() || !behind.has(p.implementation.toLowerCase()),
    wait,
  );
  if (!live || behind.has(live.implementation.toLowerCase())) {
    throw new DeployError("chain_read_failed", "Your transactions went through, but the network hasn't caught up with them yet. Try again in a moment.");
  }
  return live;
}

export async function readAuthority(client: Pick<PublicClient, "readContract">, admin: Address, wallet?: string | null): Promise<UpgradeAuthority> {
  try {
    const owner = await client.readContract({ address: admin, abi: proxyAdminAbi, functionName: "owner" });
    if (owner === zeroAddress) return "locked";
    return wallet && owner.toLowerCase() === wallet.toLowerCase() ? "you" : "other";
  } catch {
    return "unknown";
  }
}

export interface PlannedUpgrade {
  kind: "unchanged" | "upgrade";
  info: ProxyInfo;
}

export interface UpgradeRefusal {
  contract: string;
  reason: "storage" | "locked" | "not_owner" | "changed_elsewhere";
  message: string;
  details: string[];
}

export function codeHashOf(artifact: Pick<DeployArtifact, "deployedBytecode">): Hex {
  return keccak256(artifact.deployedBytecode);
}

/** Decide what a change means for one live proxy: nothing to do, a safe upgrade, or a refusal. */
export async function planProxyUpgrade(
  client: ChainReader,
  row: Deployment,
  artifact: DeployArtifact,
  build: UpgradeableBuild,
  wallet: string | undefined,
): Promise<PlannedUpgrade | UpgradeRefusal> {
  const proxy = row.proxy!;
  const address = getAddress(row.address);
  const name = row.contractName;
  let live: { implementation: Address; admin: Address };
  try {
    live = await readProxy(client, address);
  } catch {
    throw new DeployError("chain_read_failed", `We couldn't read ${name} from the network, so we can't check this upgrade. Try again in a moment.`);
  }
  const authority = await readAuthority(client, live.admin, wallet);
  const info: ProxyInfo = { address, admin: live.admin, implementation: live.implementation, authority };

  if (live.implementation.toLowerCase() !== proxy.implementation.toLowerCase()) {
    return {
      contract: name,
      reason: "changed_elsewhere",
      message: `${name} was changed outside GoodBuild, so we don't know what data it stores now and can't check an upgrade.`,
      details: [`On the network: ${live.implementation}. Recorded by GoodBuild: ${proxy.implementation}.`],
    };
  }
  if (proxy.codeHash === codeHashOf(artifact)) return { kind: "unchanged", info };
  if (authority === "locked") return { contract: name, reason: "locked", message: `${name} was locked, so it can't be changed any more.`, details: [] };
  if (authority === "unknown") throw new DeployError("chain_read_failed", `We couldn't check who can change ${name}. Try again in a moment.`);
  if (authority !== "you") return { contract: name, reason: "not_owner", message: `Another wallet now holds the right to change ${name}, so yours can't upgrade it.`, details: [] };

  const comparison = await compareLayouts(proxy.layout, build.analyses[name].layout);
  if (!comparison.ok) {
    return {
      contract: name,
      reason: "storage",
      message: `This change would scramble the data ${name} has stored, because ${storageProblemWords(comparison.problems).join(", and ")}.`,
      details: comparison.explanation.split("\n").filter(Boolean),
    };
  }
  return { kind: "upgrade", info };
}

/** The refusal the deploy modal shows, with the normal new deploy as the way forward. */
export function refusalError(refusals: UpgradeRefusal[]): DeployError {
  const words = refusals.map((r) => r.message).join(" ");
  return new DeployError(
    "upgrade_refused",
    `${words} Nothing was changed. You can ask the builder to keep the stored data as it is, or deploy this as a new contract at a new address. The old contract keeps its funds and data, and nothing moves across.`,
    refusals.flatMap((r) => r.details),
  );
}

/** The safety problems in a compile, for the contracts this deploy needs. */
export function buildProblems(build: UpgradeableBuild, names: string[]): string[] {
  return [
    ...build.issues.map((i) => `${i.file}${i.line ? `:${i.line}` : ""}: ${i.message}`),
    ...names.flatMap((n) => (build.analyses[n]?.errors ?? []).map((e) => safetyMessage(n, e))),
  ];
}

/**
 * Checks for the agent's fix loop: the contract is safe behind a proxy, and a change to a live
 * contract keeps its stored data readable, so most problems are fixed before anyone tries to deploy.
 */
export function upgradeChecksFor(db: Db, projectId: string): (files: Record<string, string>) => Promise<CheckIssue[]> {
  return async (files) => {
    const [project] = await db.select({ id: projects.id, chainId: projects.chainId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) return [];
    const compiled = await compileForDeploy(files, "cancun", undefined, { upgradeable: true });
    if (!compiled.ok || !compiled.upgradeable) return compiled.ok ? [] : compiled.errors.map((message) => ({ file: "contracts/", message, source: "solc" as const }));
    const build = compiled.upgradeable;
    const issues: CheckIssue[] = [];
    for (const artifact of compiled.artifacts) {
      for (const e of build.analyses[artifact.name]?.errors ?? []) issues.push({ file: artifact.file, message: safetyMessage(artifact.name, e), source: "guardrail" });
    }
    const rows = await latestProxyRows(db, project);
    for (const artifact of compiled.artifacts) {
      const row = rows.get(artifact.name);
      if (!row?.proxy || row.proxy.codeHash === codeHashOf(artifact) || !build.analyses[artifact.name]) continue;
      const comparison = await compareLayouts(row.proxy.layout, build.analyses[artifact.name].layout);
      if (!comparison.ok) {
        issues.push({
          file: artifact.file,
          message: `${artifact.name} is live and upgrading it would scramble its stored data: ${storageProblemWords(comparison.problems).join("; ")}. Keep every existing state variable with the same name, type and order, even if it's now unused, and add new ones after them. ${comparison.explanation}`,
          source: "guardrail",
        });
      }
    }
    return issues;
  };
}

/** The plain state variables of each live proxy, to tell the agent what it must keep. */
export async function liveStorage(db: Db, project: { id: string; chainId: number }): Promise<Array<{ name: string; variables: string[] }>> {
  const rows = await latestProxyRows(db, project);
  return [...rows.values()].map((row) => {
    const storage = (row.proxy?.layout as { storage?: Array<{ label?: string; type?: string }> } | null)?.storage ?? [];
    return { name: row.contractName, variables: storage.map((s) => `${s.label} (${String(s.type ?? "").replace(/^t_/, "")})`) };
  });
}

/** Newest row per contract on the project's chain, if that row is a proxy. */
export async function latestProxyRows(db: Db, project: { id: string; chainId: number }): Promise<Map<string, Deployment>> {
  const rows = await db
    .select()
    .from(deployments)
    .where(and(eq(deployments.projectId, project.id), eq(deployments.chainId, project.chainId)))
    .orderBy(desc(deployments.createdAt));
  const seen = new Set<string>();
  const out = new Map<string, Deployment>();
  for (const row of rows) {
    if (seen.has(row.contractName)) continue;
    seen.add(row.contractName);
    if (row.proxy) out.set(row.contractName, row);
  }
  return out;
}

/**
 * True when any contract this project's code uses is behind a proxy that can still be changed, for
 * the published app's label. A failed read counts as changeable: the label must not vanish wrongly.
 */
export async function hasChangeableContracts(db: Db, project: { id: string; chainId: number }, files: Record<string, string>, client: Pick<PublicClient, "readContract">): Promise<boolean> {
  const rows = await latestProxyRows(db, project);
  if (!rows.size) return false;
  const manifest = files[MANIFEST_PATH] ? parseManifest(files[MANIFEST_PATH]) : null;
  const names = manifest?.ok ? manifest.manifest.contracts.map((c) => c.name) : [...rows.keys()];
  for (const name of names) {
    const row = rows.get(name);
    if (row?.proxy && (await readAuthority(client, getAddress(row.proxy.admin))) !== "locked") return true;
  }
  return false;
}

export interface RecordProxiedInput {
  projectId: string;
  userId: string;
  wallet: string;
  runId: string;
  chainId: number;
  contractName: string;
  txHash: Hex;
  implementationTxHash: Hex;
  sourceHash: Hex;
  evmVersion: EvmVersion;
}

type RecordClient = Pick<PublicClient, "waitForTransactionReceipt" | "getTransaction" | "getStorageAt" | "readContract">;

/**
 * A mined transaction and its receipt. The receipt comes first: asking for both at once let a lagging
 * node answer "unknown transaction" for one that had just been mined.
 */
export async function minedTx(client: Pick<PublicClient, "waitForTransactionReceipt" | "getTransaction">, hash: Hex, wait?: ChainWait, failed = "That transaction failed on-chain.") {
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 45_000 }).catch(() => null);
  const tx = receipt ? await untilSettled(() => client.getTransaction({ hash }), Boolean, wait) : undefined;
  if (!receipt || !tx) throw new DeployError("tx_not_found", "The network doesn't know that transaction yet. Try again in a moment.");
  if (receipt.status !== "success") throw new DeployError("tx_failed", failed);
  return { receipt, tx };
}

/** The new code's transaction: from this wallet, and exactly the bytecode GoodBuild compiled. */
async function provenImplementation(client: RecordClient, input: RecordProxiedInput, artifact: DeployArtifact, wait?: ChainWait): Promise<Address> {
  const { receipt, tx } = await minedTx(client, input.implementationTxHash, wait);
  if (tx.to !== null || !receipt.contractAddress) throw new DeployError("not_contract_creation", "That transaction didn't create a contract.");
  if (tx.from.toLowerCase() !== input.wallet.toLowerCase()) throw new DeployError("wrong_sender", "That transaction wasn't sent by your signed-in wallet.");
  if (tx.input.toLowerCase() !== artifact.bytecode.toLowerCase()) throw new DeployError("bytecode_mismatch", `That transaction didn't deploy GoodBuild's compiled ${input.contractName}.`);
  return getAddress(receipt.contractAddress);
}

async function compiledFor(db: Db, input: RecordProxiedInput, compile: typeof compileForDeploy): Promise<{ compiled: DeployCompile; build: UpgradeableBuild; artifact: DeployArtifact }> {
  const files = await loadFiles(db, input.projectId);
  const compiled = await compile(files, input.evmVersion, undefined, { upgradeable: true });
  if (!compiled.ok || compiled.sourceHash !== input.sourceHash || !compiled.upgradeable) {
    throw new DeployError("source_changed", "The project's code changed since this deploy started. Start the deploy again.");
  }
  const artifact = compiled.artifacts.find((a) => a.name === input.contractName);
  if (!artifact) throw new DeployError("wrong_contract", `${input.contractName} isn't a contract in this project.`);
  return { compiled, build: compiled.upgradeable, artifact };
}

/** A first deploy behind a proxy: the proxy is OpenZeppelin's, the code is ours, the wallet holds the authority. */
export async function recordProxyCreation(db: Db, input: RecordProxiedInput, deps: { client: RecordClient; compile?: typeof compileForDeploy; wait?: ChainWait }): Promise<Deployment> {
  const { client, wait } = deps;
  const { receipt, tx } = await minedTx(client, input.txHash, wait);
  if (tx.to !== null || !receipt.contractAddress) throw new DeployError("not_contract_creation", "That transaction didn't create a contract.");
  if (tx.from.toLowerCase() !== input.wallet.toLowerCase()) throw new DeployError("wrong_sender", "That transaction wasn't sent by your signed-in wallet.");

  const { compiled, build, artifact } = await compiledFor(db, input, deps.compile ?? compileForDeploy);
  const creation = tx.input.toLowerCase();
  const proxyBytecode = build.proxy.bytecode.toLowerCase();
  if (!creation.startsWith(proxyBytecode)) throw new DeployError("bytecode_mismatch", "That transaction didn't deploy OpenZeppelin's proxy.");

  const constructorArgs = `0x${creation.slice(proxyBytecode.length)}` as Hex;
  const [logic, initialOwner, initData] = decodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "bytes" }], constructorArgs);
  if (initialOwner.toLowerCase() !== input.wallet.toLowerCase()) {
    throw new DeployError("wrong_upgrade", "That proxy gives the right to change it to another wallet, so GoodBuild won't use it.");
  }
  const implementation = await provenImplementation(client, input, artifact, wait);
  if (logic.toLowerCase() !== implementation.toLowerCase()) throw new DeployError("wrong_upgrade", "That proxy doesn't point at the code you just deployed.");
  const init = artifact.abi.find((i): i is AbiFunction => i.type === "function" && i.name === INITIALIZER);
  if (!init || !initData.toLowerCase().startsWith(toFunctionSelector(init).toLowerCase())) {
    throw new DeployError("wrong_upgrade", "That proxy wasn't set up by calling this contract's initialize.");
  }

  const address = getAddress(receipt.contractAddress);
  const live = await readProxyAt(client, address, { blockNumber: receipt.blockNumber, expected: implementation }, wait);
  if (live.implementation.toLowerCase() !== implementation.toLowerCase()) throw new DeployError("wrong_upgrade", "The network says that proxy uses different code.");
  const proxy: ProxyRecord = {
    implementation: implementation.toLowerCase(),
    implementationTx: input.implementationTxHash.toLowerCase(),
    admin: live.admin.toLowerCase(),
    codeHash: codeHashOf(artifact),
    layout: build.analyses[input.contractName].layout,
  };
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
      constructorArgs,
      compilerVersion: compiled.compilerVersion,
      evmVersion: compiled.evmVersion,
      sourceHash: compiled.sourceHash,
      abi: artifact.abi as unknown[],
      stdJsonInput: compiled.stdJsonInput,
      proxy,
    })
    .returning();
  await db.insert(messages).values({ projectId: input.projectId, role: "system", content: `${input.contractName} is live on ${chainLabel(input.chainId)} at ${address}. It can be changed later, by your wallet only.` });
  return row;
}

/** An upgrade: the same proxy now uses code GoodBuild compiled and checked. Updates the row in place. */
export async function recordUpgrade(db: Db, input: RecordProxiedInput, deps: { client: RecordClient; compile?: typeof compileForDeploy; wait?: ChainWait }): Promise<Deployment> {
  const { client, wait } = deps;
  const rows = await latestProxyRows(db, { id: input.projectId, chainId: input.chainId });
  const row = rows.get(input.contractName);
  if (!row?.proxy) throw new DeployError("wrong_contract", `${input.contractName} has no live proxy to upgrade.`);

  const { receipt, tx } = await minedTx(client, input.txHash, wait);
  if (tx.from.toLowerCase() !== input.wallet.toLowerCase()) throw new DeployError("wrong_sender", "That transaction wasn't sent by your signed-in wallet.");
  // The ProxyAdmin never changes, so the recorded one is checked here, before reading the chain.
  if (!tx.to || tx.to.toLowerCase() !== row.proxy.admin.toLowerCase()) throw new DeployError("wrong_upgrade", `That transaction wasn't sent to ${input.contractName}'s ProxyAdmin.`);
  let call;
  try {
    call = decodeFunctionData({ abi: proxyAdminAbi, data: tx.input });
  } catch {
    throw new DeployError("wrong_upgrade", "That transaction isn't an upgrade.");
  }
  if (call.functionName !== "upgradeAndCall") throw new DeployError("wrong_upgrade", "That transaction isn't an upgrade.");
  const [proxyArg, implementationArg, data] = call.args;
  if (proxyArg.toLowerCase() !== row.address.toLowerCase()) throw new DeployError("wrong_upgrade", `That upgrade is for a different proxy than ${input.contractName}.`);
  if (data !== "0x") throw new DeployError("wrong_upgrade", "GoodBuild's upgrades don't call a function during the switch.");

  const { compiled, build, artifact } = await compiledFor(db, input, deps.compile ?? compileForDeploy);
  const implementation = await provenImplementation(client, input, artifact, wait);
  if (implementationArg.toLowerCase() !== implementation.toLowerCase()) throw new DeployError("wrong_upgrade", "That upgrade doesn't point at the code you just deployed.");
  // As of the switch's own block. Reading the code from before the switch means the node is behind.
  const live = await readProxyAt(client, getAddress(row.address), { blockNumber: receipt.blockNumber, expected: implementation, stale: [getAddress(row.proxy.implementation)] }, wait);
  if (live.implementation.toLowerCase() !== implementation.toLowerCase()) throw new DeployError("wrong_upgrade", "The network says that proxy uses different code.");
  if (live.admin.toLowerCase() !== row.proxy.admin.toLowerCase()) throw new DeployError("wrong_upgrade", `${input.contractName}'s ProxyAdmin isn't the one GoodBuild recorded.`);

  // Prepare checked this too. Checking again means a hand-made request can't record a refused upgrade.
  const comparison = await compareLayouts(row.proxy.layout, build.analyses[input.contractName].layout);
  if (!comparison.ok) {
    throw refusalError([{ contract: input.contractName, reason: "storage", message: `This change would scramble the data ${input.contractName} has stored, because ${storageProblemWords(comparison.problems).join(", and ")}.`, details: comparison.explanation.split("\n").filter(Boolean) }]);
  }

  const [project] = await db.select({ version: projects.currentVersion }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
  const proxy: ProxyRecord = { ...row.proxy, implementation: implementation.toLowerCase(), implementationTx: input.implementationTxHash.toLowerCase(), codeHash: codeHashOf(artifact), layout: build.analyses[input.contractName].layout };
  await db.insert(contractUpgrades).values({
    deploymentId: row.id,
    chainId: input.chainId,
    txHash: input.txHash.toLowerCase(),
    fromImplementation: row.proxy.implementation,
    toImplementation: proxy.implementation,
    implementationTx: proxy.implementationTx,
    version: project?.version ?? 0,
    sourceHash: compiled.sourceHash,
  });
  const [updated] = await db
    .update(deployments)
    .set({
      version: project?.version ?? 0,
      runId: input.runId,
      compilerVersion: compiled.compilerVersion,
      evmVersion: compiled.evmVersion,
      sourceHash: compiled.sourceHash,
      abi: artifact.abi as unknown[],
      stdJsonInput: compiled.stdJsonInput,
      proxy,
      verifyStatus: "pending",
      verifyDetail: null,
      verifiedAt: null,
    })
    .where(eq(deployments.id, row.id))
    .returning();
  await db.insert(messages).values({ projectId: input.projectId, role: "system", content: `${input.contractName} was upgraded on ${chainLabel(input.chainId)}. Same address: ${getAddress(row.address)}. Its funds and data stay where they are.` });
  return updated;
}

/** A retried upgrade request returns the row it already updated. */
export async function existingUpgrade(db: Db, input: Pick<RecordProxiedInput, "chainId" | "txHash" | "projectId" | "userId">): Promise<Deployment | null> {
  const [hit] = await db
    .select({ deployment: deployments })
    .from(contractUpgrades)
    .innerJoin(deployments, eq(contractUpgrades.deploymentId, deployments.id))
    .where(and(eq(contractUpgrades.chainId, input.chainId), eq(contractUpgrades.txHash, input.txHash.toLowerCase())))
    .limit(1);
  if (!hit) return null;
  if (hit.deployment.userId !== input.userId || hit.deployment.projectId !== input.projectId) throw new DeployError("wrong_sender", "That transaction belongs to another project.");
  return hit.deployment;
}

/**
 * Contracts whose code didn't change in this compile are as current as the rest, so they take the new
 * source hash. No transaction is needed: the same code is already on-chain.
 */
export async function adoptUnchanged(db: Db, compiled: DeployCompile, project: { id: string; chainId: number }, names: string[]): Promise<void> {
  const rows = await latestProxyRows(db, project);
  for (const name of names) {
    const row = rows.get(name);
    if (row && row.sourceHash !== compiled.sourceHash) await db.update(deployments).set({ sourceHash: compiled.sourceHash, stdJsonInput: compiled.stdJsonInput }).where(eq(deployments.id, row.id));
  }
}
