import "server-only";
import { and, eq, isNull, sql, desc, lt } from "drizzle-orm";
import { decodeEventLog, erc20Abi, isAddress, type Hex } from "viem";
import { GOODDOLLAR_MAINNET } from "@/config/gooddollar";
import { ambassadorEarnings as earnings, ambassadorPayouts as payouts, ambassadorAudit as audit } from "@/server/db/ambassador-schema";
import { readGoodIdentityOnCelo } from "@/server/goodid";
import { confirmExistingFlowstateSupport } from "@/server/flowstate/service";
import type { Address } from "viem";
import { referrals } from "@/server/db/referral-schema";
import { users } from "@/server/db/schema";
import { flowstateVoters } from "@/server/db/hackathon-schema";
import type { Db } from "@/server/db/client";
import { publicClientFor } from "@/server/deploy/service";
import { adminWallets } from "@/server/settings/mainnet-access";

export class AmbassadorError extends Error {}
const launch = () => {
  const raw = process.env.AMBASSADOR_START;
  const date = raw ? new Date(raw) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};
const lock = (tx: Db) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('ambassador-accounting'))`);
const record = (tx: Db, actorId: string, action: string, detail: string, payoutId?: string) => tx.insert(audit).values({ actorId, action, detail, payoutId });

/** Called only after server-side confirmation of live GoodDollar identity and settled FlowState support. */
export async function qualifyAmbassador(db: Db, userId: string, identity: string, voteHash?: string) {
  const start = launch();
  if (!start || start > new Date()) return;
  const root = identity.toLowerCase();
  await db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await lock(tx);
    const [ref] = await tx.select().from(referrals).where(eq(referrals.refereeUserId, userId));
    if (!ref || ref.createdAt < start || ref.referrerUserId === userId) return;
    const [inviter] = await tx.select().from(users).where(eq(users.id, ref.referrerUserId));
    if (!inviter?.goodidRoot || inviter.goodidRoot.toLowerCase() === root) return;
    const [oldIdentity] = await tx.select({ id: users.id }).from(users).where(and(sql`lower(${users.goodidRoot}) = ${root}`, lt(users.verifiedAt, ref.createdAt))).limit(1);
    if (oldIdentity) return;
    const inserted = await tx.insert(earnings).values({ referralId: ref.id, userId: ref.referrerUserId, root, voteHash }).onConflictDoNothing().returning();
    if (inserted.length) await record(tx, userId, "qualified", JSON.stringify({ earningId: inserted[0].id, referralId: ref.id, amountG: 5000 }));
  });
}

export async function requestPayout(db: Db, userId: string) {
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await lock(tx);
    const [open] = await tx.select().from(payouts).where(and(eq(payouts.userId, userId), sql`${payouts.status} in ('requested','processing')`));
    if (open) throw new AmbassadorError("You already have a payout request in progress.");
    const available = await tx.select().from(earnings).where(and(eq(earnings.userId, userId), isNull(earnings.payoutId)));
    const amountG = available.reduce((n, e) => n + e.amountG, 0);
    if (amountG < 25000) throw new AmbassadorError("You need at least five qualified referrals (25,000 G$) to request payment.");
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    const [request] = await tx.insert(payouts).values({ userId, wallet: user.wallet.toLowerCase(), amountG }).returning();
    await tx.update(earnings).set({ payoutId: request.id }).where(and(eq(earnings.userId, userId), isNull(earnings.payoutId)));
    await record(tx, userId, "requested", JSON.stringify({ amountG, wallet: request.wallet }), request.id);
    return request;
  });
}

export async function changePayout(db: Db, actorId: string, id: string, action: "process" | "reject" | "reconcile", reason?: string) {
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await lock(tx);
    const [p] = await tx.select().from(payouts).where(eq(payouts.id, id));
    if (!p) throw new AmbassadorError("Payout request not found.");
    const expected = action === "reconcile" ? "processing" : "requested";
    if (p.status !== expected) throw new AmbassadorError(`This request is ${p.status}. Refresh before taking action.`);
    if (action !== "process" && !reason?.trim()) throw new AmbassadorError("A reason is required.");
    const status = action === "process" ? "processing" : action === "reject" ? "rejected" : "requested";
    await tx.update(payouts).set({ status, reason: reason?.trim() ?? null }).where(eq(payouts.id, id));
    if (action === "reject") await tx.update(earnings).set({ payoutId: null }).where(eq(earnings.payoutId, id));
    await record(tx, actorId, action, reason?.trim() ?? "Payment processing started", id);
  });
}

export async function confirmPayout(db: Db, actorId: string, id: string, hash: Hex) {
  // Serialize confirmation with all state changes, including reconciliation and rejection.
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await lock(tx);
    const [p] = await tx.select().from(payouts).where(eq(payouts.id, id));
    if (!p) throw new AmbassadorError("Payout request not found.");
    if (p.status === "paid" && p.txHash === hash.toLowerCase()) return;
    if (p.status !== "processing") throw new AmbassadorError("Mark this request Processing before recording payment.");
    // The admin wallets are the payout wallets: the admin pays by hand from one of them. AMBASSADOR_PAYOUT_WALLETS is only an optional override.
    const override = (process.env.AMBASSADOR_PAYOUT_WALLETS ?? "").split(",").map(x => x.trim().toLowerCase()).filter(x => isAddress(x));
    const senders = override.length ? override : [...adminWallets()];
    if (!senders.length) throw new AmbassadorError("No admin wallet is set, so payments can't be confirmed.");
    const client = publicClientFor(42220);
    const receipt = await client.getTransactionReceipt({ hash });
    const head = await client.getBlockNumber();
    if (receipt.status !== "success" || head - receipt.blockNumber < BigInt(30)) throw new AmbassadorError("Payment must succeed and have 30 block confirmations.");
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (Number(block.timestamp) < Math.floor(p.createdAt.getTime() / 1000)) throw new AmbassadorError("Payment predates this request.");
    const decimals = await client.readContract({ address: GOODDOLLAR_MAINNET, abi: erc20Abi, functionName: "decimals" });
    const amount = BigInt(p.amountG) * BigInt(10) ** BigInt(decimals);
    const matching = receipt.logs.filter(log => {
      if (log.address.toLowerCase() !== GOODDOLLAR_MAINNET.toLowerCase()) return false;
      try {
        const event = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics });
        return event.args.to.toLowerCase() === p.wallet && senders.some(sender => sender === event.args.from.toLowerCase()) && event.args.value === amount;
      } catch { return false; }
    });
    if (matching.length !== 1) throw new AmbassadorError("Expected one exact G$ transfer from an approved payout wallet to the request wallet.");
    const logIndex = matching[0].logIndex;
    const [used] = await tx.select({ id: payouts.id }).from(payouts).where(and(eq(payouts.txHash, hash.toLowerCase()), eq(payouts.logIndex, logIndex)));
    if (used) throw new AmbassadorError("This transfer is already assigned to a payout.");
    await tx.update(payouts).set({ status: "paid", txHash: hash.toLowerCase(), logIndex, paidAt: new Date() }).where(eq(payouts.id, id));
    await record(tx, actorId, "paid", JSON.stringify({ hash, logIndex, amountG: p.amountG }), id);
  });
}

/** Saved voter rows are a durable retry source when the post-vote hook was interrupted. */
export async function repairAmbassadorEarnings(db: Db, userId: string, page = 0) {
  const start = launch();
  if (!start) return;
  const candidates = await db.select({ userId: referrals.refereeUserId, wallet: users.wallet, hash: flowstateVoters.txHash })
    .from(referrals).innerJoin(users, eq(users.id, referrals.refereeUserId))
    .innerJoin(flowstateVoters, eq(flowstateVoters.userId, users.id))
    .where(and(eq(referrals.referrerUserId, userId), sql`${referrals.createdAt} >= ${start}`, sql`${flowstateVoters.votedAt} is not null`))
    .orderBy(desc(referrals.createdAt)).limit(25).offset(page * 25);
  for (const c of candidates) {
    const [existing] = await db.select({ id: earnings.id }).from(earnings).where(eq(earnings.root, sql`(select lower(goodid_root) from users where id = ${c.userId})`));
    if (existing) continue;
    try {
      await confirmExistingFlowstateSupport(publicClientFor(42220), c.wallet as Address);
      const identity = await readGoodIdentityOnCelo(c.wallet as Address);
      if (identity.root) await qualifyAmbassador(db, c.userId, identity.root, c.hash ?? undefined);
    } catch (error) { console.error("[ambassador] qualification retry deferred", error); }
  }
}

export async function ambassadorDashboard(db: Db, userId: string, page = 0, admin = false) {
  const rows = await db.select({ id: referrals.id, joinedAt: referrals.createdAt, verifiedAt: users.verifiedAt, voteAt: flowstateVoters.votedAt, wallet: users.wallet, earningId: earnings.id, amountG: earnings.amountG, qualifiedAt: earnings.qualifiedAt, voteHash: earnings.voteHash, root: earnings.root })
    .from(referrals).innerJoin(users, eq(users.id, referrals.refereeUserId))
    .leftJoin(flowstateVoters, eq(flowstateVoters.userId, referrals.refereeUserId))
    .leftJoin(earnings, eq(earnings.referralId, referrals.id))
    .where(eq(referrals.referrerUserId, userId)).orderBy(desc(referrals.createdAt)).limit(26).offset(page * 25);
  const amounts = await db.select({ amountG: earnings.amountG, payoutId: earnings.payoutId, status: payouts.status }).from(earnings).leftJoin(payouts, eq(payouts.id, earnings.payoutId)).where(eq(earnings.userId, userId));
  const [counts] = await db.select({ joined: sql<number>`count(*)::int`, verified: sql<number>`count(*) filter (where ${users.verifiedAt} is not null)::int` }).from(referrals).innerJoin(users, eq(users.id, referrals.refereeUserId)).where(eq(referrals.referrerUserId, userId));
  const [user] = await db.select({ wallet: users.wallet }).from(users).where(eq(users.id, userId));
  return { enabled: Boolean(launch()), wallet: user?.wallet, counts: { ...counts, qualified: amounts.length },
    availableG: amounts.filter(x => !x.payoutId).reduce((n,x) => n+x.amountG,0),
    requestedG: amounts.filter(x => x.status === "requested" || x.status === "processing").reduce((n,x) => n+x.amountG,0),
    paidG: amounts.filter(x => x.status === "paid").reduce((n,x) => n+x.amountG,0),
    referrals: rows.slice(0,25).map(x => admin ? x : { id: x.id, joinedAt: x.joinedAt, verifiedAt: x.verifiedAt, voteAt: x.voteAt, amountG: x.amountG, qualifiedAt: x.qualifiedAt }),
    hasMore: rows.length > 25,
    payouts: await db.select().from(payouts).where(eq(payouts.userId, userId)).orderBy(desc(payouts.createdAt)).limit(25).offset(page * 25),
  };
}
export async function adminAmbassadors(db: Db, wallet?: string, page = 0) {
  return db.select({ userId: users.id, wallet: users.wallet, qualified: sql<number>`count(${earnings.id})::int`, earnedG: sql<number>`coalesce(sum(${earnings.amountG}),0)::int` }).from(referrals).innerJoin(users, eq(users.id, referrals.referrerUserId)).leftJoin(earnings, eq(earnings.referralId, referrals.id)).where(wallet ? eq(users.wallet, wallet.toLowerCase()) : undefined).groupBy(users.id).orderBy(users.id).limit(25).offset(page * 25);
}
export async function payoutQueue(db: Db, page = 0) {
  const rows = await db.select().from(payouts).where(sql`${payouts.status} in ('requested','processing')`).orderBy(payouts.createdAt).limit(25).offset(page * 25);
  return rows.map(p => ({ ...p, overdue: Date.now() > p.createdAt.getTime() + 86400000 }));
}
export async function payoutAudit(db: Db, userId: string) {
  return db.select({ action: audit.action, detail: audit.detail, at: audit.createdAt, actorId: audit.actorId, payoutId: audit.payoutId }).from(audit).innerJoin(payouts, eq(payouts.id, audit.payoutId)).where(eq(payouts.userId, userId)).orderBy(desc(audit.createdAt)).limit(100);
}
