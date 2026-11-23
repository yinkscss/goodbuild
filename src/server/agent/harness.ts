/**
 * Harness v2 (D152, docs/HARNESS_V2_PLAN.md; D165 moved the spec and contracts to DeepSeek): the spec, the contracts, then the front
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

/** Model calls in one v2 build (v1: 50). Spend is still bounded per call by holds, the free ceiling and sponsorship. */
export const V2_MAX_CALLS = 90;
/** Tool rounds in one v2 pass (v1: 20). The no-progress stops still apply. */
export const V2_MAX_ROUNDS = 40;
/** The time the builder's own checks may take in one v2 turn, in place of v1's three run_checks. */
export const CHECK_BUDGET_MS = 240_000;
/**
 * Rounds the spec call may take to read the project before it writes the spec. 5 since D165: DeepSeek took 4 or
 * 5 in every live run (it reads guides first); Sonnet's 3 would have ended most of them without a spec. If it
 * still hasn't written one, it is told to write it now and gets SPEC_LAST_ROUNDS more.
 */
export const SPEC_MAX_ROUNDS = 5;
export const SPEC_LAST_ROUNDS = 2;

/** v2's limits. Fixed in code: there is no setting for them (owner, 21 Nov 2026). */
export const V2_LIMITS = { maxCalls: V2_MAX_CALLS, maxRounds: V2_MAX_ROUNDS, checkBudgetMs: CHECK_BUDGET_MS } as const;

/** Requests that touch a project's contracts: these get a spec and a contracts phase (D152). */
export const CONTRACT_WORK = /\b(?:contract|stake|staking|token|escrow|payment|pay|on.?chain|mint|swap|vault|pool|withdraw|deposit|fee|reward|vote|voting|treasury|allowance|supply)s?\b|G\$/i;
