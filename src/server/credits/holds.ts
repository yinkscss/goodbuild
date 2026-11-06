import "server-only";

import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { balances, ledgerEntries, turnJobs } from "@/server/db/schema";
import { MARKUP_BPS } from "@/config/model-pricing";
import { chargedMicro, priceFor } from "@/lib/pricing";
import { postLedgerEntry } from "./ledger";

/**
 * Paid builds (M3, D49). Free AI comes first (MAINNET_PLAN decision 5). When it's used up, a user
 * with credit gets a `paid` build, and part of their balance is reserved for it when it's queued.
 * Each model call is charged to the ledger as it's recorded, out of that reservation. Before each
 * call the reservation must cover the call's worst case: it's extended from the rest of the balance
 * if it can be, and otherwise the build stops. Whatever is left is returned when the job ends,
 * by the trigger in migration 0012, however the job ends.
 *
 * Lock order, everywhere: a job's row first, then its user's `balances` row. Queueing locks only
 * the balances row and inserts the job, so it never waits on an existing job's row.
 */

/**
 * The least a paid build needs free to start: about one worst-case call to the strong model on a
 * large project, so it can afford at least one fix (D49). Below $1 on purpose: the smallest top-up
 * (MAINNET_PLAN decision 7, about N1,000) may buy less than $1, and it must be able to build.
 */
export const PAID_MIN_START_MICRO = 350_000;

/**
 * The most set aside when a paid build is queued: plan section 5 item 5's $1, twice the dearest
 * build on record (D19's $0.50). Less if less is free. The checks before each call keep the spending
 * safe at any size, so this only decides how many builds one balance can have going at once.
 * To be checked against real paid builds (UNVERIFIED): change it with PAID_HOLD_MICRO.
 */
export const PAID_HOLD_MICRO = 1_000_000;

/** Free credit a paid call outside a build needs: well above the dearest upload or visual check. */
export const PAID_MIN_DIRECT_MICRO = 50_000;

/** A payer who can't start a build (plan section 5 item 4). Shown by the existing 402 handling. */
export const OUT_OF_CREDITS_MESSAGE = "You're out of credits. Top up to keep building.";

/** A payer with credit, all of it set aside for builds already queued or running. */
export const CREDIT_HELD_MESSAGE = "Your credit is set aside for builds in progress. Wait for one to finish, then try again.";

/** A paid build stopped because the next call could cost more than is left. */
export const OUT_OF_CREDITS_BUILD_MESSAGE = "This build stopped because your credits ran out. Your project is unchanged. Top up, then retry.";

/** Thrown at the safe point before a model call that the user's credit can't cover. */
export class OutOfCreditsError extends Error {
  constructor() {
    super(OUT_OF_CREDITS_BUILD_MESSAGE);
    this.name = "OutOfCreditsError";
  }
}

/** A whole number of micro-USD above zero from the settings, or the default. */
function setting(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function minStartMicro(env: Record<string, string | undefined>) {
  return setting(env.PAID_MIN_START_MICRO, PAID_MIN_START_MICRO);
}

/** The hold a new paid build aims for. Never below the minimum to start. */
export function holdMicro(env: Record<string, string | undefined>) {
  return Math.max(setting(env.PAID_HOLD_MICRO, PAID_HOLD_MICRO), minStartMicro(env));
}

export interface LockedBalance {
  balanceMicro: number;
  reservedMicro: number;
  /** What a new build or a hold extension can take: the balance less what's already reserved. */
  availableMicro: number;
}

/**
 * Take the user's balances row lock, creating the row if needed, as postLedgerEntry does. Held
 * until the transaction ends. Must come after any job row this transaction locks.
 */
export async function lockBalance(tx: Db, userId: string): Promise<LockedBalance> {
  await tx.insert(balances).values({ userId }).onConflictDoNothing({ target: balances.userId });
  const [row] = await tx.select({ balanceMicro: balances.balanceMicro, reservedMicro: balances.reservedMicro }).from(balances).where(eq(balances.userId, userId)).for("update");
  return { ...row, availableMicro: row.balanceMicro - row.reservedMicro };
}

/** The balance without taking the lock, for checks that don't move money. No row reads as zero. */
export async function readBalance(db: Db, userId: string): Promise<LockedBalance> {
  const [row] = await db.select({ balanceMicro: balances.balanceMicro, reservedMicro: balances.reservedMicro }).from(balances).where(eq(balances.userId, userId)).limit(1);
  const balanceMicro = row?.balanceMicro ?? 0;
  const reservedMicro = row?.reservedMicro ?? 0;
  return { balanceMicro, reservedMicro, availableMicro: balanceMicro - reservedMicro };
}

/** Has this user ever bought credit? Then refusals say they're out of credits, not out of free AI. */
export async function hasPaid(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.userId, userId), eq(ledgerEntries.kind, "deposit")))
    .limit(1);
  return Boolean(row);
}

