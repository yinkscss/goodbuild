import "server-only";

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Address } from "viem";

import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import { postLedgerEntry } from "@/server/credits/ledger";
import type { Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { closeOf, eventOfId } from "@/lib/hackathon-events";
import { hackathonParticipants, hackathonRefusals, hackathonRegistrations, type HackathonRegistration } from "@/server/db/hackathon-schema";
import { users } from "@/server/db/schema";
import { CLAIMS_CLOSE, HACKATHON_ID } from "./ids";
import { recordReferral, referralHeld, settleReferral } from "./referrals";

/**
 * Hackathon credits (D99). Every grant is keyed to a GoodDollar identity root that is read from the
 * chain at claim time, so one human gets one grant however many wallets or accounts they hold.
 * Paid in two parts: START_CREDITS on registering, DEPLOY_CREDITS after the first Celo deploy made
 * after registering. Both are ledger `adjust` entries with root-based idempotency keys.
 */
export { HACKATHON_ID };
export const START_CREDITS = 20;
export const DEPLOY_CREDITS = 30;
/**
 * Default cap on everything granted: 200 builders x 50 credits, raised from 5,000 for the FUTMinna
 * hackathon, which shares this budget (D160). HACKATHON_BUDGET_CREDITS overrides.
 */
export const DEFAULT_BUDGET_CREDITS = 10_000;
export { CLAIMS_CLOSE };
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
  /** Present and true only while a referral bonus is held for the referral pot (D136). */
  referralPending?: boolean;
}

export interface ClaimDeps {
  /** The wallet's GoodDollar root, read fresh from the Identity contract, or null. */
  readRoot: (wallet: Address) => Promise<Address | null>;
  /** An invite code from the link this person came in by (D136). Anything unusable is ignored. */
  ref?: unknown;
  now?: Date;
  env?: Record<string, string | undefined>;
}

/**
 * When this person's hackathon credits stop: the latest close among the hackathons they signed up for,
 * and never before the main one (D166). A Kadpoly member can claim, and keeps their grant, until
 * Kadpoly closes; everyone else stops at the main close.
 */
export async function claimCloseFor(db: Db, userId: string): Promise<Date> {
  const rows = await db
    .select({ hackathon: hackathonParticipants.hackathon })
    .from(hackathonParticipants)
    .where(eq(hackathonParticipants.userId, userId));
  let latest = CLAIMS_CLOSE;
  for (const { hackathon } of rows) {
    const event = eventOfId(hackathon);
    if (event && closeOf(event) > latest) latest = closeOf(event);
  }
  return latest;
}

const toCredits = (micro: number) => Math.round(micro / MICRO_PER_CREDIT);

/** The total cap in credits: HACKATHON_BUDGET_CREDITS when it's a whole number, else the default. */
export function budgetCredits(env: Record<string, string | undefined>): number {
  const raw = env.HACKATHON_BUDGET_CREDITS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : DEFAULT_BUDGET_CREDITS;
}

const budgetMicro = (env: Record<string, string | undefined>) => budgetCredits(env) * MICRO_PER_CREDIT;

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
  const status = statusOf(row);
  return (await referralHeld(db, userId)) ? { ...status, referralPending: true } : status;
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
  if (now >= CLAIMS_CLOSE && now >= (await claimCloseFor(db, user.id)))
    throw new HackathonError("closed", "Submissions have closed, so hackathon credits can no longer be claimed.");

  // The chain decides, never a stored flag or GoodDollar's redirect. Read outside the transaction.
  const rootAddress = await deps.readRoot(user.wallet as Address);
  if (!rootAddress) throw new HackathonError("not_verified", "This wallet isn't verified with GoodDollar yet. Verify, then try again.");
  const root = rootAddress.toLowerCase();

  try {
    return await grantInLock(db, user, root, now, env, deps.ref);
  } catch (error) {
    // Kept for the admin page. Written after the rollback, so it survives it.
    if (error instanceof HackathonError && (error.code === "claimed_elsewhere" || error.code === "budget_spent")) {
      await db
        .insert(hackathonRefusals)
        .values({ hackathon: HACKATHON_ID, userId: user.id, goodidRoot: root, wallet: user.wallet.toLowerCase(), code: error.code, createdAt: now })
        .catch((e) => console.error("hackathon refusal not logged", e));
    }
    throw error;
  }
}

function grantInLock(db: Db, user: { id: string; wallet: string }, root: string, now: Date, env: Record<string, string | undefined>, ref: unknown): Promise<HackathonStatus> {
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
    // An expired grant is final: joining a hackathon that closes later (D166) doesn't reopen it.
    if (row?.expiredAt) throw new HackathonError("closed", "Submissions have closed, so hackathon credits can no longer be claimed.");

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
      // Only the call that creates the registration can note a referral (D136).
      await recordReferral(tx, { code: ref, refereeUserId: user.id, refereeRoot: root, now });
    }

    // A deploy made after registering, read from the server's own records. Pays the deploy credits and any referral.
    const [deployed] = await tx
      .select({ id: deployments.id })
      .from(deployments)
      .where(and(eq(deployments.userId, user.id), inArray(deployments.chainId, DEPLOY_CHAINS), gte(deployments.createdAt, row.createdAt)))
      .limit(1);

    if (!row.deployEntryId) {
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

    await settleReferral(tx, { userId: user.id, deployed: Boolean(deployed), now, env });

    const status = statusOf(row);
    return (await referralHeld(tx, user.id)) ? { ...status, referralPending: true } : status;
  });
}
