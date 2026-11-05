import "server-only";

import { execFile } from "node:child_process";
import path from "node:path";
import ts from "typescript";

import * as Lucide from "lucide-react";

import { COLLECTION_NAME, DATA_PATH_PREFIX, DATA_RULES_PATH, parseDataRules } from "@/lib/app-data";
import { MANIFEST_PATH, parseManifest, planManifest } from "@/lib/deploy/manifest";

import { assetRefs } from "./assets";
import { ALLOWED_DEPENDENCIES, PLATFORM_DIR, dependenciesOf } from "./template";

/** Compiler settings, pinned (CONTRACTS_AND_DEPLOYMENT.md §2, §4). */
export const SOLC_SETTINGS = {
  // OpenZeppelin 5.6 uses MCOPY, so Cancun is required. Celo L2 Cancun support is
  // UNVERIFIED in Celo's docs (Q35); M5's pre-deploy simulation will surface it.
  evmVersion: "cancun",
  optimizer: { enabled: true, runs: 200 },
  outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"], "": ["ast"] } },
} as const;

export interface CheckIssue {
  file: string;
  line?: number;
  message: string;
  source: "solc" | "guardrail" | "syntax" | "imports" | "paths" | "test" | "manifest";
}

export interface CompiledContract {
  name: string;
  file: string;
  abi: unknown[];
  bytecodeBytes: number;
}

/** A compiled test contract (contracts/test/*.t.sol), run in a local EVM, never deployed. */
export interface CompiledTest {
  name: string;
  file: string;
  abi: unknown[];
  /** Creation bytecode, hex without 0x. */
  bytecode: string;
}

export interface CheckReport {
  ok: boolean;
  errors: CheckIssue[];
  warnings: CheckIssue[];
  contracts: CompiledContract[];
  /** Test contracts to run after a clean compile. */
  tests?: CompiledTest[];
  /** Every ABI from the compile (project, tests, OpenZeppelin), for decoding reverts. */
  abis?: unknown[][];
  compilerVersion?: string;
}

export const MAX_FILE_BYTES = 120_000;
/** EIP-170 runtime code size limit. */
export const MAX_CONTRACT_BYTES = 24_576;
export const MAX_FILES = 80;

/** Where generated files may live. Everything else is refused. */
export function pathProblem(p: string): string | null {
  if (!p || p.startsWith("/") || p.includes("\\") || p.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) {
    return `Invalid path "${p}". Use a relative path like src/App.tsx or contracts/TipJar.sol.`;
  }
  if (p === "package.json") return "package.json is managed by GoodBuild. Use add_dependency.";
  if (p.startsWith(PLATFORM_DIR)) return `${PLATFORM_DIR} is written by GoodBuild from the compiled contracts. Import from it instead.`;
  if (p === "src/lib/db.ts" || p === "src/lib/useDb.ts") return `${p} is written by GoodBuild, so an app can't quietly send visitors' data elsewhere. Use it as it is (see the app-data guide). Who can read what goes in ${DATA_RULES_PATH}.`;
  if (p.startsWith("src/assets/")) return "src/assets/ is written by GoodBuild from the user's uploads. Import { assets } from it, or use the /assets/<name> path.";
  if (/^contracts\/[A-Za-z0-9_]+\.sol$/.test(p) || p === MANIFEST_PATH) return null;
  if (/^contracts\/test\/[A-Za-z0-9_]+\.t\.sol$/.test(p)) return null;
  if (/^src\/[A-Za-z0-9_\-/.]+\.(tsx?|css|json)$/.test(p)) return null;
  if (p === "public/index.html") return null;
  return `Files must be under src/ (.ts, .tsx, .css, .json), contracts/ (Name.sol) or contracts/test/ (Name.t.sol). Got "${p}".`;
}

/**
 * File naming conventions (the file-structure guide), checked for NEW files and renames only,
 * so projects made before the rule keep working. Returns a message with the expected name.
 */
