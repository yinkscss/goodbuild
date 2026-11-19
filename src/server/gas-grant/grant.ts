import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";
import { formatEther, keccak256, type Address, type Hex, type PublicClient } from "viem";

import type { Db } from "@/server/db/client";
import { gasGrants, type GasGrant } from "@/server/db/gas-grant-schema";
import { appSettings } from "@/server/db/settings-schema";
import { readGoodIdRoot } from "@/server/goodid";

/**
 * Gas grant (D41, amended 18 Nov 2026, see DECISIONS.md D124): the gas wallet tops a GoodDollar-verified
 * person's session wallet up to 0.3 CELO, once per person, at most 50 a day, so they can vote on FlowState.
 * Mainnet deploys have their own, silent top-up (D156, deploy-grant.ts) that signs through the same code.
 * Design and red team: MAINNET_PLAN.md section 7.
 *
 * Rules kept from that design:
 *  - The amount goes to the session wallet only. Nothing here takes an address from a request.
 *  - GoodDollar's Identity contract is read fresh before the row is claimed and again before signing.
 *  - `goodid_root` is unique, so one person gets one grant whatever wallets or tabs they use.
 *  - The daily count and the insert happen under one lock; signing happens under that lock too, so the
 *    gas wallet never signs two transactions with the same nonce.
 *  - The signed transaction is saved BEFORE broadcast. Retrying resends that same transaction.
 *  - The kill switch is read before every new send. Switching off never strands a saved transaction.
 *  - This module imports nothing from credits or Paystack (gas-grant.test.ts checks), so customer money
 *    can't reach gas by code.
 */

export const GRANT_TARGET_WEI = BigInt("300000000000000000"); // 0.3 CELO
export const GRANTS_PER_DAY = 50;
export const GAS_GRANTS_KEY = "gas_grants";
/** The owner hears about it when the wallet can fund fewer than this many more full grants. */
export const LOW_BALANCE_GRANTS = 5;
/** Unmined this long after signing: stop and ask the owner instead of guessing. */
const STUCK_AFTER_MS = 10 * 60_000;
/** Someone else's transfer unmined this long: pause new grants until it lands. */
const STALL_AFTER_MS = 2 * 60_000;
const TRANSFER_GAS = BigInt(21_000);
const CELO_CHAIN_ID = 42220;
/** Lock ids for pg_advisory_xact_lock. Arbitrary, but fixed and unique to this module. */
const LOCK_GRANTS = 4_104_201;

export type GrantReason = "hackathon_vote" | "deploy";

/** What differs between a vote grant and a deploy grant. Everything else (lock, nonce, signing) is shared. */
export interface GrantRule {
  reason: GrantReason;
  /** The balance the wallet is topped up to. */
  targetWei: bigint;
  /** Deploy grants: makes the same plan on the same day a single grant. Null for votes (one per person). */
  planKey: string | null;
  /** The most grants of this reason per UTC day, counted over everyone (votes) or over this person (deploys). */
  dayLimit: number;
  scope: "everyone" | "person";
  /** The most CELO of this reason that may go out per UTC day, over everyone. */
  dayBudgetWei?: bigint;
}

const VOTE_RULE: GrantRule = { reason: "hackathon_vote", targetWei: GRANT_TARGET_WEI, planKey: null, dayLimit: GRANTS_PER_DAY, scope: "everyone" };

export type GrantOutcome =
  | { kind: "enough" }
  | { kind: "granted"; amountWei: bigint; txHash: Hex };

/** Shown to the person as-is, so plain words. `telegram` asks the UI to show the owner's Telegram link. */
export class GasGrantError extends Error {
  constructor(
    message: string,
    readonly code: "off" | "not_verified" | "used" | "daily_limit" | "budget" | "empty" | "too_expensive" | "pending" | "review",
    readonly telegram = true,
  ) {
    super(message);
  }
}

export interface GrantSigner {
  address: Address;
  signTransaction(tx: {
    to: Address;
    value: bigint;
    nonce: number;
    gas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    chainId: number;
    type: "eip1559";
  }): Promise<Hex>;
}

/** The chain reads and writes the grant needs. A thin wrapper over viem, so tests can fake it. */
export interface GrantChain {
  readRoot(wallet: Address): Promise<Address | null>;
  getBalance(address: Address): Promise<bigint>;
  pendingNonce(address: Address): Promise<number>;
  fees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  /** Broadcast. Must not throw for "already known" or "nonce too low": the transaction may already be in. */
  sendRaw(raw: Hex): Promise<void>;
  /** null while not mined. */
  receipt(hash: Hex): Promise<"success" | "reverted" | null>;
}

