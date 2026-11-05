import "server-only";

import { keccak256, toHex, type Abi, type Hex } from "viem";

import { MANIFEST_PATH } from "@/lib/deploy/manifest";
import { SOLC_SETTINGS, isTestFile, runSolc } from "@/server/agent/checks";

export type EvmVersion = "cancun" | "paris";

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
 * not a contract that is "already deployed".
 */
export function sourceKey(files: Record<string, string>, evmVersion: EvmVersion): Hex {
  const sources = Object.fromEntries(Object.entries(files).filter(([p]) => deployable(p)));
  return keccak256(toHex(stableStringify({ sources, manifest: files[MANIFEST_PATH] ?? null, evmVersion, optimizer: SOLC_SETTINGS.optimizer })));
}

function deployable(path: string) {
  return path.startsWith("contracts/") && path.endsWith(".sol") && !isTestFile(path);
}

const NEEDS_CANCUN = /mcopy|tstore|tload|cancun|instruction .* not found/i;

/**
 * Compile the deployable contracts for a chain. `cancun` is the default (D17). `paris` is the
 * fallback after Celo rejects Cancun bytecode: first with the current OpenZeppelin, and if a
 * dependency itself needs Cancun instructions, with the pinned pre-MCOPY release.
 */
export async function compileForDeploy(
  files: Record<string, string>,
  evmVersion: EvmVersion = "cancun",
  run: Run = runSolc,
): Promise<DeployCompile | DeployCompileFailure> {
  const sources = Object.fromEntries(Object.entries(files).filter(([p]) => deployable(p)));
  if (!Object.keys(sources).length) return { ok: false, errors: ["There are no contracts to deploy."] };

  const key = sourceKey(files, evmVersion);
  const hit = cache.get(key);
  if (hit) return hit;

  let legacy = false;
  let result = await attempt(run, sources, evmVersion, false);
  if (evmVersion === "paris" && !result.ok && result.errors.some((e) => NEEDS_CANCUN.test(e))) {
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
  if (cache.size >= 16) cache.delete(cache.keys().next().value!);
  cache.set(key, compiled);
  return compiled;
}

async function attempt(run: Run, sources: Record<string, string>, evmVersion: EvmVersion, legacyOpenZeppelin: boolean) {
  let out;
  try {
    out = await run(sources, 60_000, { evmVersion, legacyOpenZeppelin });
  } catch (error) {
    return { ok: false as const, errors: [`The compiler failed to run: ${String(error)}`] };
  }
  const errors = (out.output.errors ?? []).filter((e) => e.severity === "error").map((e) => e.message);
  return errors.length ? { ok: false as const, errors } : { ok: true as const, value: out };
}
