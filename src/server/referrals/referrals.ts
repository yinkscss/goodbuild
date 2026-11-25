import "server-only";
import { randomInt } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import { MAX_PAID_REFERRALS, REFERRAL_ALPHABET, REFERRAL_BONUS_CREDITS, cleanReferralCode } from "@/lib/referral";
import { postLedgerEntry } from "@/server/credits/ledger";
import type { Db } from "@/server/db/client";
import { flowstateVoters, hackathonReferrals } from "@/server/db/hackathon-schema";
import { referrals } from "@/server/db/referral-schema";
import { users } from "@/server/db/schema";
import { referralBudgetCredits } from "@/server/hackathon/referrals";

type Env = Record<string, string | undefined>;

function newCode(): string {
  return Array.from({ length: 8 }, () => REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)]).join("");
}

/** The person's invite code, made on first ask. Random, never derived from the wallet or the user id. */
export async function ensureInviteCode(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ code: users.referralCode, root: users.goodidRoot }).from(users).where(eq(users.id, userId)).limit(1);
  // Verified people only, so a spare unverified account can't be used to invite yourself.
  if (!row || !row.root) return null;
  if (row.code) return row.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [set] = await db
        .update(users)
        .set({ referralCode: newCode() })
        .where(and(eq(users.id, userId), isNull(users.referralCode)))
        .returning({ code: users.referralCode });
      if (set?.code) return set.code;
      const [again] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId)).limit(1);
      return again?.code ?? null;
    } catch {
      // A collision on the unique code: try another.
    }
  }
  return null;
}

/**
 * Note that this signed-in person came from a friend's link. Quietly does nothing for a bad or unknown
 * code, your own code, someone who already has an inviter, or someone who has already voted for us
 * (they're not new). Never throws for those: the page carries on as normal.
 */
export async function attributeInvite(db: Db, input: { code: unknown; refereeUserId: string }): Promise<{ recorded: boolean }> {
  const code = cleanReferralCode(input.code);
  if (!code) return { recorded: false };
  const [referrer] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code)).limit(1);
  if (!referrer || referrer.id === input.refereeUserId) return { recorded: false };
  // Already invited through the hackathon link (D136): that bonus is theirs, not this one as well.
  const [old] = await db.select({ id: hackathonReferrals.id }).from(hackathonReferrals).where(eq(hackathonReferrals.refereeUserId, input.refereeUserId)).limit(1);
  if (old) return { recorded: false };
  const [voted] = await db
    .select({ at: flowstateVoters.votedAt })
    .from(flowstateVoters)
    .where(and(eq(flowstateVoters.userId, input.refereeUserId), isNotNull(flowstateVoters.votedAt)))
    .limit(1);
  if (voted) return { recorded: false };
  const rows = await db
    .insert(referrals)
    .values({ referrerUserId: referrer.id, refereeUserId: input.refereeUserId })
    .onConflictDoNothing()
    .returning({ id: referrals.id });
  return { recorded: rows.length > 0 };
}

/**
 * The invited person's vote has just been confirmed on-chain, and `root` is their GoodDollar identity
 * as the chain reads it now. Pay the bonus to the invited person and their inviter, once per identity,
 * and only when the inviter is verified under a different identity. The invited person is always paid
 * once that holds; the inviter for up to MAX_PAID_REFERRALS friends. Both are paid together or neither,
 * so a short pot leaves it waiting. Safe to call any number of times: ledger keys are per invited identity.
 */
