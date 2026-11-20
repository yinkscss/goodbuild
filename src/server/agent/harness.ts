/**
 * Harness v2 (D152, docs/HARNESS_V2_PLAN.md): Sonnet writes the spec and the contracts, DeepSeek the front
 * end, the builder checks its own work. It is every build's harness, with no setting to turn it off. Decided
 * when a turn's setup is made and saved with it, so a turn that began on v1 resumes on v1.
 */
let v1ForTests = false;

/** Whether a new build uses harness v2: always, outside the tests of the earlier v1 loop. */
export function usesHarnessV2(): boolean {
  return !v1ForTests;
}

/**
 * Test-only: run new builds on the v1 loop, which still runs turns saved before v2 shipped. vitest.setup.ts
 * turns it on for every test file; the v2 tests turn it off.
 */
export function setV1HarnessForTests(on: boolean): void {
  v1ForTests = on;
}

function positive(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return raw !== undefined && raw !== "" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Model calls in one v2 build (v1: 50). Spend is still bounded per call by holds, the free ceiling and sponsorship. */
export const V2_MAX_CALLS = 90;
/** Tool rounds in one v2 pass (v1: 20). The no-progress stops still apply. */
export const V2_MAX_ROUNDS = 40;
/** The time the builder's own checks may take in one v2 turn, in place of v1's three run_checks. */
export const CHECK_BUDGET_MS = 240_000;
/** Rounds the spec call may take to read the project before it writes the spec. */
export const SPEC_MAX_ROUNDS = 6;

export function harnessLimits(env: Record<string, string | undefined> = process.env) {
  return {
    maxCalls: positive(env.V2_MAX_CALLS, V2_MAX_CALLS),
    maxRounds: positive(env.V2_MAX_ROUNDS, V2_MAX_ROUNDS),
    checkBudgetMs: positive(env.CHECK_BUDGET_MS, CHECK_BUDGET_MS),
  };
}

/**
 * What failing acceptance flows do (D152): "warn" (default) logs them and shows them to the builder; "enforce"
 * sends them to the fix loop like any other failed check.
 */
export function acceptanceMode(env: Record<string, string | undefined> = process.env): "warn" | "enforce" {
  return (env.ACCEPTANCE ?? "").trim().toLowerCase() === "enforce" ? "enforce" : "warn";
}

/** Requests that touch a project's contracts: these get a spec and a Sonnet contracts phase (D152). */
export const CONTRACT_WORK = /\b(?:contract|stake|staking|token|escrow|payment|pay|on.?chain|mint|swap|vault|pool|withdraw|deposit|fee|reward|vote|voting|treasury|allowance|supply)s?\b|G\$/i;
