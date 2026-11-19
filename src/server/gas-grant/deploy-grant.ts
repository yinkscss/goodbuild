import "server-only";

import { and, eq } from "drizzle-orm";
import type { Address } from "viem";

import type { Db } from "@/server/db/client";
import { ledgerEntries } from "@/server/db/schema";

import { ensureGas, grantsEnabled, type GrantDeps, type GrantRule } from "./grant";

/**
 * Network fee for a mainnet deploy, paid by the gas wallet (D157). Silent: the person just deploys.
 *
 * What it does: when a verified person prepares a Celo mainnet deploy and their wallet can't pay the
 * fee, the gas wallet tops that wallet up to the estimated fee, before the plan is returned. The person
 * still signs and sends every deploy transaction themselves (D2, CLAUDE.md rule 8): this only sends CELO.
 *
 * It never blocks or fails a deploy. If anything is off (no key, switch off, fund empty, limit reached,
 * not verified, estimate too high), prepare carries on and the deploy modal's existing "add CELO" help applies.
 *
 * Limits, all settable here: per person per UTC day (resets at midnight UTC, doesn't accumulate), with a
 * higher limit for people who have bought credits, a per-deploy ceiling, and a daily budget in CELO.
 */
export const DEPLOY_GRANTS_PER_DAY = 3;
export const DEPLOY_GRANTS_PER_DAY_BUYER = 10;
/** Above this a deploy isn't covered at all (a half-funded multi-contract deploy would strand). */
export const DEPLOY_MAX_WEI = BigInt("3000000000000000000"); // 3 CELO
/** The most CELO deploy top-ups may send per UTC day, over everyone. Votes have their own limit. */
export const DEPLOY_DAY_BUDGET_WEI = BigInt("20000000000000000000"); // 20 CELO
export const GAS_DEPLOY_GRANTS_KEY = "gas_deploy_grants";

/** Fixed cost of a creation plus a guess for the constructor's storage writes. */
const BASE_GAS = 150_000;
/** Measured 6 Nov 2026 on mainnet: 479,062 gas for 2,157 bytes (about 222 a byte, constructor included). */
const GAS_PER_BYTE = 230;
/** Headroom on the whole estimate. Email wallets add 30% to the gas they send (use-deploy.ts). */
const MARGIN_NUM = BigInt(12);
const MARGIN_DEN = BigInt(10);

export interface DeployFeePlan {
  projectId: string;
  chainId: number;
  sourceHash: string;
  steps: Array<{ name: string; bytecodeBytes: number; upgradeable?: { kind: string; proxyBytecode?: string } }>;
  alreadyDeployed: Record<string, unknown>;
}

/** An estimate, not a simulation: the contracts still to deploy, at the current fee cap. UNVERIFIED for large or multi-contract plans. */
export function estimateDeployFeeWei(plan: DeployFeePlan, maxFeePerGas: bigint): bigint {
  let gas = BigInt(0);
  for (const step of plan.steps) {
    if (plan.alreadyDeployed[step.name]) continue;
    let bytes = step.bytecodeBytes;
    // A first deploy of an upgradeable contract also creates its proxy.
    if (step.upgradeable?.kind === "first" && step.upgradeable.proxyBytecode) bytes += (step.upgradeable.proxyBytecode.length - 2) / 2;
    gas += BigInt(BASE_GAS) + BigInt(Math.ceil(bytes)) * BigInt(GAS_PER_BYTE);
  }
  return (gas * maxFeePerGas * MARGIN_NUM) / MARGIN_DEN;
}

/** Whoever has bought credits on-chain at least once. Free and referral credits don't count. */
export async function hasBoughtCredits(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.userId, userId), eq(ledgerEntries.kind, "deposit"), eq(ledgerEntries.refType, "onchain")))
    .limit(1);
  return Boolean(row);
}

export function deployRule(plan: DeployFeePlan, needWei: bigint, buyer: boolean, now: Date): GrantRule {
  const day = now.toISOString().slice(0, 10);
  return {
    reason: "deploy",
    targetWei: needWei,
    planKey: `${plan.projectId}:${plan.chainId}:${plan.sourceHash}:${day}`,
    dayLimit: buyer ? DEPLOY_GRANTS_PER_DAY_BUYER : DEPLOY_GRANTS_PER_DAY,
    scope: "person",
    dayBudgetWei: DEPLOY_DAY_BUDGET_WEI,
  };
}

export async function deployGrantsEnabled(db: Db): Promise<boolean> {
  return (await grantsEnabled(db)) && (await grantsEnabled(db, GAS_DEPLOY_GRANTS_KEY));
}

export type SponsorResult = "enough" | "granted" | "skipped";

/**
 * Cover the network fee of this plan, if the person qualifies. Returns what happened; never throws, because
 * a failed grant must not stop someone deploying. `skipped` covers every refusal, which is logged.
 */
export async function sponsorDeployFee(
  db: Db,
  user: { id: string; wallet: string },
  plan: DeployFeePlan,
  deps: GrantDeps,
  now = new Date(),
): Promise<SponsorResult> {
  try {
    if (plan.chainId !== 42220) return "skipped"; // mainnet only; Celo Sepolia has its faucet
    if (plan.steps.every((s) => plan.alreadyDeployed[s.name])) return "skipped"; // nothing left to send
    if (!deps.signer || !(await deployGrantsEnabled(db))) return "skipped";
    const { maxFeePerGas } = await deps.chain.fees();
    const need = estimateDeployFeeWei(plan, maxFeePerGas);
    if (need > DEPLOY_MAX_WEI) {
      console.warn(`[gas-grant] deploy fee estimate ${need} is above the ceiling; not covered`);
      return "skipped";
    }
    const rule = deployRule(plan, need, await hasBoughtCredits(db, user.id), now);
    const outcome = await ensureGas(db, { id: user.id, wallet: user.wallet as Address }, need, "deploy", { ...deps, now: () => now, waitMs: deps.waitMs ?? 20_000 }, rule);
    return outcome.kind === "enough" ? "enough" : "granted";
  } catch (error) {
    // Expected refusals (limit, empty, not verified, already used today) carry plain-words messages.
    console.warn("[gas-grant] deploy fee not covered:", (error as Error).message);
    return "skipped";
  }
}