export interface GrantDeps {
  chain: GrantChain;
  /** null when the key file isn't installed: grants are then off. */
  signer: GrantSigner | null;
  alert(text: string): Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the transfer to be mined before telling the person to try again. */
  waitMs?: number;
}

/** Celo's base fee has sat at its 200 gwei floor; doubling it plus the tip leaves room for a spike. */
export async function celoFees(client: Pick<PublicClient, "getBlock" | "estimateMaxPriorityFeePerGas">) {
  const [block, tip] = await Promise.all([client.getBlock({ blockTag: "latest" }), client.estimateMaxPriorityFeePerGas()]);
  const base = block.baseFeePerGas ?? BigInt(0);
  return { maxFeePerGas: base * BigInt(2) + tip, maxPriorityFeePerGas: tip };
}

export function viemGrantChain(client: PublicClient): GrantChain {
  return {
    readRoot: (wallet) => readGoodIdRoot(client, wallet),
    getBalance: (address) => client.getBalance({ address }),
    pendingNonce: (address) => client.getTransactionCount({ address, blockTag: "pending" }),
    fees: () => celoFees(client),
    async sendRaw(raw) {
      try {
        await client.sendRawTransaction({ serializedTransaction: raw });
      } catch (e) {
        const msg = (e as Error).message?.toLowerCase() ?? "";
        if (msg.includes("already known") || msg.includes("nonce too low") || msg.includes("already imported")) return;
        throw e;
      }
    },
    async receipt(hash) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return r.status === "success" ? "success" : "reverted";
      } catch {
        return null;
      }
    },
  };
}

/** The switch: "off" stops new grants at once. A missing row means on. An unreadable value means off. */
export async function grantsEnabled(db: Db, key = GAS_GRANTS_KEY): Promise<boolean> {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return !row || row.value === "on";
  } catch (error) {
    console.error("gas grant switch unreadable, treating it as off", error);
    return false;
  }
}

const SLOW = "The network is slow right now. Please wait a minute, then review your vote again. Nothing was charged.";

/**
 * Make sure `wallet` can pay `needWei` of network fee. Tops it up to 0.3 CELO from the gas wallet the
 * first time this person needs it. Returns once the CELO has arrived, or throws GasGrantError.
 */
export async function ensureGas(
  db: Db,
  user: { id: string; wallet: string },
  needWei: bigint,
  reason: GrantReason,
  deps: GrantDeps,
  rule: GrantRule = VOTE_RULE,
): Promise<GrantOutcome> {
  const wallet = user.wallet.toLowerCase() as Address;
  const { chain } = deps;
  if ((await chain.getBalance(wallet)) >= needWei) return { kind: "enough" };

  const root = (await chain.readRoot(wallet))?.toLowerCase();
  if (!root) throw new GasGrantError("Verify with GoodDollar first, then we can cover your network fee.", "not_verified", false);

  const [existing] = await findGrant(db, root, rule);
  if (existing && existing.status !== "claimed") return finishExisting(db, existing, deps, rule);

  if (needWei > rule.targetWei)
    throw new GasGrantError("Network fees are unusually high right now. Please try again later.", "too_expensive");
  if (!deps.signer || !(await grantsEnabled(db)))
    throw new GasGrantError("We can’t cover network fees right now. Message us on Telegram and we’ll help.", "off");

  const signed = await claimAndSign(db, { userId: user.id, wallet, root, needWei, reason, rule }, deps);
  if (signed.kind === "enough") return signed;
  return finishExisting(db, signed.row, deps, rule);
}

/** The person's existing grant row for this rule: their one vote grant, or the one for this plan. */
function findGrant(db: Pick<Db, "select">, root: string, rule: GrantRule) {
  const same = rule.planKey === null ? and(eq(gasGrants.reason, "hackathon_vote")) : eq(gasGrants.planKey, rule.planKey);
  return db.select().from(gasGrants).where(and(eq(gasGrants.goodidRoot, root), same)).limit(1);
}

type Signed = { kind: "enough" } | { kind: "signed"; row: GasGrant };