export function namingProblem(p: string): string | null {
  const parts = p.split("/");
  const file = parts.at(-1) ?? "";
  const stem = file.replace(/\.(t\.sol|sol|tsx?|css|json|html)$/, "");
  const pascal = (s: string) => s.replace(/(^|[-_\s.]+)([a-zA-Z0-9])/g, (_m, _sep, c: string) => c.toUpperCase());
  const camel = (s: string) => pascal(s).replace(/^[A-Z]/, (c) => c.toLowerCase());
  const moved: Record<string, string> = { screens: "src/pages", views: "src/pages", routes: "src/pages", hooks: "src/lib", utils: "src/lib", helpers: "src/lib", images: "/assets (uploads)" };
  if (parts[0] === "src" && parts.length > 2 && moved[parts[1]]) {
    return `Put ${parts[1]} files in ${moved[parts[1]]}/ instead of src/${parts[1]}/ (see the file-structure guide).`;
  }
  if (p.startsWith("contracts/") && p !== MANIFEST_PATH && !/^[A-Z][A-Za-z0-9]*$/.test(stem)) {
    return `Contract files are PascalCase and named after the contract: ${parts.slice(0, -1).join("/")}/${pascal(stem)}${p.endsWith(".t.sol") ? ".t.sol" : ".sol"}.`;
  }
  if (/^src\/pages\/.+\.tsx$/.test(p) && !/^[A-Z][A-Za-z0-9]*$/.test(stem)) {
    return `Pages are PascalCase: ${parts.slice(0, -1).join("/")}/${pascal(stem)}.tsx.`;
  }
  if (/^src\/components\/.+\.tsx$/.test(p) && !p.startsWith("src/components/ui/") && !/^[A-Z][A-Za-z0-9]*$/.test(stem)) {
    return `Components are PascalCase: ${parts.slice(0, -1).join("/")}/${pascal(stem)}.tsx.`;
  }
  if (/^src\/lib\/.+\.tsx?$/.test(p)) {
    if (/^use/i.test(stem) && !/^use[A-Z][A-Za-z0-9]*$/.test(stem)) return `Hooks are named useCamelCase: src/lib/use${pascal(stem.replace(/^use[-_]?/i, ""))}.ts.`;
    if (!/^[a-z][A-Za-z0-9]*$/.test(stem)) return `Helpers in src/lib are camelCase: src/lib/${camel(stem)}.ts.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Solidity

type Json = Record<string, unknown>;

interface SolcOutput {
  errors?: Array<{ severity: string; message: string; formattedMessage?: string; sourceLocation?: { file: string; start: number } }>;
  contracts?: Record<string, Record<string, { abi: unknown[]; evm: { bytecode: { object: string }; deployedBytecode?: { object: string } } }>>;
  sources?: Record<string, { ast: Json; id: number }>;
}

/** Run solc in a child process (scripts/solc-compile.cjs). */
export interface SolcOptions {
  /** Overrides SOLC_SETTINGS.evmVersion (D17 paris fallback). */
  evmVersion?: "cancun" | "paris";
  /** Resolve @openzeppelin/contracts from the pinned pre-MCOPY release (paris fallback). */
  legacyOpenZeppelin?: boolean;
  /** An upgradeable project (D33): allow OpenZeppelin's upgradeable imports and output what the safety check reads. */
  upgradeable?: boolean;
}

/** Everything @openzeppelin/upgrades-core reads from a compile. None of it changes the bytecode. */
const UPGRADEABLE_OUTPUT = { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "evm.methodIdentifiers", "storageLayout"], "": ["ast"] } };

/** The solc settings a compile really used, so the safety check can repeat it. */
export function solcSettings(options: SolcOptions = {}) {
  return {
    ...SOLC_SETTINGS,
    ...(options.evmVersion ? { evmVersion: options.evmVersion } : {}),
    ...(options.upgradeable ? { outputSelection: UPGRADEABLE_OUTPUT } : {}),
  };
}

export function runSolc(
  sources: Record<string, string>,
  timeoutMs = 60_000,
  options: SolcOptions = {},
): Promise<{ version: string; output: SolcOutput; imports?: Record<string, string> }> {
  const script = path.join(process.cwd(), "scripts", "solc-compile.cjs");
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [script], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin?.end(JSON.stringify({ sources, settings: solcSettings(options), ozPackage: options.legacyOpenZeppelin ? "@openzeppelin/contracts-paris" : undefined, upgradeable: options.upgradeable }));
  });
}

function lineAt(content: string | undefined, offset: number): number | undefined {
  if (content === undefined || offset < 0) return undefined;
  return content.slice(0, offset).split("\n").length;
}

/**
 * Guardrails from CONTRACTS_AND_DEPLOYMENT.md §4, enforced on the compiler AST:
 * no delegatecall/callcode, selfdestruct, inline assembly, tx.origin, or low-level
 * call with arbitrary data (plain value transfers `call{value: x}("")` are allowed).
 * Plus house style: custom errors only (no require strings, no revert("text")).
 */
export function guardrailIssues(file: string, ast: Json, content?: string, { upgradeable = false }: { upgradeable?: boolean } = {}): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const at = (node: Json) => {
    const start = Number(String(node.src ?? "").split(":")[0]);
    return lineAt(content, start);
  };
  const flag = (node: Json, message: string) => issues.push({ file, line: at(node), message, source: "guardrail" });

  let inErc20 = false; // inside a contract that inherits ERC20 (its own token)
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as Json;
    if (n.nodeType === "ContractDefinition") {
      const bases = ((n.baseContracts as Json[]) ?? []).map((b) => String((b.baseName as Json | undefined)?.name ?? ""));
      const was = inErc20;
      inErc20 = bases.some((b) => /^ERC20/.test(b));
      for (const value of Object.values(n)) if (value && typeof value === "object") walk(value);
      inErc20 = was;
      return;
    }
    switch (n.nodeType) {
      case "ImportDirective": {
        const problem = importProblem(String(n.absolutePath ?? n.file ?? ""), upgradeable);
        if (problem) flag(n, problem);
        break;
      }
      case "InlineAssembly":
        flag(n, "Inline assembly isn't allowed in generated contracts.");
        break;
      case "Identifier":
        if (n.name === "selfdestruct" || n.name === "suicide") flag(n, "selfdestruct isn't allowed.");
        break;
      case "MemberAccess": {
        const expr = n.expression as Json | undefined;
        if (n.memberName === "delegatecall" || n.memberName === "callcode") flag(n, `${n.memberName} isn't allowed.`);
        // The same instruction through OpenZeppelin's helper, in any of its forms.
        if (n.memberName === "functionDelegateCall") flag(n, "delegatecall isn't allowed, and that includes Address.functionDelegateCall.");
        if (n.memberName === "origin" && expr?.nodeType === "Identifier" && expr.name === "tx") {
          flag(n, "tx.origin isn't allowed for authorization. Use msg.sender.");
        }
        break;
      }
      case "FunctionCall": {
        let callee = n.expression as Json | undefined;
        const args = (n.arguments as Json[]) ?? [];
        // Custom errors only: no require(...) without an error, no revert("text").
        if (callee?.nodeType === "Identifier" && callee.name === "require") {
          const reason = args[1];
          const customError = reason?.nodeType === "FunctionCall";
          if (!customError) flag(n, "Use a custom error instead of require: declare `error Name();` and write `if (!condition) revert Name();`.");
        }
        // A token contract calling its own public transferFrom/transfer: msg.sender is still
        // the user, so it spends allowance[user][user] (or moves from the user) and usually
        // reverts. It must use the internal _transfer.
        if (inErc20 && callee?.nodeType === "Identifier" && (callee.name === "transferFrom" || callee.name === "transfer")) {
          flag(n, `Don't call this token's own public ${String(callee.name)}() from inside the contract: msg.sender is still the user, so it spends their allowance to themselves and reverts. Use _transfer(from, to, amount).`);
        }
        if (callee?.nodeType === "Identifier" && callee.name === "revert") {
          flag(n, 'Use a custom error instead of revert("..."): `revert Name();`.');
        }
        if (callee?.nodeType === "FunctionCallOptions") callee = callee.expression as Json;
        if (callee?.nodeType === "MemberAccess" && callee.memberName === "call") {
          const first = args[0];
          const emptyData =
            args.length === 1 && first?.nodeType === "Literal" && (first.value === "" || first.hexValue === "");
          if (!emptyData) flag(n, 'Low-level .call with data isn\'t allowed. Use typed interface calls, or call{value: x}("") for transfers.');
        }
        break;
      }
    }
    for (const value of Object.values(n)) if (value && typeof value === "object") walk(value);
  };
  walk(ast);
  return issues;
}

