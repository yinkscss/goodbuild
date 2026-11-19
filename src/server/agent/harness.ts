import { adminWallets } from "@/server/settings/mainnet-access";

/**
 * Harness v2 (D152, docs/HARNESS_V2_PLAN.md): Sonnet writes the spec and the contracts, DeepSeek the front
 * end, the builder checks its own work. HARNESS_V2 = off (default) | admins (wallets in ADMIN_WALLETS) | on.
 * Decided once when a turn's setup is made and saved with it, so a resumed turn keeps the harness it began with.
 */
export type HarnessMode = "off" | "admins" | "on";

export function harnessMode(env: Record<string, string | undefined> = process.env): HarnessMode {
  const raw = (env.HARNESS_V2 ?? "").trim().toLowerCase();
  return raw === "on" || raw === "admins" ? raw : "off";
}

/** Whether a build by this wallet uses harness v2. */
export function usesHarnessV2(wallet: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const mode = harnessMode(env);
  if (mode === "on") return true;
  if (mode === "admins") return Boolean(wallet && adminWallets(env.ADMIN_WALLETS).has(wallet.toLowerCase()));
  return false;
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
