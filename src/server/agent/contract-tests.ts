import "server-only";

import { execFile } from "node:child_process";
import path from "node:path";

import type { CheckIssue, CheckReport } from "./checks";

/** One test function's outcome from scripts/evm-test.mjs. */
export interface ContractTestResult {
  contract: string;
  file: string;
  test: string;
  ok: boolean;
  reason?: string;
  gasUsed?: number;
}

/**
 * Run the compiled test contracts (contracts/test/*.t.sol) in a local in-memory EVM, in a
 * child process with a timeout (P16). Local only: nothing is deployed to a network.
 */
export function runContractTests(
  report: Pick<CheckReport, "tests" | "abis">,
  timeoutMs = 60_000,
): Promise<{ results: ContractTestResult[]; issues: CheckIssue[] }> {
  const tests = report.tests ?? [];
  if (!tests.length) return Promise.resolve({ results: [], issues: [] });
  const script = path.join(process.cwd(), "scripts", "evm-test.mjs");
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [script], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      const fail = (message: string) =>
        resolve({ results: [], issues: [{ file: tests[0].file, message, source: "test" }] });
      if (err) return fail(`The contract tests didn't finish (${err.killed ? `over ${timeoutMs / 1000}s, likely an endless loop` : String(err.message).slice(0, 200)}).`);
      let out: { results?: ContractTestResult[]; fatal?: string };
      try {
        out = JSON.parse(stdout);
      } catch {
        return fail("The contract test runner returned unreadable output.");
      }
      if (out.fatal) return fail(`The contract test runner failed: ${out.fatal.split("\n")[0]}`);
      const results = out.results ?? [];
      const issues: CheckIssue[] = results
        .filter((r) => !r.ok)
        .map((r) => ({ file: r.file, message: `${r.contract}.${r.test} failed: ${r.reason ?? "reverted"}`, source: "test" as const }));
      resolve({ results, issues });
    });
    child.stdin?.end(JSON.stringify({ tests, abis: report.abis ?? [] }));
  });
}
