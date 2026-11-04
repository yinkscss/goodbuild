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
        if (callee?.nodeType === "FunctionCallOptions") callee = callee.expression as Json;
        if (callee?.nodeType === "MemberAccess" && callee.memberName === "call") {
          const args = (n.arguments as Json[]) ?? [];
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

export async function checkContracts(files: Record<string, string>): Promise<CheckReport> {
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
  for (const [file, src] of Object.entries(output.sources ?? {})) {
    if (file.startsWith("contracts/")) errors.push(...guardrailIssues(file, src.ast, files[file]));
  }
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
  if (!files["src/App.tsx"]) errors.push({ file: "src/App.tsx", message: "src/App.tsx is missing (it's the app entry).", source: "paths" });
  return { ok: errors.length === 0, errors, warnings: [], contracts: [] };
}

/** Human-readable list for the model and the build log. */
export function formatIssues(issues: CheckIssue[], max = 25): string {
  const shown = issues.slice(0, max).map((i) => `- ${i.file}${i.line ? `:${i.line}` : ""} [${i.source}] ${i.message}`);
  if (issues.length > max) shown.push(`- …and ${issues.length - max} more`);
  return shown.join("\n");
}