/**
 * Imports that would let generated code delegatecall or rewrite storage slots by hand. The only proxy
 * in a GoodBuild project is the platform's own, which isn't compiled from generated files (D33).
 */
function importProblem(path: string, upgradeable: boolean): string | null {
  const oz = /^@openzeppelin\/contracts(-upgradeable)?\/(.*)$/.exec(path);
  if (!oz) return null;
  const inner = oz[2];
  if (inner.startsWith("proxy/")) {
    if (upgradeable && inner === "proxy/utils/Initializable.sol") return null;
    return `Generated contracts can't import ${path}. ${upgradeable ? "GoodBuild supplies the proxy itself: only import proxy/utils/Initializable.sol from there." : "Contracts here aren't proxies. Keep it a normal contract."}`;
  }
  if (/^utils\/Multicall(Upgradeable)?\.sol$/.test(inner)) return `${path} uses delegatecall, which isn't allowed.`;
  if (upgradeable && /^utils\/(StorageSlot|TransientSlot|SlotDerivation)\.sol$/.test(inner)) {
    return `${path} can write to any storage slot, which would get past the upgrade safety check. Use normal state variables.`;
  }
  return null;
}

/**
 * Rules for upgradeable projects (D33), on top of the guardrails. Constructors only run on the
 * implementation and never reach the proxy, so every setting goes through one `initialize` call,
 * and the implementation itself is sealed so nobody can initialize it.
 *
 * upgrades-core trusts `@custom:oz-*` notes in the source (`@custom:oz-retyped-from` silences the
 * storage check), and the AI writes the source. So the only note allowed is the standard one on the
 * sealed constructor below, whose shape is checked here.
 */