/**
 * Characters a token, for the worst case. Below the usual 2.5 (CHARS_PER_TOKEN) because that's an
 * average: hex addresses and non-Latin text pack more tokens into each character.
 */
const WORST_CHARS_PER_TOKEN = 2;
/** Tokens allowed for each image in a request. Claude's largest standard image is about 1,600. */
const IMAGE_TOKENS = 2_000;
/** Per-message framing the providers add, generously. */
const MESSAGE_TOKENS = 10;

interface EstimatedMessage {
  role: string;
  content: string | null | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{ function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/**
 * The most a model call could be charged, in micro-USD: every input token at the uncached price
 * (2 characters a token), the full output limit, and the markup. Thinking counts as output, inside the
 * limit (measured for DeepSeek in HARNESS.md, UNVERIFIED for Claude). Priced from the model the tier
 * asks for. A reply naming a model missing from the price table is billed at the strong model's
 * price, which can pass this: the one known way past the estimate (D49).
 */
export function worstCaseCallMicro(model: string, request: { messages: readonly EstimatedMessage[]; tools?: readonly unknown[]; maxTokens: number }): number {
  let chars = request.tools?.length ? JSON.stringify(request.tools).length : 0;
  let images = 0;
  for (const m of request.messages) {
    if (typeof m.content === "string") chars += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "text") chars += part.text?.length ?? 0;
        else images++;
      }
    }
    for (const c of m.tool_calls ?? []) chars += c.function.name.length + c.function.arguments.length;
    chars += m.tool_call_id?.length ?? 0;
  }
  const inputTokens = Math.ceil(chars / WORST_CHARS_PER_TOKEN) + images * IMAGE_TOKENS + request.messages.length * MESSAGE_TOKENS;
  const p = priceFor(model);
  const usd = (inputTokens * p.inputPerMTok + request.maxTokens * p.outputPerMTok) / 1_000_000;
  return chargedMicro(Math.ceil(usd * 1_000_000), MARKUP_BPS);
}

/**
 * Before a paid call: make the job's hold cover `worstMicro`, extending it from the user's free
 * balance if needed. False when even the extension can't cover it: the build must stop. Run in the
 * job's fenced transaction, which has already locked the job's row.
 */
export async function ensureHold(tx: Db, jobId: string, worstMicro: number): Promise<boolean> {
  // Lock order: job row, then balances row. The fence has usually locked this row already.
  const [job] = await tx.select({ userId: turnJobs.userId, holdMicro: turnJobs.holdMicro, funding: turnJobs.funding }).from(turnJobs).where(eq(turnJobs.id, jobId)).for("update");
  if (!job || job.funding !== "paid") return true;
  if (job.holdMicro >= worstMicro) return true;
  const need = worstMicro - job.holdMicro;
  const balance = await lockBalance(tx, job.userId);
  if (balance.availableMicro < need) return false;
  // The trigger adds the extension to balances.reserved_micro.
  await tx.update(turnJobs).set({ holdMicro: worstMicro }).where(eq(turnJobs.id, jobId));
  return true;
}

/** One ledger key per usage row, so a replayed or resumed call is never charged twice. */
export function usageKey(callId: string): string {
  return `usage:${callId.length <= 190 ? callId : createHash("sha256").update(callId).digest("hex")}`;
}

/**
 * Record one paid call: insert its usage row and, only if that really inserted a row, charge it.
 * Run in one transaction, so a crash can't leave a saved response unbilled or a charge with no
 * response. The cost is already incurred, so it's posted even if it takes the balance below zero
 * (D46's `allowNegative` for usage): refusing would roll back the saved response with it, and a resume
 * would then pay the provider again. It comes out of the job's hold first. A job that has ended has no
 * hold, so a late charge (the project-name call, which runs beside the build) only lowers the balance.
 * A hold can't race it: both lock the job's row first.
 */
