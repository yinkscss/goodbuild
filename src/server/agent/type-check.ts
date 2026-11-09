import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { DATA_RULES_PATH } from "@/lib/app-data";

import type { CheckIssue } from "./checks";
import { PLATFORM_DIR, WALLET_DIR } from "./template";

/**
 * The type check (D68): TypeScript over the app's files, against the same package versions a
 * published app is bundled with. checkApp only parses, so a prop that doesn't exist, a missing
 * export or the wrong arguments to viem got as far as the preview before anyone saw them.
 *
 * Not strict on purpose (see scripts/type-check.cjs). It runs in a child process with a time and
 * memory limit: viem's types take seconds to check.
 */

export type TypeCheckMode = "off" | "warn" | "enforce";

/**
 * "warn" lists type errors in the build log and gives them to the builder when it asks (run_checks),
 * but a build still finishes with them. "enforce" sends them to auto-fix like a compile error.
 */
export function typeCheckMode(env: NodeJS.ProcessEnv = process.env): TypeCheckMode {
  return env.TYPE_CHECK === "enforce" ? "enforce" : env.TYPE_CHECK === "warn" ? "warn" : "off";
}

export interface TypeCheckResult {
  /** False when it couldn't run (packages missing, too slow). Never held against the app. */
  ran: boolean;
  issues: CheckIssue[];
  note: string;
  ms: number;
}

const MAX_ISSUES = 12;
const TIMEOUT_MS = 45_000;
const MAX_HEAP_MB = 1536;

/** Files GoodBuild writes and the builder can't change: an error there isn't the builder's to fix. */
function platformOwned(file: string): boolean {
  return (
    file.startsWith(PLATFORM_DIR) ||
    file.startsWith(WALLET_DIR) ||
    file.startsWith("src/assets/") ||
    file === "src/lib/db.ts" ||
    file === "src/lib/useDb.ts" ||
    file === DATA_RULES_PATH
  );
}

// A few at a time: each one is a process that uses a core and up to MAX_HEAP_MB.
let active = 0;
const waiting: Array<() => void> = [];
async function acquire() {
  const limit = Math.max(1, Number(process.env.TYPE_CHECK_CONCURRENCY) || 2);
  if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}
function release() {
  active--;
  waiting.shift()?.();
}

/** Where the app's packages and their types are installed, or null when this machine doesn't have them. */
export function typeCheckDirs(cwd = process.cwd()): { runtimeDir: string; typesDir: string } | null {
  // The deployed runtime pack has no .d.ts files, so this needs the installed workspace (the Docker
  // image has it: a full install, publish-runtime included).
  const runtimeDir = path.join(cwd, "publish-runtime");
  const typesDir = path.join(cwd, "node_modules", "@types");
  const ok = existsSync(path.join(runtimeDir, "node_modules", "viem", "package.json")) && existsSync(path.join(typesDir, "react-18", "index.d.ts")) && existsSync(path.join(typesDir, "react-dom-18", "index.d.ts"));
  return ok ? { runtimeDir, typesDir } : null;
}

interface Raw {
  diagnostics?: Array<{ file: string; line?: number; code: number; message: string }>;
  fatal?: string;
}

/** Type-check the project's TypeScript. Never throws. */
export async function typeCheck(files: Record<string, string>, options: { timeoutMs?: number; cwd?: string } = {}): Promise<TypeCheckResult> {
  const started = Date.now();
  const done = (r: Omit<TypeCheckResult, "ms">): TypeCheckResult => ({ ...r, ms: Date.now() - started });
  const dirs = typeCheckDirs(options.cwd);
  if (!dirs) return done({ ran: false, issues: [], note: "skipped: the app packages' types aren't installed here" });
  const sources = Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith("src/") && /\.(tsx?|json)$/.test(p)));

  await acquire();
  try {
    const raw = await new Promise<Raw>((resolve) => {
      const script = path.join(options.cwd ?? process.cwd(), "scripts", "type-check.cjs");
      const child = execFile(process.execPath, [`--max-old-space-size=${MAX_HEAP_MB}`, script], { timeout: options.timeoutMs ?? TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve({ fatal: err.killed ? "it took too long" : String(err.message).split("\n")[0].slice(0, 160) });
        try {
          resolve(JSON.parse(stdout) as Raw);
        } catch {
          resolve({ fatal: "unreadable output" });
        }
      });
      child.stdin?.end(JSON.stringify({ files: sources, ...dirs }));
    });
    if (raw.fatal || !raw.diagnostics) return done({ ran: false, issues: [], note: `skipped: the type check didn't finish (${(raw.fatal ?? "no result").split("\n")[0].slice(0, 160)})` });
    const own = raw.diagnostics.filter((d) => !platformOwned(d.file));
    const issues: CheckIssue[] = own.slice(0, MAX_ISSUES).map((d) => ({ file: d.file, line: d.line, message: d.message, source: "types" }));
    const more = own.length > MAX_ISSUES ? ` (showing ${MAX_ISSUES})` : "";
    return done({ ran: true, issues, note: own.length ? `${own.length} type error${own.length === 1 ? "" : "s"}${more}` : "types are consistent" });
  } finally {
    release();
  }
}