export function upgradeableIssues(file: string, ast: Json, content?: string): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const flag = (node: Json | null, message: string) => issues.push({ file, line: node ? lineAt(content, Number(String(node.src ?? "").split(":")[0])) : undefined, message, source: "guardrail" });

  const notes = (content ?? "").match(/@custom:(oz-|storage-location)[^\n]*/g) ?? [];
  if (notes.some((n) => n.trim() !== ALLOWED_NOTE) || (content !== undefined && !everyNoteOnAConstructor(content))) {
    flag(null, `Only one @custom note is allowed in an upgradeable contract: "/// ${ALLOWED_NOTE}" directly above the constructor. Other notes can switch off the upgrade safety check, so remove them.`);
  }

  for (const contract of ((ast.nodes as Json[]) ?? []).filter((n) => n.nodeType === "ContractDefinition" && n.contractKind === "contract")) {
    const name = String(contract.name);
    const members = (contract.nodes as Json[]) ?? [];
    const functions = members.filter((m) => m.nodeType === "FunctionDefinition");
    const constructors = functions.filter((f) => f.kind === "constructor");
    if (contract.abstract) {
      for (const c of constructors) flag(c, `${name} is an abstract base, so it can't have a constructor in an upgradeable project. Use an internal __${name}_init function with the onlyInitializing modifier.`);
    } else {
      if (!constructors.length) flag(contract, `${name} needs the sealed constructor: /// ${ALLOWED_NOTE} then constructor() { _disableInitializers(); }`);
      for (const c of constructors) if (!sealsItself(c)) flag(c, `${name}'s constructor must do nothing except call _disableInitializers(), with no parameters. Constructors never run on the proxy: move everything else into initialize.`);
      const init = functions.find((f) => f.name === "initialize" && modifierNames(f).includes("initializer"));
      if (!init) flag(contract, `${name} needs function initialize(...) external initializer, which takes the settings a constructor would take.`);
    }
    for (const f of functions) {
      if (modifierNames(f).includes("reinitializer")) flag(f, `${name}: reinitializer isn't supported in this trial. New variables start at zero; give them an owner-only setter if they need a value.`);
    }
  }
  return issues;
}

const ALLOWED_NOTE = "@custom:oz-upgrades-unsafe-allow constructor";

