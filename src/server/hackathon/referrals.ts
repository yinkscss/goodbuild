import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import {
  DEFAULT_REFERRAL_BUDGET_CREDITS,
  MAX_PAID_REFERRALS,
  REFERRAL_ALPHABET,
  REFERRAL_BONUS_CREDITS,
  cleanReferralCode,
} from "@/lib/hackathon-referral";
import { postLedgerEntry } from "@/server/credits/ledger";
import type { Db } from "@/server/db/client";
import { hackathonReferrals, hackathonRegistrations } from "@/server/db/hackathon-schema";
import { CLAIMS_CLOSE, HACKATHON_ID } from "./ids";

type Env = Record<string, string | undefined>;

/** Referral credit cap in credits: HACKATHON_REFERRAL_BUDGET_CREDITS when it's a whole number, else the default. */
export function referralBudgetCredits(env: Env): number {
  const raw = env.HACKATHON_REFERRAL_BUDGET_CREDITS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : DEFAULT_REFERRAL_BUDGET_CREDITS;
}

export function newReferralCode(): string {
  return Array.from({ length: 8 }, () => REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)]).join("");
}

/** The builder's invite code, made on first ask. Null if they haven't registered for the hackathon. */
export async function ensureReferralCode(db: Db, userId: string): Promise<string | null> {
  const where = and(eq(hackathonRegistrations.hackathon, HACKATHON_ID), eq(hackathonRegistrations.userId, userId));
  const [row] = await db.select({ code: hackathonRegistrations.referralCode }).from(hackathonRegistrations).where(where).limit(1);
  if (!row) return null;
  if (row.code) return row.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newReferralCode();
    try {
      const [set] = await db
        .update(hackathonRegistrations)
        .set({ referralCode: code })
        .where(and(where, isNull(hackathonRegistrations.referralCode)))
        .returning({ code: hackathonRegistrations.referralCode });
      if (set?.code) return set.code;
      const [again] = await db.select({ code: hackathonRegistrations.referralCode }).from(hackathonRegistrations).where(where).limit(1);
      return again?.code ?? null;
    } catch {
      // A code collision on the unique index: try another.
    }
  }
  return null;
}

/**
 * Note that this new registrant came from someone's link. Called inside the claim transaction and
 * only in the call that creates the registration, so an already-registered account gets nothing.
 * A missing, malformed, unknown or self-referencing code is ignored: registration goes on as normal.
 */
export async function recordReferral(
  tx: Db,
  input: { code: unknown; refereeUserId: string; refereeRoot: string; now: Date },
): Promise<void> {
  const code = cleanReferralCode(input.code);
  if (!code) return;
  const [referrer] = await tx
    .select({ userId: hackathonRegistrations.userId, root: hackathonRegistrations.goodidRoot })
    .from(hackathonRegistrations)
    .where(and(eq(hackathonRegistrations.hackathon, HACKATHON_ID), eq(hackathonRegistrations.referralCode, code)))
    .limit(1);
  if (!referrer || referrer.userId === input.refereeUserId || referrer.root === input.refereeRoot) return;
  await tx
    .insert(hackathonReferrals)
    .values({
      hackathon: HACKATHON_ID,
      referrerUserId: referrer.userId,
      refereeUserId: input.refereeUserId,
      refereeRoot: input.refereeRoot,
      createdAt: input.now,
    })
    .onConflictDoNothing();
}

/**
 * Pay a pending referral once the invited builder has made a Celo deploy (`deployed`, checked by the
 * caller against the server-read deployments). The invited builder always gets the bonus; the inviter
 * gets it up to MAX_PAID_REFERRALS. If the referral pot can't cover it, the referral stays pending
 * and a later claim pays it. Idempotent: ledger keys are per invited identity.
 */
