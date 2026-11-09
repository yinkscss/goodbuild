// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Turn {
  status: string;
  error?: string | null;
  usd: number;
  strongUsd: number;
  seconds: number;
  fixAttempts: number;
  firstTryClean: boolean;
  toolChecks: number;
  runCheck: string;
  files: number;
  savedVersion: number | null;
}
interface Summary {
  scenarios: number;
  passed: number;
  passRate: number;
  firstTryRate: number;
  fixAttempts: number;
  toolChecks: number;
  usd: number;
  strongShare: number;
  seconds: number;
}
interface Result {
  id: string;
  kind: string;
  pass: boolean;
  failure: string | null;
  turns: Turn[];
}
// The suite's scoring lives in the script that runs it (scripts/eval-suite.mjs), which has no types.
const suite = (await import("../../../scripts/eval-suite.mjs" as string)) as {
  verdict: (kind: string, turns: Turn[]) => string | null;
  summarise: (results: Result[]) => Summary;
  regressions: (now: Summary, before: Summary) => string[];
  markdown: (results: Result[], summary: Summary, baseline: { summary: Summary } | null, problems: string[]) => string;
};

const turn = (over: Partial<Turn> = {}): Turn => ({ status: "ready", usd: 0.05, strongUsd: 0, seconds: 60, fixAttempts: 0, firstTryClean: true, toolChecks: 1, runCheck: "done: it runs", files: 5, savedVersion: 1, ...over });

describe("the eval suite's scenarios", () => {
  const { scenarios } = JSON.parse(readFileSync("docs/evals/suite/suite.json", "utf8")) as { scenarios: Array<{ id: string; kind: string; turns: string[] }> };
  it("has about twenty, each with a unique id, a known kind and real prompts", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(18);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
    for (const s of scenarios) {
      expect(["build", "edit", "refuse"]).toContain(s.kind);
      expect(s.turns.length).toBeGreaterThanOrEqual(s.kind === "edit" ? 2 : 1);
      for (const t of s.turns) expect(t.length).toBeGreaterThan(20);
    }
  });
  it("covers dApps, websites, edits and requests that must be refused", () => {
    const count = (kind: string) => scenarios.filter((s) => s.kind === kind).length;
    expect(count("build")).toBeGreaterThanOrEqual(10);
    expect(count("edit")).toBeGreaterThanOrEqual(3);
    expect(count("refuse")).toBeGreaterThanOrEqual(2);
  });
});

describe("scoring", () => {
  it("passes a build only when every turn is ready and the app ran", () => {
    expect(suite.verdict("build", [turn()])).toBeNull();
    expect(suite.verdict("edit", [turn(), turn()])).toBeNull();
    expect(suite.verdict("build", [turn({ status: "needs_fix" })])).toMatch(/turn 1 ended "needs_fix"/);
    expect(suite.verdict("edit", [turn(), turn({ status: "answered" })])).toMatch(/turn 2 ended "answered"/);
    expect(suite.verdict("build", [turn({ runCheck: "error: 1 problem" })])).toMatch(/didn't run/);
    // The run check not being available isn't the app's failure.
    expect(suite.verdict("build", [turn({ runCheck: "not run" })])).toBeNull();
    expect(suite.verdict("build", [])).toBe("no turns ran");
  });

  it("passes a refusal only when nothing was built", () => {
    expect(suite.verdict("refuse", [turn({ status: "answered", files: 0, savedVersion: null })])).toBeNull();
    expect(suite.verdict("refuse", [turn({ status: "ready" })])).toMatch(/wrote files/);
    expect(suite.verdict("refuse", [turn({ status: "error", error: "provider down", files: 0, savedVersion: null })])).toMatch(/provider down/);
  });

  const results: Result[] = [
    { id: "a", kind: "build", pass: true, failure: null, turns: [turn({ usd: 0.1, strongUsd: 0.04 })] },
    { id: "b", kind: "edit", pass: false, failure: 'turn 2 ended "needs_fix"', turns: [turn(), turn({ status: "needs_fix", fixAttempts: 2, firstTryClean: false, usd: 0.25, strongUsd: 0.2 })] },
    { id: "c", kind: "refuse", pass: true, failure: null, turns: [turn({ status: "answered", usd: 0.01, files: 0, savedVersion: null })] },
  ];

  it("adds a run up", () => {
    const s = suite.summarise(results);
    expect(s).toMatchObject({ scenarios: 3, passed: 2, fixAttempts: 2 });
    expect(s.passRate).toBeCloseTo(2 / 3);
    // Of the three build turns (the refusal isn't one), two were clean first time.
    expect(s.firstTryRate).toBeCloseTo(2 / 3);
    expect(s.usd).toBeCloseTo(0.41);
    expect(s.strongShare).toBeCloseTo(0.24 / 0.41);
  });

  it("calls a regression when quality falls or cost jumps, and not for noise", () => {
    const before = suite.summarise(results);
    expect(suite.regressions(before, before)).toEqual([]);
    expect(suite.regressions({ ...before, passRate: before.passRate - 0.05 }, before)).toEqual([]);
    expect(suite.regressions({ ...before, passRate: before.passRate - 0.2 }, before)[0]).toMatch(/pass rate fell/);
    expect(suite.regressions({ ...before, usd: before.usd * 1.2 }, before)).toEqual([]);
    expect(suite.regressions({ ...before, usd: before.usd * 1.5 }, before)[0]).toMatch(/cost per scenario rose/);
    // Half the suite at the same cost per scenario is not a regression.
    expect(suite.regressions({ ...before, scenarios: 1, usd: before.usd / 3 }, before)).toEqual([]);
  });

  it("writes a summary a person can read, with the baseline beside it", () => {
    const s = suite.summarise(results);
    const md = suite.markdown(results, s, { summary: { ...s, passRate: 1, usd: 0.3 } }, ["the pass rate fell from 100% to 67%"]);
    expect(md).toContain("| Scenarios passed | 2 of 3, 67% (was 100%) |");
    expect(md).toContain("**Regression:** the pass rate fell from 100% to 67%.");
    expect(md).toContain('| b | edit | **fail** | 2 | $0.300 | 120s | turn 2 ended "needs_fix" |');
    expect(md).not.toContain("—");
  });
});