function everyNoteOnAConstructor(content: string): boolean {
  const lines = content.split("\n");
  return lines.every((line, i) => !line.includes("@custom:") || !/@custom:(oz-|storage-location)/.test(line) || /^\s*constructor\s*\(/.test(lines[i + 1] ?? ""));
}

function modifierNames(fn: Json): string[] {
  return ((fn.modifiers as Json[]) ?? []).map((m) => String((m.modifierName as Json | undefined)?.name ?? ""));
}

function sealsItself(ctor: Json): boolean {
  const params = ((ctor.parameters as Json | undefined)?.parameters as unknown[]) ?? [];
  const body = ((ctor.body as Json | undefined)?.statements as Json[]) ?? [];
  if (params.length || ((ctor.modifiers as unknown[]) ?? []).length || body.length !== 1) return false;
  const call = body[0].nodeType === "ExpressionStatement" ? (body[0].expression as Json) : null;
  return call?.nodeType === "FunctionCall" && (call.expression as Json | undefined)?.name === "_disableInitializers";
}

/** Walk every node of an AST, calling `visit` on objects with a nodeType. */
function eachNode(node: unknown, visit: (n: Json) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((c) => eachNode(c, visit));
  const n = node as Json;
  if (n.nodeType === "ImportDirective") return; // an import alone doesn't use anything
  if (typeof n.nodeType === "string") visit(n);
  for (const value of Object.values(n)) if (value && typeof value === "object") eachNode(value, visit);
}

const typeString = (n: Json | undefined) => String((n?.typeDescriptions as Json | undefined)?.typeString ?? "");

/**
 * G$ guardrails, applied when the project is about G$ (GoodDollar): G$ is an ERC-20 on
 * Celo, never native CELO. Rejects msg.value and payable functions, requires the
 * contract to actually handle an ERC-20 (IERC20 / SafeERC20 / ERC-677 onTokenTransfer),
 * requires onTokenTransfer to check msg.sender, and requires SafeERC20 for transfers.
 */
export function gdTokenIssues(
  asts: Array<{ file: string; ast: Json; content?: string }>,
  { allowNative = false }: { allowNative?: boolean } = {},
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  let handlesToken = false;
  for (const { file, ast, content } of asts) {
    const flag = (node: Json, message: string) =>
      issues.push({ file, line: lineAt(content, Number(String(node.src ?? "").split(":")[0])), message, source: "guardrail" });
    eachNode(ast, (n) => {
      if (n.nodeType === "MemberAccess") {
        const expr = n.expression as Json | undefined;
        if (!allowNative && n.memberName === "value" && expr?.nodeType === "Identifier" && expr.name === "msg") {
          flag(n, "This app is about G$, but the contract reads msg.value (native CELO). G$ is an ERC-20: accept it with onTokenTransfer (transferAndCall) or safeTransferFrom.");
        }
        if ((n.memberName === "transfer" || n.memberName === "transferFrom") && /^contract (IERC20|ERC20)\b/.test(typeString(expr))) {
          flag(n, `Use SafeERC20 (${n.memberName === "transfer" ? "safeTransfer" : "safeTransferFrom"}) instead of calling ${n.memberName} on the token directly.`);
        }
        if (["safeTransfer", "safeTransferFrom", "transferFrom"].includes(String(n.memberName))) handlesToken = true;
      }
      if (n.nodeType === "UserDefinedTypeName" || n.nodeType === "IdentifierPath") {
        const name = String(n.name ?? (n.pathNode as Json | undefined)?.name ?? "");
        if (/^(IERC20|SafeERC20)$/.test(name)) handlesToken = true;
      }
      if (n.nodeType === "FunctionDefinition") {
        if (!allowNative && n.stateMutability === "payable") {
          flag(n, `Function ${String(n.name || n.kind)} is payable, which takes native CELO. For G$, take the token instead (no payable functions).`);
        }
        if (n.name === "onTokenTransfer") {
          handlesToken = true;
          let checksSender = false;
          eachNode(n.body, (m) => {
            const e = m.expression as Json | undefined;
            if (m.nodeType === "MemberAccess" && m.memberName === "sender" && e?.nodeType === "Identifier" && e.name === "msg") checksSender = true;
          });
          if (!checksSender) {
            flag(n, "onTokenTransfer must first check that msg.sender is the G$ token: if (msg.sender != address(gd)) revert NotGoodDollar();");
          }
        }
      }
    });
  }
  if (asts.length && !handlesToken) {
    issues.push({
      file: asts[0].file,
      message: "This app is about G$, but no contract handles an ERC-20. Take G$ as IERC20 in the constructor and accept it with onTokenTransfer or safeTransferFrom.",
      source: "guardrail",
    });
  }
  return issues;
}

export interface ContractCheckOptions {
  /** The project is about G$ (GoodDollar): apply the G$ token guardrails. */
  gdToken?: boolean;
  /** The user also explicitly asked for native CELO, so payable functions are allowed. */
  allowNative?: boolean;
  /** An upgradeable project (D33): `initialize` replaces the constructor and its rules apply. */
  upgradeable?: boolean;
  /** Safety and storage checks for an upgradeable project, run after a clean compile. */
  upgradeChecks?: (files: Record<string, string>) => Promise<CheckIssue[]>;
}

/** True when a request explicitly asks for native CELO (the word CELO, not "Celo" the network). */
export function mentionsNativeCelo(text: string): boolean {
  return /\bCELO\b/.test(text);
}

/** True when a request talks about G$ / GoodDollar, so G$ must be the ERC-20, not CELO. */
export function mentionsGd(text: string): boolean {
  return /G\$|\bgood ?dollars?\b|\bgooddollar\b/i.test(text);
}

export async function checkContracts(files: Record<string, string>, options: ContractCheckOptions = {}): Promise<CheckReport> {
  const sources = Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith("contracts/") && p.endsWith(".sol")));
  if (!Object.keys(sources).length) return { ok: true, errors: [], warnings: [], contracts: [] };

  let result: { version: string; output: SolcOutput };
  try {
    result = await runSolc(sources, undefined, { upgradeable: options.upgradeable });
  } catch (error) {
    return {
      ok: false,
      errors: [{ file: "contracts/", message: `The compiler failed to run: ${String(error)}`, source: "solc" }],
      warnings: [],
      contracts: [],
    };
  }
  const { output } = result;
  const errors: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];
  for (const e of output.errors ?? []) {
    const file = e.sourceLocation?.file ?? "contracts/";
    const issue: CheckIssue = {
      file,
      line: lineAt(files[file], e.sourceLocation?.start ?? -1),
      message: e.message,
      source: "solc",
    };
    if (e.severity === "error") errors.push(issue);
    else warnings.push(issue);
  }
  const projectAsts: Array<{ file: string; ast: Json; content?: string }> = [];
  for (const [file, src] of Object.entries(output.sources ?? {})) {
    // Tests never deploy, so deploy guardrails don't apply to them (and a test touching
    // IERC20 mustn't satisfy the G$ "handles a token" check for the real contracts).
    if (!file.startsWith("contracts/") || isTestFile(file)) continue;
    errors.push(...guardrailIssues(file, src.ast, files[file], { upgradeable: options.upgradeable }));
    if (options.upgradeable) errors.push(...upgradeableIssues(file, src.ast, files[file]));
    projectAsts.push({ file, ast: src.ast, content: files[file] });
  }
  if (options.gdToken && projectAsts.length) errors.push(...gdTokenIssues(projectAsts, { allowNative: options.allowNative }));
  const contracts: CompiledContract[] = [];
  const tests: CompiledTest[] = [];
  const abis: unknown[][] = [];
  for (const [file, byName] of Object.entries(output.contracts ?? {})) {
    for (const c of Object.values(byName)) abis.push(c.abi);
    if (!file.startsWith("contracts/")) continue;
    for (const [name, c] of Object.entries(byName)) {
      const bytecode = c.evm?.bytecode?.object ?? "";
      if (!bytecode) continue; // interfaces and abstract contracts
      if (isTestFile(file)) {
        // Only the contract named in the file (FooTest in Foo.t.sol or any *Test) is a suite.
        if (/Test$/.test(name)) tests.push({ name, file, abi: c.abi, bytecode });
        continue;
      }
      contracts.push({ name, file, abi: c.abi, bytecodeBytes: bytecode.length / 2 });
      // EIP-170: EVM chains (Celo included) refuse to deploy runtime code over 24,576 bytes.
      const runtime = (c.evm?.deployedBytecode?.object ?? bytecode).length / 2;
      if (runtime > MAX_CONTRACT_BYTES) {
        errors.push({
          file,
          message: `${name} is ${(runtime / 1024).toFixed(1)} KB, over the 24 KB contract size limit, so it can't be deployed. Split it into smaller contracts (e.g. move features into a second contract that takes this one's address), drop on-chain history arrays, or shorten error and event lists.`,
          source: "solc",
        });
      }
    }
  }
  // The deploy manifest (D23) is checked against what compiled, so a rename or a bad reference
  // is fixed in the same auto-fix loop as a compile error.
  const manifestSource = files[MANIFEST_PATH];
  if (manifestSource !== undefined && contracts.length) {
    const parsed = parseManifest(manifestSource);
    if (!parsed.ok) {
      for (const i of parsed.issues) errors.push({ file: MANIFEST_PATH, message: i.message, source: "manifest" });
    } else {
      const plan = planManifest(parsed.manifest, contracts.map((c) => ({ name: c.name, abi: c.abi as never })), { upgradeable: options.upgradeable });
      if (!plan.ok) for (const i of plan.issues) errors.push({ file: MANIFEST_PATH, message: i.message, source: "manifest" });
    }
  }
  // Only worth running on code that compiled and follows the rules: the agent fixes those first.
  if (options.upgradeChecks && !errors.length && contracts.length) errors.push(...(await options.upgradeChecks(files)));
  return { ok: errors.length === 0, errors, warnings, contracts, tests, abis, compilerVersion: result.version };
}

