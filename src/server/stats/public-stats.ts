import "server-only";

import { and, count, countDistinct, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";

import { CELO_MAINNET_ID } from "@/config/gooddollar";
import type { Db } from "@/server/db/client";
import { contractUpgrades, deployments } from "@/server/db/deploy-schema";
import { onchainCreditEvents } from "@/server/db/onchain-credits-schema";
import { publications } from "@/server/db/publish-schema";
import { projects, turnJobs, users } from "@/server/db/schema";

/**
 * The public numbers behind /stats and /stats.json (D90). Counts only: no wallets, emails, user ids or
 * money amounts (owner's call, 11 Nov 2026). On-chain figures are Celo mainnet only, so every one of
 * them can be checked on Celoscan from the addresses and transaction hashes listed here.
 */
export interface PublicStats {
  generatedAt: string;
  /** `signedIn*` comes from `users.last_seen_at`, which only moves at sign-in. */
  users: { total: number; newLast7Days: number; newLast30Days: number; signedInLast7Days: number; signedInLast30Days: number; goodIdVerified: number };
  /** Sign-ups per week, oldest first, always `SIGNUP_WEEKS` long (weeks start Monday, UTC). */
  signupsByWeek: Array<{ weekStart: string; signups: number }>;
  /** Finished build turns (planning turns are left out). */
  builds: { projects: number; buildsFinished: number };
  apps: { live: number };
  mainnet: {
    chainId: number;
    contracts: number;
    contractsSourceChecked: number;
    transactions: { total: number; deploys: number; upgrades: number; creditPurchases: number };
  };
  /** Newest first. Every mainnet contract, capped at `CONTRACT_LIST_LIMIT`. */
  contracts: Array<{ name: string; address: string; txHash: string; sourceChecked: boolean; deployedAt: string }>;
  /** Newest first. Live apps only (no unpublished apps, no takedowns). */
  liveApps: Array<{ name: string; slug: string; publishedAt: string }>;
}

export const SIGNUP_WEEKS = 12;
export const CONTRACT_LIST_LIMIT = 1000;
export const LIVE_APP_LIST_LIMIT = 200;

const DAY = 86_400_000;

/** Monday 00:00 UTC of the week holding `d`. */
export function weekStartUtc(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

const n = (rows: Array<{ n: number | string | null }>) => Number(rows[0]?.n ?? 0);

export async function loadPublicStats(db: Db, now = new Date()): Promise<PublicStats> {
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const firstWeek = new Date(weekStartUtc(now).getTime() - (SIGNUP_WEEKS - 1) * 7 * DAY);
  const live = and(isNull(publications.unpublishedAt), isNull(publications.disabledAt));
  const mainnetDeploys = eq(deployments.chainId, CELO_MAINNET_ID);

  const [
    usersTotal,
    new7,
    new30,
    active7,
    active30,
    verified,
    signupRows,
    projectCount,
    buildsDone,
    liveCount,
    contractCount,
    checkedCount,
    deployTxs,
    upgradeRows,
    creditTxs,
    contractRows,
    appRows,
  ] = await Promise.all([
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(users).where(gte(users.createdAt, since7)),
    db.select({ n: count() }).from(users).where(gte(users.createdAt, since30)),
    db.select({ n: count() }).from(users).where(gte(users.lastSeenAt, since7)),
    db.select({ n: count() }).from(users).where(gte(users.lastSeenAt, since30)),
    db.select({ n: count() }).from(users).where(isNotNull(users.verifiedAt)),
    db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(gte(users.createdAt, firstWeek)),
    db.select({ n: count() }).from(projects),
    db.select({ n: count() }).from(turnJobs).where(and(eq(turnJobs.status, "done"), eq(turnJobs.mode, "build"))),
    db.select({ n: count() }).from(publications).where(live),
    db.select({ n: countDistinct(sql`lower(${deployments.address})`) }).from(deployments).where(mainnetDeploys),
    db
      .select({ n: countDistinct(sql`lower(${deployments.address})`) })
      .from(deployments)
      .where(and(mainnetDeploys, eq(deployments.verifyStatus, "verified"))),
    // A contract behind a proxy took two transactions to deploy: its code, then the proxy (D33).
    db
      .select({ n: sql<number>`count(distinct lower(${deployments.txHash})) + count(${deployments.proxy})` })
      .from(deployments)
      .where(mainnetDeploys),
    // Each upgrade is two transactions: the new code, then the switch. Both hashes are stored.
    db.select({ n: count() }).from(contractUpgrades).where(eq(contractUpgrades.chainId, CELO_MAINNET_ID)),
    db.select({ n: countDistinct(sql`lower(${onchainCreditEvents.txHash})`) }).from(onchainCreditEvents).where(eq(onchainCreditEvents.chainId, CELO_MAINNET_ID)),
    db
      .select({
        name: deployments.contractName,
        address: deployments.address,
        txHash: deployments.txHash,
        verifyStatus: deployments.verifyStatus,
        createdAt: deployments.createdAt,
      })
      .from(deployments)
      .where(mainnetDeploys)
      .orderBy(desc(deployments.createdAt), desc(deployments.id))
      .limit(CONTRACT_LIST_LIMIT),
    db
      .select({ name: projects.name, slug: publications.slug, publishedAt: publications.publishedAt })
      .from(publications)
      .innerJoin(projects, eq(publications.projectId, projects.id))
      .where(live)
      .orderBy(desc(publications.publishedAt), desc(publications.id))
      .limit(LIVE_APP_LIST_LIMIT),
  ]);

  const buckets = new Map<number, number>();
  for (let i = 0; i < SIGNUP_WEEKS; i++) buckets.set(firstWeek.getTime() + i * 7 * DAY, 0);
  for (const r of signupRows) {
    const key = weekStartUtc(new Date(r.createdAt)).getTime();
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const deploys = n(deployTxs);
  const upgrades = n(upgradeRows) * 2;
  const creditPurchases = n(creditTxs);

  // (chain, address) is unique in `deployments`, so each row is one contract.
  const contracts = contractRows.map((c) => ({
      name: c.name,
      address: c.address,
      txHash: c.txHash,
      sourceChecked: c.verifyStatus === "verified",
      deployedAt: new Date(c.createdAt).toISOString(),
    }));

  return {
    generatedAt: now.toISOString(),
    users: {
      total: n(usersTotal),
      newLast7Days: n(new7),
      newLast30Days: n(new30),
      signedInLast7Days: n(active7),
      signedInLast30Days: n(active30),
      goodIdVerified: n(verified),
    },
    signupsByWeek: [...buckets].map(([t, signups]) => ({ weekStart: new Date(t).toISOString().slice(0, 10), signups })),
    builds: { projects: n(projectCount), buildsFinished: n(buildsDone) },
    apps: { live: n(liveCount) },
    mainnet: {
      chainId: CELO_MAINNET_ID,
      contracts: n(contractCount),
      contractsSourceChecked: n(checkedCount),
      transactions: { total: deploys + upgrades + creditPurchases, deploys, upgrades, creditPurchases },
    },
    contracts,
    liveApps: appRows.map((a) => ({ name: a.name, slug: a.slug, publishedAt: new Date(a.publishedAt).toISOString() })),
  };
}
