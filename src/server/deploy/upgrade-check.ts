import "server-only";

import { execFile } from "node:child_process";
import path from "node:path";

/** Storage layout as @openzeppelin/upgrades-core produces it. Opaque here: the child process reads it. */
export type StorageLayout = unknown;

export interface SafetyError {
  kind: string;
  name?: string;
  src: string;
}

export interface ContractAnalysis {
  layout: StorageLayout;
  errors: SafetyError[];
}

export interface StorageComparison {
  ok: boolean;
  problems: Array<{ kind: string; label: string }>;
  /** upgrades-core's own wording, for the logs and the AI's fix turn. */
  explanation: string;
}

function call<T>(request: unknown): Promise<T> {
  const script = path.join(process.cwd(), "scripts", "upgrade-check.cjs");
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [script], { timeout: 60_000, maxBuffer: 128 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const parsed = JSON.parse(stdout) as { fatal?: string } & T;
        if (parsed.fatal) reject(new Error(parsed.fatal));
        else resolve(parsed);
      } catch (e) {
        reject(e);
      }
    });
    child.stdin?.end(JSON.stringify(request));
  });
}

/** Read each contract's storage layout and find what makes it unsafe behind a proxy. */
export async function analyseContracts(input: unknown, output: unknown, names: Array<{ file: string; name: string }>): Promise<Record<string, ContractAnalysis>> {
  return (await call<{ results: Record<string, ContractAnalysis> }>({ op: "analyse", input, output, names })).results;
}

/** Would `updated` read the data `original` stored correctly? */
export function compareLayouts(original: StorageLayout, updated: StorageLayout): Promise<StorageComparison> {
  return call<StorageComparison>({ op: "compare", original, updated });
}

const SAFETY_WORDS: Record<string, (e: SafetyError) => string> = {
  constructor: () => "It has a constructor that isn't the sealed one. Constructors don't run on the proxy, so move the work into initialize.",
  "state-variable-assignment": (e) => `${e.name} has an initial value. Those never reach the proxy, so set it in initialize.`,
  "state-variable-immutable": (e) => `${e.name} is immutable. Immutables can't be set from initialize, so use a normal variable.`,
  "external-library-linking": () => "It links an external library, which GoodBuild can't deploy.",
  delegatecall: () => "It uses delegatecall, which isn't allowed.",
  selfdestruct: () => "It uses selfdestruct, which isn't allowed.",
  "missing-initializer": () => "It has parent contracts that need setting up, but no initialize function.",
  "missing-initializer-call": () => "initialize doesn't call every parent's __Name_init function.",
  "duplicate-initializer-call": () => "initialize calls a parent's __Name_init function twice.",
  "incorrect-initializer-order": () => "initialize calls the parents' __Name_init functions in the wrong order.",
};

/** One plain sentence per safety problem, used for the AI's fix turn and for the deploy modal's logs. */
export function safetyMessage(contract: string, e: SafetyError): string {
  return `${contract}: ${(SAFETY_WORDS[e.kind] ?? (() => `Not safe behind a proxy (${e.kind}).`))(e)}`;
}

const OP_WORDS: Record<string, (label: string) => string> = {
  delete: (l) => `the stored value "${l}" was removed or moved`,
  insert: (l) => `the new value "${l}" was added before existing ones`,
  rename: (l) => `the stored value "${l}" was renamed`,
  typechange: (l) => `the stored value "${l}" changed type`,
  layoutchange: (l) => `the stored value "${l}" moved to another place`,
  replace: (l) => `the stored value "${l}" was replaced`,
};

/** What changed, in plain words. */
export function storageProblemWords(problems: StorageComparison["problems"]): string[] {
  return problems.map((p) => (OP_WORDS[p.kind] ?? ((l: string) => `the stored value "${l}" changed in a way that isn't safe`))(p.label));
}