export function isTestFile(path: string): boolean {
  return path.startsWith("contracts/test/");
}

// ---------------------------------------------------------------------------
// App (TypeScript / React)

const RESOLVE_EXT = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];

function resolveRelative(from: string, spec: string, files: Record<string, string>): boolean {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return RESOLVE_EXT.some((ext) => base + ext in files);
}

function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Syntax errors and unresolved imports in the generated app. Type errors are left to the preview. */
export function checkApp(files: Record<string, string>, opts: { assets?: string[] } = {}): CheckReport {
  const errors: CheckIssue[] = [];
  const deps = new Set(dependenciesOf(files));
  for (const [file, content] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?)$/.test(file)) continue;
    const out = ts.transpileModule(content, {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    });
    for (const d of out.diagnostics ?? []) {
      const line = d.start !== undefined ? content.slice(0, d.start).split("\n").length : undefined;
      errors.push({ file, line, message: ts.flattenDiagnosticMessageText(d.messageText, "\n"), source: "syntax" });
    }
    for (const imp of ts.preProcessFile(content, true, true).importedFiles) {
      const spec = imp.fileName;
      const line = content.slice(0, imp.pos).split("\n").length;
      if (spec.startsWith(".")) {
        if (spec.endsWith(".css") ? !(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) in files) : !resolveRelative(file, spec, files)) {
          errors.push({ file, line, message: `Import "${spec}" doesn't match any file.`, source: "imports" });
        }
      } else if (spec.startsWith("@/")) {
        errors.push({ file, line, message: `Use a relative import instead of "${spec}" (the preview has no path aliases).`, source: "imports" });
      } else {
        const pkg = packageName(spec);
        if (!deps.has(pkg)) {
          const hint = pkg in ALLOWED_DEPENDENCIES ? ` Call add_dependency("${pkg}") first.` : " It isn't on the allowed package list.";
          errors.push({ file, line, message: `Package "${pkg}" isn't installed.${hint}`, source: "imports" });
        }
      }
    }
  }
  for (const [file, content] of Object.entries(files)) {
    if (/\.(tsx?|jsx?)$/.test(file) && !file.startsWith(PLATFORM_DIR)) errors.push(...addressMapIssues(file, content));
  }
  if (!files["src/App.tsx"]) errors.push({ file: "src/App.tsx", message: "src/App.tsx is missing (it's the app entry).", source: "paths" });
  if (opts.assets) errors.push(...assetRefIssues(files, opts.assets));
  errors.push(...lucideIssues(files));
  errors.push(...dataIssues(files));
  return { ok: errors.length === 0, errors, warnings: [], contracts: [] };
}