/** Under the lock: daily limit, the claim, a second identity read, the amount, the nonce, the signature, saved. */
async function claimAndSign(
  db: Db,
  a: { userId: string; wallet: Address; root: string; needWei: bigint; reason: GrantReason; rule: GrantRule },
  deps: GrantDeps,
): Promise<Signed> {
  const { chain } = deps;
  const signer = deps.signer!;
  const now = deps.now?.() ?? new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // Chain reads first, outside the transaction, so the lock is held only briefly.
  const [fees, chainNonce, gasBalance, balance, rootAgain] = await Promise.all([
    chain.fees(),
    chain.pendingNonce(signer.address),
    chain.getBalance(signer.address),
    chain.getBalance(a.wallet),
    chain.readRoot(a.wallet),
  ]);
  if (rootAgain?.toLowerCase() !== a.root) throw new GasGrantError("Verify with GoodDollar first, then we can cover your network fee.", "not_verified", false);
  if (balance >= a.needWei) return { kind: "enough" };
  const amount = a.rule.targetWei - balance;
  const cost = amount + TRANSFER_GAS * fees.maxFeePerGas;
  if (gasBalance < cost) {
    await deps.alert(`GoodBuild gas wallet ${signer.address} is out of CELO (${formatEther(gasBalance)} left). Grants are paused until it's refilled.`).catch(() => {});
    throw new GasGrantError("Our network-fee fund is empty right now. Message us on Telegram and we’ll top it up.", "empty");
  }

  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_GRANTS})`);
    const [{ everyone, own, spent }] = await tx
      .select({
        everyone: sql<number>`count(*)::int`,
        own: sql<number>`(count(*) filter (where ${gasGrants.goodidRoot} = ${a.root}))::int`,
        spent: sql<string>`coalesce(sum(${gasGrants.amountWei}::numeric), 0)::text`,
      })
      .from(gasGrants)
      .where(and(gte(gasGrants.createdAt, dayStart), eq(gasGrants.reason, a.rule.reason)));
    const [mine] = await findGrant(tx, a.root, a.rule);
    if (mine && mine.status !== "claimed") return mine;
    if (!mine && (a.rule.scope === "person" ? own : everyone) >= a.rule.dayLimit)
      throw new GasGrantError("Today’s free network fees are used up. Message us on Telegram, or try again tomorrow.", "daily_limit");
    if (!mine && a.rule.dayBudgetWei !== undefined && BigInt(spent.split(".")[0]) + amount > a.rule.dayBudgetWei)
      throw new GasGrantError("Today’s free network fees are used up. Message us on Telegram, or try again tomorrow.", "budget");
    // Earlier transfers that are signed but not yet seen mined: settle or resend them first. A transfer that
    // never reached the chain (a restart between saving and broadcasting) would otherwise block every
    // later nonce. If one stays unmined for 2 minutes, stop new grants rather than pile nonces on a gap.
    let top: number | null = null;
    for (const prev of await tx.select().from(gasGrants).where(eq(gasGrants.status, "signed"))) {
      if (prev.id === mine?.id || !prev.txHash || !prev.rawTx) continue;
      const got = await chain.receipt(prev.txHash as Hex);
      if (got === "success") {
        await tx.update(gasGrants).set({ status: "confirmed", confirmedAt: now }).where(eq(gasGrants.id, prev.id));
        continue;
      }
      if (got === "reverted") {
        await tx.update(gasGrants).set({ status: "needs_review", error: "reverted on-chain" }).where(eq(gasGrants.id, prev.id));
        await deps.alert(`GoodBuild gas grant ${prev.id} to ${prev.wallet} reverted on-chain (tx ${prev.txHash}). Not retried.`).catch(() => {});
        continue;
      }
      await chain.sendRaw(prev.rawTx as Hex).catch((e) => console.error("[gas-grant] rebroadcast failed", (e as Error).name));
      if ((await chain.receipt(prev.txHash as Hex)) === "success") {
        await tx.update(gasGrants).set({ status: "confirmed", confirmedAt: now }).where(eq(gasGrants.id, prev.id));
        continue;
      }
      top = Math.max(top ?? -1, prev.nonce ?? -1);
      if (prev.sentAt && now.getTime() - prev.sentAt.getTime() > STALL_AFTER_MS) {
        if (!prev.error) {
          await tx.update(gasGrants).set({ error: "stalled" }).where(eq(gasGrants.id, prev.id));
          await deps.alert(`GoodBuild gas grants are paused: transfer ${prev.txHash} (nonce ${prev.nonce}) to ${prev.wallet} hasn't been mined for over 2 minutes. New grants wait until it lands.`).catch(() => {});
        }
        return null; // commit what was settled above, then tell the person to try again
      }
    }
    // Confirmed transfers used their nonce for sure, even if the chain read above came before they landed.
    const [{ used }] = await tx.select({ used: sql<number | null>`max(${gasGrants.nonce})` }).from(gasGrants).where(eq(gasGrants.status, "confirmed"));
    if (used !== null) top = Math.max(top ?? -1, Number(used));
    const nonce = Math.max(chainNonce, top === null ? 0 : top + 1);
    const raw = await signer.signTransaction({
      to: a.wallet,
      value: amount,
      nonce,
      gas: TRANSFER_GAS,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      chainId: CELO_CHAIN_ID,
      type: "eip1559",
    });
    const values = { status: "signed", amountWei: String(amount), nonce, rawTx: raw, txHash: keccak256(raw), sentAt: now, wallet: a.wallet };
    const insertKey = { goodidRoot: a.root, userId: a.userId, reason: a.rule.reason, planKey: a.rule.planKey, createdAt: now };
    if (mine) {
      const [u] = await tx.update(gasGrants).set(values).where(and(eq(gasGrants.id, mine.id), eq(gasGrants.status, "claimed"))).returning();
      return u ?? mine;
    }
    const [inserted] = await tx
      .insert(gasGrants)
      .values({ ...insertKey, ...values })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;
    const [winner] = await findGrant(tx, a.root, a.rule);
    return winner;
  });

  if (!row) throw new GasGrantError(SLOW, "pending", false);
  if (row.status === "signed" && row.amountWei && BigInt(row.amountWei) === amount) {
    const left = gasBalance - cost;
    if (gasBalance >= GRANT_TARGET_WEI * BigInt(LOW_BALANCE_GRANTS) && left < GRANT_TARGET_WEI * BigInt(LOW_BALANCE_GRANTS))
      await deps.alert(`GoodBuild gas wallet ${signer.address} is running low: about ${formatEther(left)} CELO left, enough for fewer than ${LOW_BALANCE_GRANTS} grants.`).catch(() => {});
  }
  return { kind: "signed", row };
}