export async function recordPaidUsage(
  db: Db,
  input: { userId: string; jobId?: string | null; callId: string; chargedMicro: number; insertUsage: (tx: Db) => Promise<boolean> },
): Promise<boolean> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [job] = input.jobId ? await tx.select({ holdMicro: turnJobs.holdMicro }).from(turnJobs).where(eq(turnJobs.id, input.jobId)).for("update") : [];
    if (!(await input.insertUsage(tx))) return false;
    if (input.chargedMicro <= 0) return true;
    await postLedgerEntry(tx, {
      userId: input.userId,
      kind: "usage",
      amountMicro: -input.chargedMicro,
      idempotencyKey: usageKey(input.callId),
      refType: "usage_event",
      refId: input.callId,
      allowNegative: true,
    });
    if (job && job.holdMicro > 0) {
      await tx
        .update(turnJobs)
        .set({ holdMicro: Math.max(0, job.holdMicro - input.chargedMicro) })
        .where(eq(turnJobs.id, input.jobId!));
    }
    return true;
  });
}

export interface ReservationMismatch {
  userId: string;
  reservedMicro: number;
  openHoldsMicro: number;
}

function rowsOf<T>(result: unknown): T[] {
  // postgres-js returns an array; PGlite returns { rows }.
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

/**
 * Reconciliation (D49): each user's reserved credit must equal the holds of their queued and
 * running jobs, and no finished job may still hold any. Should always be empty. The worker's regular
 * check corrects the first kind and logs both, and M7's reconciliation can report on it.
 */
export async function findReservationMismatches(db: Db): Promise<ReservationMismatch[]> {
  const rows = rowsOf<{ user_id: string; reserved_micro: string; open_micro: string }>(
    await db.execute(sql`
      SELECT coalesce(b.user_id, h.user_id) AS user_id, coalesce(b.reserved_micro, 0) AS reserved_micro, coalesce(h.total, 0) AS open_micro
      FROM balances b
      FULL JOIN (SELECT user_id, sum(hold_micro) AS total FROM turn_jobs WHERE status IN ('queued', 'running') GROUP BY user_id) h ON h.user_id = b.user_id
      WHERE coalesce(b.reserved_micro, 0) <> coalesce(h.total, 0)
      UNION ALL
      SELECT user_id, 0, sum(hold_micro) FROM turn_jobs WHERE status NOT IN ('queued', 'running') AND hold_micro > 0 GROUP BY user_id`),
  );
  return rows.map((r) => ({ userId: r.user_id, reservedMicro: Number(r.reserved_micro), openHoldsMicro: Number(r.open_micro) }));
}

/**
 * Put each mismatched user's reserved total back to the sum of their open holds (D49). Nothing should
 * ever need this: it's for a hand edit or a bug, because a total that's too high would strand someone's
 * credit. Reading the holds under the balance lock is safe against a hold changing at the same moment:
 * the trigger updates the balances row first, so that change has either committed and is seen here, or
 * is waiting for this lock and will add itself on top. Returns what it changed.
 */
export async function repairReservations(db: Db): Promise<ReservationMismatch[]> {
  const repaired: ReservationMismatch[] = [];
  const users = new Set((await findReservationMismatches(db)).map((m) => m.userId));
  for (const userId of users) {
    await db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const { reservedMicro } = await lockBalance(tx, userId);
      const [open] = await tx
        .select({ total: sql<string>`coalesce(sum(${turnJobs.holdMicro}), 0)` })
        .from(turnJobs)
        .where(and(eq(turnJobs.userId, userId), sql`${turnJobs.status} IN ('queued', 'running')`));
      const openHoldsMicro = Number(open?.total ?? 0);
      if (openHoldsMicro === reservedMicro) return;
      await tx.update(balances).set({ reservedMicro: openHoldsMicro, updatedAt: sql`now()` }).where(eq(balances.userId, userId));
      repaired.push({ userId, reservedMicro, openHoldsMicro });
    });
  }
  return repaired;
}