/**
 * Icon names in the platform's lucide-react, which must be the version generated apps pin
 * (ALLOWED_DEPENDENCIES; a test in checks.test.ts fails when they drift apart).
 */
const LUCIDE_NAMES = new Set(Object.keys(Lucide));

/**
 * A named import that lucide-react doesn't export is `undefined` at runtime: React throws
 * "Element type is invalid" and the preview goes blank. Found in HARNESS.md E1 (Instagram:
 * lucide 1.x removed brand icons).
 */
export function lucideIssues(files: Record<string, string>): CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const [file, content] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?)$/.test(file)) continue;
    for (const m of content.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g)) {
      for (const raw of m[1].split(",")) {
        const name = raw.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "").trim();
        if (!name || LUCIDE_NAMES.has(name)) continue;
        const line = content.slice(0, m.index).split("\n").length;
        issues.push({
          file,
          line,
          message: `lucide-react has no icon "${name}"${/^(Instagram|Twitter|Facebook|Github|GitHub|Linkedin|LinkedIn|Youtube|YouTube|Tiktok|TikTok|Whatsapp|WhatsApp|Discord|Telegram|X)$/.test(name) ? " (lucide has no brand icons; use a generic one such as AtSign, Camera, MessageCircle, Globe or Link)" : ""}. Pick an icon that exists.`,
          source: "imports",
        });
      }
    }
  }
  return issues;
}