export async function settleInviteOnVote(db: Db, input: { userId: string; root: string; env: Env; now?: Date }): Promise<{ paidMicro: number }> {
  const now = input.now ?? new Date();
  const root = input.root.toLowerCase();
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('referral-bonus'))`);
    const [ref] = await tx.select().from(referrals).where(eq(referrals.refereeUserId, input.userId)).limit(1);
    if (!ref || ref.settledAt) return { paidMicro: 0 };
    // The same GoodDollar identity behind another account was already invited: this one gets nothing.
    const [dupe] = await tx.select({ id: referrals.id }).from(referrals).where(eq(referrals.refereeRoot, root)).limit(1);
    if (dupe && dupe.id !== ref.id) return { paidMicro: 0 };
    const [old] = await tx.select({ id: hackathonReferrals.id }).from(hackathonReferrals).where(eq(hackathonReferrals.refereeRoot, root)).limit(1);
    if (old) return { paidMicro: 0 };
    await tx.update(referrals).set({ refereeRoot: root, verifiedAt: ref.verifiedAt ?? now, votedAt: ref.votedAt ?? now }).where(eq(referrals.id, ref.id));

    const [referrer] = await tx.select({ root: users.goodidRoot }).from(users).where(eq(users.id, ref.referrerUserId)).limit(1);
    const [earned] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(referrals)
      .where(and(eq(referrals.referrerUserId, ref.referrerUserId), sql`${referrals.referrerMicro} > 0`));
    // Nobody is paid unless the inviter is a verified, different person: otherwise a spare account's code
    // would hand its owner credits for "inviting" themselves.
    if (!referrer?.root || referrer.root.toLowerCase() === root) return { paidMicro: 0 };
    const referrerGets = earned.n < MAX_PAID_REFERRALS;
    const bonus = REFERRAL_BONUS_CREDITS * MICRO_PER_CREDIT;
    const need = referrerGets ? 2 * bonus : bonus;
    if (referralBudgetCredits(input.env) * MICRO_PER_CREDIT - (await paidMicro(tx)) < need) return { paidMicro: 0 };

    const post = (userId: string, role: "referee" | "referrer") =>
      postLedgerEntry(tx, { userId, kind: "adjust", amountMicro: bonus, idempotencyKey: `referral:${role}:${root}`, refType: "referral", refId: root });
    const refereeEntry = await post(ref.refereeUserId, "referee");
    const referrerEntry = referrerGets ? await post(ref.referrerUserId, "referrer") : null;
    await tx
      .update(referrals)
      .set({
        settledAt: now,
        refereeEntryId: refereeEntry.entry.id,
        refereeMicro: bonus,
        referrerEntryId: referrerEntry?.entry.id ?? null,
        referrerMicro: referrerEntry ? bonus : 0,
      })
      .where(eq(referrals.id, ref.id));
    return { paidMicro: bonus };
  });
}

/** True when this person was invited and the bonus isn't paid yet, so the vote path knows whether to look up their identity. */
export async function hasUnsettledInvite(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: referrals.id }).from(referrals).where(and(eq(referrals.refereeUserId, userId), isNull(referrals.settledAt))).limit(1);
  return Boolean(row);
}

/** Everything paid from the referral pot so far, here and under the hackathon invite (D136), which shares it. */
async function paidMicro(tx: Db): Promise<number> {
  const [a] = await tx.select({ micro: sql<string>`coalesce(sum(${referrals.refereeMicro} + ${referrals.referrerMicro}), 0)` }).from(referrals);
  const [b] = await tx
    .select({ micro: sql<string>`coalesce(sum(${hackathonReferrals.refereeMicro} + ${hackathonReferrals.referrerMicro}), 0)` })
    .from(hackathonReferrals);
  return Number(a.micro) + Number(b.micro);
}

export interface InviteSummary {
  code: string;
  bonus: number;
  max: number;
  /** Friends who signed in through your link. */
  invited: number;
  /** Friends who have verified and voted. */
  voted: number;
  /** Credits this has earned you. */
  earnedCredits: number;
  /** The most recent friends, newest first. Wallet only, never an email. */
  friends: InviteFriend[];
}

export interface InviteFriend {
  wallet: string;
  joinedAt: string;
  verified: boolean;
  voted: boolean;
  /** True once the bonus was paid to the inviter. */
  rewarded: boolean;
}

/** Null until the person is verified with GoodDollar: they get a code only then. */
export async function inviteSummary(db: Db, userId: string): Promise<InviteSummary | null> {
  const code = await ensureInviteCode(db, userId);
  if (!code) return null;
  const [t] = await db
    .select({
      invited: sql<number>`count(*)::int`,
      voted: sql<number>`count(*) filter (where ${referrals.votedAt} is not null)::int`,
      earned: sql<string>`coalesce(sum(${referrals.referrerMicro}), 0)`,
    })
    .from(referrals)
    .where(eq(referrals.referrerUserId, userId));
  const rows = await db
    .select({ wallet: users.wallet, joinedAt: referrals.createdAt, verifiedAt: referrals.verifiedAt, votedAt: referrals.votedAt, settledAt: referrals.settledAt, referrerMicro: referrals.referrerMicro })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.refereeUserId))
    .where(eq(referrals.referrerUserId, userId))
    .orderBy(desc(referrals.createdAt))
    .limit(50);
  const friends: InviteFriend[] = rows.map((r) => ({
    wallet: r.wallet,
    joinedAt: r.joinedAt.toISOString(),
    verified: r.verifiedAt !== null,
    voted: r.votedAt !== null,
    rewarded: r.settledAt !== null && r.referrerMicro > 0,
  }));
  return { code, bonus: REFERRAL_BONUS_CREDITS, max: MAX_PAID_REFERRALS, invited: t.invited, voted: t.voted, earnedCredits: Math.round(Number(t.earned) / MICRO_PER_CREDIT), friends };
}