export async function settleReferral(tx: Db, input: { userId: string; deployed: boolean; now: Date; env: Env }): Promise<void> {
  if (!input.deployed) return;
  const [ref] = await tx
    .select()
    .from(hackathonReferrals)
    .where(and(eq(hackathonReferrals.hackathon, HACKATHON_ID), eq(hackathonReferrals.refereeUserId, input.userId), isNull(hackathonReferrals.settledAt)))
    .limit(1);
  if (!ref) return;
  const bonus = REFERRAL_BONUS_CREDITS * MICRO_PER_CREDIT;
  const [earned] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(hackathonReferrals)
    .where(and(eq(hackathonReferrals.hackathon, HACKATHON_ID), eq(hackathonReferrals.referrerUserId, ref.referrerUserId), sql`${hackathonReferrals.referrerMicro} > 0`));
  const referrerGets = earned.n < MAX_PAID_REFERRALS;
  // Pay both sides together or neither, so a short pot never leaves one side unpaid for good.
  const need = referrerGets ? 2 * bonus : bonus;
  const [paid] = await tx
    .select({ micro: sql<string>`coalesce(sum(${hackathonReferrals.refereeMicro} + ${hackathonReferrals.referrerMicro}), 0)` })
    .from(hackathonReferrals)
    .where(eq(hackathonReferrals.hackathon, HACKATHON_ID));
  if (referralBudgetCredits(input.env) * MICRO_PER_CREDIT - Number(paid.micro) < need) return;

  const post = (userId: string, role: "referee" | "referrer") =>
    postLedgerEntry(tx, {
      userId,
      kind: "adjust",
      amountMicro: bonus,
      idempotencyKey: `hackathon:${HACKATHON_ID}:referral:${role}:${ref.refereeRoot}`,
      refType: "hackathon",
      refId: `${HACKATHON_ID}:referral`,
    });
  const refereeEntry = await post(ref.refereeUserId, "referee");
  const referrerEntry = referrerGets ? await post(ref.referrerUserId, "referrer") : null;
  await tx
    .update(hackathonReferrals)
    .set({
      settledAt: input.now,
      refereeEntryId: refereeEntry.entry.id,
      refereeMicro: bonus,
      referrerEntryId: referrerEntry?.entry.id ?? null,
      referrerMicro: referrerEntry ? bonus : 0,
    })
    .where(eq(hackathonReferrals.id, ref.id));
}

/** True when this builder deployed but a referral bonus is still held (the referral pot was short). */
export async function referralHeld(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: hackathonReferrals.id })
    .from(hackathonReferrals)
    .innerJoin(hackathonRegistrations, and(eq(hackathonRegistrations.hackathon, hackathonReferrals.hackathon), eq(hackathonRegistrations.userId, hackathonReferrals.refereeUserId)))
    .where(and(eq(hackathonReferrals.hackathon, HACKATHON_ID), eq(hackathonReferrals.refereeUserId, userId), isNull(hackathonReferrals.settledAt), sql`${hackathonRegistrations.deployEntryId} is not null`))
    .limit(1);
  return Boolean(row);
}

export interface ReferralSummary {
  code: string;
  bonus: number;
  max: number;
  invited: number;
  /** Invited builders who deployed and paid you the bonus. */
  earned: number;
  /** Invited builders whose bonus isn't paid yet (still to deploy, or held for the pot). */
  waiting: number;
}

/** The builder's code and how their invites are doing. Null if they haven't registered or the hackathon has closed. */
export async function referralSummary(db: Db, userId: string, now = new Date()): Promise<ReferralSummary | null> {
  if (now >= CLAIMS_CLOSE) return null; // nothing pays after the close
  const code = await ensureReferralCode(db, userId);
  if (!code) return null;
  const [t] = await db
    .select({
      invited: sql<number>`count(*)::int`,
      earned: sql<number>`count(*) filter (where ${hackathonReferrals.referrerMicro} > 0)::int`,
      waiting: sql<number>`count(*) filter (where ${hackathonReferrals.settledAt} is null)::int`,
    })
    .from(hackathonReferrals)
    .where(and(eq(hackathonReferrals.hackathon, HACKATHON_ID), eq(hackathonReferrals.referrerUserId, userId)));
  return { code, bonus: REFERRAL_BONUS_CREDITS, max: MAX_PAID_REFERRALS, invited: t.invited, earned: t.earned, waiting: t.waiting };
}
