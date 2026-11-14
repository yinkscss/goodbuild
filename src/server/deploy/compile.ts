import "server-only";

import { keccak256, toHex, type Abi, type Hex } from "viem";

import { MANIFEST_PATH } from "@/lib/deploy/manifest";
import { isDeployableSource } from "@/lib/deploy/test-file";
import { SOLC_SETTINGS, guardrailIssues, runSolc, solcSettings, upgradeableIssues, type CheckIssue } from "@/server/agent/checks";
import { analyseContracts, type ContractAnalysis } from "./upgrade-check";

export type EvmVersion = "cancun" | "paris";

/** OpenZeppelin's proxy, compiled from its own source. It is the only proxy in a project (D33). */
export const PROXY_FILE = "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
export const PROXY_NAME = "TransparentUpgradeableProxy";
export const PROXY_IDENTIFIER = `${PROXY_FILE}:${PROXY_NAME}`;
/** Outside contracts/ on purpose: the proxy's exception to the guardrails comes from where it lives. */
const PROXY_STUB = "goodbuild/ProxyImport.sol";
const PROXY_STUB_SOURCE = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\nimport {${PROXY_NAME}} from "${PROXY_FILE}";\n`;

export interface UpgradeableBuild {
  proxy: { abi: Abi; bytecode: Hex; deployedBytecode: Hex };
  /** Storage layout and safety problems per contract. */
  analyses: Record<string, ContractAnalysis>;
  /** Guardrail and upgradeable-rule problems in the generated files. */
  issues: CheckIssue[];
}

export interface DeployArtifact {
  name: string;
  /** e.g. contracts/RTXToken.sol */
  file: string;
  abi: Abi;
  /** Creation bytecode, 0x-prefixed. Never has unlinked library placeholders. */
  bytecode: Hex;
  /** Runtime bytecode, scanned in the browser for opcodes the chain may not support. */
  deployedBytecode: Hex;
}

export interface DeployCompile {
  ok: true;
  evmVersion: EvmVersion;
  compilerVersion: string;
  /** OpenZeppelin release the imports resolved from. */
  openZeppelin: string;
  artifacts: DeployArtifact[];
  /** Solidity standard JSON input, for source verification. */
  stdJsonInput: Record<string, unknown>;
  sourceHash: Hex;
  /** Set for an upgradeable project (D33). */
  upgradeable?: UpgradeableBuild;
}

export interface DeployCompileFailure {
  ok: false;
  errors: string[];
}

export const OPENZEPPELIN_CURRENT = "5.6.1";
/** D17 fallback: the newest 5.x release that does not use MCOPY (5.2.0 adds it). */
export const OPENZEPPELIN_PARIS = "5.1.0";

type Run = typeof runSolc;

/** "0.8.28+commit.7893614a.Emscripten.clang" → "0.8.28+commit.7893614a" (what verifiers expect). */
export function compilerVersionOf(raw: string): string {
  return /^(\d+\.\d+\.\d+\+commit\.[0-9a-f]+)/.exec(raw)?.[1] ?? raw;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const cache = new Map<string, DeployCompile>();

/**
 * Hash of the project's deployable sources, deploy manifest and compile target. Stable across runs.
 * The manifest counts because it holds the constructor arguments: changing one is a new deployment,
 * not a contract that is "already deployed". An upgradeable project hashes differently, since the
 * same code deploys differently; other projects keep the hashes they already have.
 */
export function sourceKey(files: Record<string, string>, evmVersion: EvmVersion, { upgradeable = false }: { upgradeable?: boolean } = {}): Hex {
  const sources = Object.fromEntries(Object.entries(files).filter(([p]) => deployable(p)));
  return keccak256(toHex(stableStringify({ sources, manifest: files[MANIFEST_PATH] ?? null, evmVersion, optimizer: SOLC_SETTINGS.optimizer, ...(upgradeable ? { upgradeable: true } : {}) })));
}

/** A project contract that deploys: never a test, wherever the test file lives (GB-04). */
const deployable = isDeployableSource;

const NEEDS_CANCUN = /mcopy|tstore|tload|cancun|instruction .* not found/i;

/**
 * Compile the deployable contracts for a chain. `cancun` is the default (D17). `paris` is the
 * fallback after Celo rejects Cancun bytecode: first with the current OpenZeppelin, and if a
 * dependency itself needs Cancun instructions, with the pinned pre-MCOPY release.
 *
 * An upgradeable project also compiles OpenZeppelin's proxy and runs the safety analysis. It never
 * takes the pinned-release route: OpenZeppelin's contracts differ between 5.1 and 5.6, and an
 * upgrade between them isn't something the storage check can vouch for.
 */
export async function compileForDeploy(
  files: Record<string, string>,
  evmVersion: EvmVersion = "cancun",
  run: Run = runSolc,
  { upgradeable = false }: { upgradeable?: boolean } = {},
): Promise<DeployCompile | DeployCompileFailure> {
  const projectSources = Object.fromEntries(Object.entries(files).filter(([p]) => deployable(p)));
  if (!Object.keys(projectSources).length) return { ok: false, errors: ["There are no contracts to deploy."] };
  const sources = upgradeable ? { ...projectSources, [PROXY_STUB]: PROXY_STUB_SOURCE } : projectSources;

  const key = sourceKey(files, evmVersion, { upgradeable });
  const hit = cache.get(key);
  if (hit) return hit;

  let legacy = false;
  let result = await attempt(run, sources, evmVersion, false, upgradeable);
  if (evmVersion === "paris" && !upgradeable && !result.ok && result.errors.some((e) => NEEDS_CANCUN.test(e))) {
    legacy = true;
    result = await attempt(run, sources, evmVersion, true);
  }
  if (!result.ok) return { ok: false, errors: result.errors };

  const { version, output, imports } = result.value;
  const artifacts: DeployArtifact[] = [];
  const problems: string[] = [];
  for (const [file, byName] of Object.entries(output.contracts ?? {})) {
    if (!deployable(file)) continue;
    for (const [name, c] of Object.entries(byName)) {
      const object = c.evm?.bytecode?.object ?? "";
      if (!object) continue; // interface or abstract
      if (object.includes("__$")) {
        problems.push(`${name} links an external library, which GoodBuild can't deploy yet. Use internal library functions.`);
        continue;
      }
      artifacts.push({ name, file, abi: c.abi as Abi, bytecode: `0x${object}`, deployedBytecode: `0x${c.evm?.deployedBytecode?.object ?? ""}` });
    }
  }
  if (problems.length) return { ok: false, errors: problems };
  // GB-02: the guardrails run again here, on every contract and chain, not only in the builder's loop.
  // Code edited after its last check, or never checked, can't reach a chain with delegatecall,
  // selfdestruct, assembly, tx.origin or a low-level call. Recording re-runs this compile, so it guards that too.
  // Upgradeable projects get the full set (style included) in their own branch below.
  if (!upgradeable) {
    const unsafe = Object.entries(output.sources ?? {})
      .filter(([file]) => deployable(file))
      .flatMap(([file, src]) => guardrailIssues(file, src.ast, files[file], { securityOnly: true }));
    if (unsafe.length) return { ok: false, errors: unsafe.map((i) => `${i.file}${i.line ? `:${i.line}` : ""}: ${i.message}`) };
  }
  if (!artifacts.length) return { ok: false, errors: ["No deployable contract was found (only interfaces or abstract contracts)."] };

  const stdJsonInput = {
    language: "Solidity",
    sources: Object.fromEntries(Object.entries({ ...sources, ...(imports ?? {}) }).map(([k, v]) => [k, { content: v }])),
    settings: { evmVersion, optimizer: SOLC_SETTINGS.optimizer, outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] } } },
  };
  const compiled: DeployCompile = {
    ok: true,
    evmVersion,
    compilerVersion: compilerVersionOf(version),
    openZeppelin: legacy ? OPENZEPPELIN_PARIS : OPENZEPPELIN_CURRENT,
    artifacts,
    stdJsonInput,
    sourceHash: key,
  };
  if (upgradeable) {
    const proxy = output.contracts?.[PROXY_FILE]?.[PROXY_NAME];
    if (!proxy?.evm?.bytecode?.object) return { ok: false, errors: ["OpenZeppelin's proxy didn't compile."] };
    const issues = Object.entries(output.sources ?? {})
      .filter(([file]) => deployable(file))
      .flatMap(([file, src]) => [...guardrailIssues(file, src.ast, files[file], { upgradeable: true }), ...upgradeableIssues(file, src.ast, files[file])]);
    const input = { language: "Solidity", sources: Object.fromEntries(Object.entries({ ...sources, ...(imports ?? {}) }).map(([k, v]) => [k, { content: v }])), settings: solcSettings({ evmVersion, upgradeable: true }) };
    let analyses: Record<string, ContractAnalysis>;
    try {
      analyses = await analyseContracts(input, output, artifacts.map((a) => ({ file: a.file, name: a.name })));
    } catch (error) {
      return { ok: false, errors: [`The upgrade safety check failed to run: ${String(error)}`] };
    }
    compiled.upgradeable = {
      proxy: { abi: proxy.abi as Abi, bytecode: `0x${proxy.evm.bytecode.object}`, deployedBytecode: `0x${proxy.evm.deployedBytecode?.object ?? ""}` },
      analyses,
      issues,
    };
  }
  if (cache.size >= 16) cache.delete(cache.keys().next().value!);
  cache.set(key, compiled);
  return compiled;
}

async function attempt(run: Run, sources: Record<string, string>, evmVersion: EvmVersion, legacyOpenZeppelin: boolean, upgradeable = false) {
  let out;
  try {
    out = await run(sources, 60_000, { evmVersion, legacyOpenZeppelin, upgradeable });
  } catch (error) {
    return { ok: false as const, errors: [`The compiler failed to run: ${String(error)}`] };
  }
  const errors = (out.output.errors ?? []).filter((e) => e.severity === "error").map((e) => e.message);
  return errors.length ? { ok: false as const, errors } : { ok: true as const, value: out };
}