/** Broadcast (again, if needed) the saved transaction and wait for it. Never signs anything new. */
async function finishExisting(db: Db, row: GasGrant, deps: GrantDeps, rule: GrantRule = VOTE_RULE): Promise<GrantOutcome> {
  if (row.status === "confirmed")
    throw new GasGrantError("You’ve already received your free network fee. Add a little CELO to this wallet, or message us on Telegram.", "used");
  if (row.status === "needs_review") throw new GasGrantError("Your network-fee top-up is being checked by our team. Message us on Telegram if it takes long.", "review");
  if (row.status !== "signed" || !row.rawTx || !row.txHash) throw new GasGrantError(SLOW, "pending", false);

  const hash = row.txHash as Hex;
  const { chain } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = () => deps.now?.() ?? new Date();
  let status = await chain.receipt(hash);
  if (!status) {
    await chain.sendRaw(row.rawTx as Hex).catch((e) => console.error("[gas-grant] broadcast failed", (e as Error).name));
    const deadline = Date.now() + (deps.waitMs ?? 25_000);
    while (!status && Date.now() < deadline) {
      await sleep(1_500);
      status = await chain.receipt(hash);
    }
  }
  if (status === "success") {
    await db.update(gasGrants).set({ status: "confirmed", confirmedAt: now() }).where(and(eq(gasGrants.id, row.id), eq(gasGrants.status, "signed")));
    return { kind: "granted", amountWei: BigInt(row.amountWei ?? "0"), txHash: hash };
  }
  const stuck = row.sentAt && now().getTime() - row.sentAt.getTime() > STUCK_AFTER_MS;
  if (status === "reverted" || stuck) {
    const why = status === "reverted" ? "reverted on-chain" : "not mined after 10 minutes";
    await db.update(gasGrants).set({ status: "needs_review", error: why }).where(and(eq(gasGrants.id, row.id), eq(gasGrants.status, "signed")));
    await deps.alert(`GoodBuild gas grant ${row.id} to ${row.wallet} needs review: ${why}. Tx ${hash}, nonce ${row.nonce}. It will not be retried automatically.`).catch(() => {});
    throw new GasGrantError("Your network-fee top-up is being checked by our team. Message us on Telegram if it takes long.", "review");
  }
  throw new GasGrantError(SLOW, "pending", false);
}

/** For the admin page: how many grants went out, and how many are left in the wallet. */
export async function grantSummary(db: Db, chain: Pick<GrantChain, "getBalance">, gasWallet: Address | null, now = new Date()) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const all = await db.select({ status: gasGrants.status, createdAt: gasGrants.createdAt, reason: gasGrants.reason, amountWei: gasGrants.amountWei }).from(gasGrants);
  const rows = all.filter((r) => r.reason === "hackathon_vote");
  const deploys = all.filter((r) => r.reason === "deploy");
  const balance = gasWallet ? await chain.getBalance(gasWallet).catch(() => null) : null;
  return {
    enabled: (await grantsEnabled(db)) && gasWallet !== null,
    gasWallet,
    balanceWei: balance,
    total: rows.filter((r) => r.status === "confirmed").length,
    today: rows.filter((r) => r.createdAt >= dayStart).length,
    needsReview: all.filter((r) => r.status === "needs_review").length,
    deploy: {
      total: deploys.filter((r) => r.status === "confirmed").length,
      today: deploys.filter((r) => r.createdAt >= dayStart).length,
      todayWei: deploys.filter((r) => r.createdAt >= dayStart).reduce((n, r) => n + BigInt(r.amountWei ?? "0"), BigInt(0)),
    },
  };
}