const HOSTED_BACKENDS = /\b(?:[a-z0-9-]+\.)*(?:firebaseio\.com|firebaseapp\.com|firestore\.googleapis\.com|supabase\.co|mongodb\.net|airtable\.com|sheetdb\.io|formspree\.io|getform\.io|web3forms\.com|jsonbin\.io|pantry\.cloud)\b/;
const OWN_ROUTE_FETCH = /\b(?:fetch|axios(?:\.[a-z]+)?)\(\s*[`"'](\/(?!assets\/)[^`"']*)/g;
const COLLECTION_CALL = /\b(?:collection|useCollection)(?:<[^>()]*>)?\(\s*["'`]([^"'`]*)["'`]/g;

/**
 * Saved data goes through src/lib/db.ts (docs/APP_DATA.md). A static app has no server of its own, so
 * a call to its own "/api/..." route only fails once published, and a hosted database sends visitors' data elsewhere.
 */
export function dataIssues(files: Record<string, string>): CheckIssue[] {
  const issues: CheckIssue[] = parseDataRules(files[DATA_RULES_PATH]).issues.map((message) => ({ file: DATA_RULES_PATH, message, source: "paths" }));
  for (const [file, content] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?)$/.test(file) || file === "src/lib/db.ts" || file === "src/lib/useDb.ts" || file.startsWith(PLATFORM_DIR)) continue;
    const lineOf = (index: number) => content.slice(0, index).split("\n").length;
    const hosted = HOSTED_BACKENDS.exec(content);
    if (hosted) issues.push({ file, line: lineOf(hosted.index), message: `Don't send app data to ${hosted[0]}. Save it with src/lib/db.ts (load the app-data guide).`, source: "imports" });
    const raw = content.indexOf(DATA_PATH_PREFIX);
    if (raw >= 0) issues.push({ file, line: lineOf(raw), message: "Use the helpers in src/lib/db.ts instead of calling the data API directly.", source: "imports" });
    for (const m of content.matchAll(OWN_ROUTE_FETCH)) {
      issues.push({ file, line: lineOf(m.index), message: `This app has no server, so ${m[1]} won't exist once it's published. Save and read data with src/lib/db.ts (load the app-data guide).`, source: "imports" });
    }
    for (const m of content.matchAll(COLLECTION_CALL)) {
      if (!COLLECTION_NAME.test(m[1])) issues.push({ file, line: lineOf(m.index), message: `Collection name "${m[1]}" isn't valid: use lowercase letters, numbers, - and _, starting with a letter.`, source: "imports" });
    }
  }
  return issues;
}

/** Every /assets/<name> path in the app must be an uploaded (non-reference) asset. */
export function assetRefIssues(files: Record<string, string>, assets: string[]): CheckIssue[] {
  const known = new Set(assets);
  const issues: CheckIssue[] = [];
  for (const [file, content] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?|html|css)$/.test(file) || file.startsWith("src/assets/")) continue;
    for (const name of new Set(assetRefs(content))) {
      if (known.has(name)) continue;
      const line = content.slice(0, content.indexOf(`/assets/${name}`)).split("\n").length;
      issues.push({
        file,
        line,
        message: `/assets/${name} isn't an uploaded file.${known.size ? ` Uploaded: ${[...known].map((n) => `/assets/${n}`).join(", ")}.` : " The user hasn't uploaded any images; use icons or gradients instead."}`,
        source: "imports",
      });
    }
  }
  return issues;
}

/**
 * `<Name>Address` from the platform contracts module is a map from chain id to address.
 * Passing the map itself to viem throws `Address "[object Object]" is invalid` at runtime,
 * so every use must index it (`TipJarAddress[chain.id]`). Other uses are rejected.
 */
export function addressMapIssues(file: string, content: string): CheckIssue[] {
  const sf = ts.createSourceFile(file, content, ts.ScriptTarget.ES2020, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const maps = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!/(^|\/)contracts(\/[A-Za-z0-9_]+)?$/.test(st.moduleSpecifier.text)) continue;
    const named = st.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const el of named.elements) {
      if ((el.propertyName ?? el.name).text.endsWith("Address")) maps.add(el.name.text);
    }
  }
  if (!maps.size) return [];
  const issues: CheckIssue[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && maps.has(node.text)) {
      const p = node.parent;
      const ok =
        ts.isImportSpecifier(p) ||
        (ts.isElementAccessExpression(p) && p.expression === node) ||
        // `chain.id in TipJarAddress` is a fine existence check.
        (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.InKeyword && p.right === node);
      if (!ok) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        issues.push({
          file,
          line,
          message: `${node.text} is a map from chain id to address, not an address. Use ${node.text}[chain.id] (chain from lib/chain.ts), which is undefined until the contract is deployed.`,
          source: "imports",
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return issues;
}

/** Human-readable list for the model and the build log. */
export function formatIssues(issues: CheckIssue[], max = 25): string {
  const shown = issues.slice(0, max).map((i) => `- ${i.file}${i.line ? `:${i.line}` : ""} [${i.source}] ${i.message}`);
  if (issues.length > max) shown.push(`- …and ${issues.length - max} more`);
  return shown.join("\n");
}
