import "server-only";

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Address } from "viem";

import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import { postLedgerEntry } from "@/server/credits/ledger";
import type { Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { hackathonRegistrations, type HackathonRegistration } from "@/server/db/hackathon-schema";
import { users } from "@/server/db/schema";

/**
 * Hackathon credits (D99). Every grant is keyed to a GoodDollar identity root that is read from the
 * chain at claim time, so one human gets one grant however many wallets or accounts they hold.
 * Paid in two parts: START_CREDITS on registering, DEPLOY_CREDITS after the first Celo deploy made
 * after registering. Both are ledger `adjust` entries with root-based idempotency keys.
 */
export const HACKATHON_ID = "million-2027";
export const START_CREDITS = 20;
export const DEPLOY_CREDITS = 30;
/** Default cap on everything granted: 100 builders x 50 credits. HACKATHON_BUDGET_CREDITS overrides. */
export const DEFAULT_BUDGET_CREDITS = 5_000;
/** Claims stop when submissions close (DRAFT date, matches content.ts). */
export const CLAIMS_CLOSE = new Date("2027-02-08T23:00:00Z");
/** Celo mainnet and Celo Sepolia. */
export const DEPLOY_CHAINS = [42220, 11142220];

export type HackathonErrorCode = "not_verified" | "claimed_elsewhere" | "budget_spent" | "closed" | "off";

export class HackathonError extends Error {
  constructor(
    readonly code: HackathonErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface HackathonStatus {
  registered: boolean;
  startCredits: number;
  deployCredits: number;
  /** True when the deploy part is still to come. */
  deployPending: boolean;
}

export interface ClaimDeps {
  /** The wallet's GoodDollar root, read fresh from the Identity contract, or null. */
  readRoot: (wallet: Address) => Promise<Address | null>;
  now?: Date;
  env?: Record<string, string | undefined>;
}

const toCredits = (micro: number) => Math.round(micro / MICRO_PER_CREDIT);

function budgetMicro(env: Record<string, string | undefined>): number {
  const n = Number(env.HACKATHON_BUDGET_CREDITS);
  return (Number.isSafeInteger(n) && n >= 0 ? n : DEFAULT_BUDGET_CREDITS) * MICRO_PER_CREDIT;
}

function statusOf(row: HackathonRegistration | undefined): HackathonStatus {
  if (!row) return { registered: false, startCredits: 0, deployCredits: 0, deployPending: false };
  return { registered: true, startCredits: toCredits(row.startMicro), deployCredits: toCredits(row.deployMicro), deployPending: !row.deployEntryId };
}

export async function hackathonStatus(db: Db, userId: string): Promise<HackathonStatus> {
  const [row] = await db
    .select()
    .from(hackathonRegistrations)
    .where(and(eq(hackathonRegistrations.hackathon, HACKATHON_ID), eq(hackathonRegistrations.userId, userId)))
    .limit(1);
  return statusOf(row);
}

/**
 * Register and collect whatever is due. Safe to call any number of times: each part is posted once
 * per root. Everything runs in one transaction under a hackathon-wide lock, so the budget check
 * and the grants can't race.
 */
export async function claimHackathon(db: Db, user: { id: string; wallet: string }, deps: ClaimDeps): Promise<HackathonStatus> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  if (env.HACKATHON_CLAIMS === "off") throw new HackathonError("off", "Hackathon credits are paused right now. Try again later.");
  if (now >= CLAIMS_CLOSE) throw new HackathonError("closed", "Submissions have closed, so hackathon credits can no longer be claimed.");

  // The chain decides, never a stored flag or GoodDollar's redirect. Read outside the transaction.
  const rootAddress = await deps.readRoot(user.wallet as Address);
  if (!rootAddress) throw new HackathonError("not_verified", "This wallet isn't verified with GoodDollar yet. Verify, then try again.");
  const root = rootAddress.toLowerCase();

  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`hackathon:${HACKATHON_ID}`}))`);

    // Keep the account's verification in step with what the chain just said (D30 counts by root).
    await tx.update(users).set({ goodidRoot: root, verifiedAt: sql`coalesce(${users.verifiedAt}, now())` }).where(eq(users.id, user.id));

    let [row] = await tx
      .select()
      .from(hackathonRegistrations)
      .where(and(eq(hackathonRegistrations.hackathon, HACKATHON_ID), eq(hackathonRegistrations.goodidRoot, root)))
      .limit(1);
    if (row && row.userId !== user.id) {
      throw new HackathonError("claimed_elsewhere", "This GoodDollar identity already registered from another GoodBuild account. Sign in with that account to build.");
    }

    const [spent] = await tx
      .select({ micro: sql<string>`coalesce(sum(${hackathonRegistrations.startMicro} + ${hackathonRegistrations.deployMicro}), 0)` })
      .from(hackathonRegistrations)
      .where(eq(hackathonRegistrations.hackathon, HACKATHON_ID));
    let left = budgetMicro(env) - Number(spent.micro);

    if (!row) {
      const amount = START_CREDITS * MICRO_PER_CREDIT;
      if (left < amount) throw new HackathonError("budget_spent", "All hackathon credits have been handed out. You can still enter and top up as usual.");
      const [mine] = await tx
        .select({ id: hackathonRegistrations.id })
        .from(hackathonRegistrations)
        .where(and(eq(hackathonRegistrations.hackathon, HACKATHON_ID), eq(hackathonRegistrations.userId, user.id)))
        .limit(1);
      // A wallet can only have one root, but an account's wallet can't change, so this means the
      // root moved (GoodDollar re-linking). Keep the first registration.
      if (mine) throw new HackathonError("claimed_elsewhere", "This account already registered under another GoodDollar identity.");
      const posted = await postLedgerEntry(tx, {
        userId: user.id,
        kind: "adjust",
        amountMicro: amount,
        idempotencyKey: `hackathon:${HACKATHON_ID}:start:${root}`,
        refType: "hackathon",
        refId: `${HACKATHON_ID}:start`,
      });
      [row] = await tx
        .insert(hackathonRegistrations)
        .values({ hackathon: HACKATHON_ID, userId: user.id, goodidRoot: root, wallet: user.wallet.toLowerCase(), createdAt: now, startEntryId: posted.entry.id, startMicro: amount })
        .returning();
      left -= amount;
    }

    if (!row.deployEntryId) {
      const [deployed] = await tx
        .select({ id: deployments.id })
        .from(deployments)
        .where(and(eq(deployments.userId, user.id), inArray(deployments.chainId, DEPLOY_CHAINS), gte(deployments.createdAt, row.createdAt)))
        .limit(1);
      const amount = DEPLOY_CREDITS * MICRO_PER_CREDIT;
      // Out of budget for the second part: the registration stands, the part just isn't paid.
      if (deployed && left >= amount) {
        const posted = await postLedgerEntry(tx, {
          userId: user.id,
          kind: "adjust",
          amountMicro: amount,
          idempotencyKey: `hackathon:${HACKATHON_ID}:deploy:${root}`,
          refType: "hackathon",
          refId: `${HACKATHON_ID}:deploy`,
        });
        [row] = await tx
          .update(hackathonRegistrations)
          .set({ deployEntryId: posted.entry.id, deployMicro: amount, deployGrantedAt: now })
          .where(eq(hackathonRegistrations.id, row.id))
          .returning();
      }
    }

    return statusOf(row);
  });
}
