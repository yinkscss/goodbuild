import "server-only";

import { execFile } from "node:child_process";
import path from "node:path";
import ts from "typescript";

import { ALLOWED_DEPENDENCIES, PLATFORM_DIR, dependenciesOf } from "./template";

/** Compiler settings, pinned (CONTRACTS_AND_DEPLOYMENT.md §2, §4). */
export const SOLC_SETTINGS = {
  // OpenZeppelin 5.6 uses MCOPY, so Cancun is required. Celo L2 Cancun support is
  // UNVERIFIED in Celo's docs (Q35); M5's pre-deploy simulation will surface it.
  evmVersion: "cancun",
  optimizer: { enabled: true, runs: 200 },
  outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"], "": ["ast"] } },
} as const;

export interface CheckIssue {
  file: string;
  line?: number;
  message: string;
  source: "solc" | "guardrail" | "syntax" | "imports" | "paths";
}

export interface CompiledContract {
  name: string;
  file: string;
  abi: unknown[];
  bytecodeBytes: number;
}

export interface CheckReport {
  ok: boolean;
  errors: CheckIssue[];
  warnings: CheckIssue[];
  contracts: CompiledContract[];
  compilerVersion?: string;
}

export const MAX_FILE_BYTES = 120_000;
export const MAX_FILES = 80;

/** Where generated files may live. Everything else is refused. */
export function pathProblem(p: string): string | null {
  if (!p || p.startsWith("/") || p.includes("\\") || p.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) {
    return `Invalid path "${p}". Use a relative path like src/App.tsx or contracts/TipJar.sol.`;
  }
  if (p === "package.json") return "package.json is managed by GoodBuild. Use add_dependency.";
  if (p.startsWith(PLATFORM_DIR)) return `${PLATFORM_DIR} is written by GoodBuild from the compiled contracts. Import from it instead.`;
  if (/^contracts\/[A-Za-z0-9_]+\.sol$/.test(p)) return null;
  if (/^src\/[A-Za-z0-9_\-/.]+\.(tsx?|css|json)$/.test(p)) return null;
  if (p === "public/index.html") return null;
  return `Files must be under src/ (.ts, .tsx, .css, .json) or contracts/ (Name.sol). Got "${p}".`;
}

// ---------------------------------------------------------------------------
// Solidity

type Json = Record<string, unknown>;

interface SolcOutput {
  errors?: Array<{ severity: string; message: string; formattedMessage?: string; sourceLocation?: { file: string; start: number } }>;
  contracts?: Record<string, Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>>;
  sources?: Record<string, { ast: Json; id: number }>;
}

/** Run solc in a child process (scripts/solc-compile.cjs). */
export function runSolc(sources: Record<string, string>, timeoutMs = 60_000): Promise<{ version: string; output: SolcOutput }> {
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
    child.stdin?.end(JSON.stringify({ sources, settings: SOLC_SETTINGS }));
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
export function guardrailIssues(file: string, ast: Json, content?: string): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const at = (node: Json) => {
    const start = Number(String(node.src ?? "").split(":")[0]);
    return lineAt(content, start);
  };
  const flag = (node: Json, message: string) => issues.push({ file, line: at(node), message, source: "guardrail" });

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as Json;
    switch (n.nodeType) {
      case "InlineAssembly":
        flag(n, "Inline assembly isn't allowed in generated contracts.");
        break;
      case "Identifier":
        if (n.name === "selfdestruct" || n.name === "suicide") flag(n, "selfdestruct isn't allowed.");
        break;
      case "MemberAccess": {
        const expr = n.expression as Json | undefined;
        if (n.memberName === "delegatecall" || n.memberName === "callcode") flag(n, `${n.memberName} isn't allowed.`);
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
    result = await runSolc(sources);
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
    if (!file.startsWith("contracts/")) continue;
    errors.push(...guardrailIssues(file, src.ast, files[file]));
    projectAsts.push({ file, ast: src.ast, content: files[file] });
  }
  if (options.gdToken && projectAsts.length) errors.push(...gdTokenIssues(projectAsts, { allowNative: options.allowNative }));
  const contracts: CompiledContract[] = [];
  for (const [file, byName] of Object.entries(output.contracts ?? {})) {
    if (!file.startsWith("contracts/")) continue;
    for (const [name, c] of Object.entries(byName)) {
      const bytecode = c.evm?.bytecode?.object ?? "";
      if (!bytecode) continue; // interfaces and abstract contracts
      contracts.push({ name, file, abi: c.abi, bytecodeBytes: bytecode.length / 2 });
    }
  }
  return { ok: errors.length === 0, errors, warnings, contracts, compilerVersion: result.version };
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
export function checkApp(files: Record<string, string>): CheckReport {
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
  return { ok: errors.length === 0, errors, warnings: [], contracts: [] };
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
