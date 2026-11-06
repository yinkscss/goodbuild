import "server-only";

import { eq, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { LEDGER_KINDS, balances, ledgerEntries, type LedgerEntry, type LedgerKind } from "@/server/db/schema";

/**
 * The credits ledger (D46). Amounts are integer micro-USD. Every change to a balance is one entry,
 * posted here in one transaction with the balance. The balance is only a cached sum of the entries.
 *
 * The rule for going below zero:
 * - A debit that would take the balance below zero is refused, and nothing is written.
 * - `allowNegative` lifts that for `usage` and `adjust` only, for things that have already happened
 *   and must be recorded: an AI call already paid for, or a chargeback Paystack already took.
 * - A `refund` can never go below zero, since it hands back money for credit that's already gone.
 * - A credit is always accepted, even if the balance stays negative after it.
 * Blocking new builds while a balance is negative is up to the caller (M2, M3).
 */

export interface PostEntryInput {
  userId: string;
  kind: LedgerKind;
  /** Integer micro-USD. deposit: above zero. usage and refund: below zero. adjust: either, not zero. */
  amountMicro: number;
  /** One per real-world event, such as `topup:<reference>`. Posting it again changes nothing. */
  idempotencyKey: string;
  refType?: string;
  refId?: string;
  allowNegative?: boolean;
}

export interface PostedEntry {
  entry: LedgerEntry;
  /** The balance now. On a replay this can differ from `entry.balanceAfterMicro`. */
  balanceMicro: number;
  /** True when this key was already posted, so nothing changed this time. */
  replayed: boolean;
}

export class InvalidLedgerEntryError extends Error {
  readonly code = "invalid_ledger_entry";
}

export class InsufficientBalanceError extends Error {
  readonly code = "insufficient_balance";
  constructor(
    readonly balanceMicro: number,
    readonly amountMicro: number,
  ) {
    super(`A debit of ${amountMicro} would take a balance of ${balanceMicro} below zero.`);
  }
}

/** The key was already used for something else: a bug or an attack, never a harmless replay. */
export class IdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict";
  constructor(readonly idempotencyKey: string) {
    super(`Ledger key ${idempotencyKey} was already used for a different entry.`);
  }
}

const MAX_KEY_LENGTH = 200;

function validate(input: PostEntryInput) {
  const { kind, amountMicro: amount, idempotencyKey: key, allowNegative } = input;
  if (!LEDGER_KINDS.includes(kind)) throw new InvalidLedgerEntryError(`Unknown ledger kind: ${String(kind)}`);
  if (!Number.isSafeInteger(amount) || amount === 0) throw new InvalidLedgerEntryError(`Amount must be a whole number of micro-USD and not zero: ${amount}`);
  if (kind === "deposit" && amount < 0) throw new InvalidLedgerEntryError("A deposit must be above zero.");
  if ((kind === "usage" || kind === "refund") && amount > 0) throw new InvalidLedgerEntryError(`A ${kind} entry must be below zero.`);
  if (allowNegative && kind !== "usage" && kind !== "adjust") throw new InvalidLedgerEntryError(`A ${kind} entry can't take a balance below zero.`);
  if (typeof key !== "string" || !key || key.length > MAX_KEY_LENGTH) throw new InvalidLedgerEntryError(`The key must be 1 to ${MAX_KEY_LENGTH} characters.`);
}

async function findByKey(db: Db, key: string): Promise<LedgerEntry | undefined> {
  const [row] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, key)).limit(1);
  return row;
}

/** The earlier entry must be this same event. Anything else with its key is refused. */
function assertSameEntry(existing: LedgerEntry, input: PostEntryInput) {
  const same =
    existing.userId === input.userId &&
    existing.kind === input.kind &&
    existing.amountMicro === input.amountMicro &&
    existing.refType === (input.refType ?? null) &&
    existing.refId === (input.refId ?? null);
  if (!same) throw new IdempotencyConflictError(input.idempotencyKey);
}

function isKeyViolation(error: unknown): boolean {
  // Drizzle wraps the driver's error, so look at both.
  for (const e of [error, (error as { cause?: unknown })?.cause] as Array<{ code?: string; constraint_name?: string; constraint?: string; message?: string } | undefined>) {
    if (e?.code === "23505" && `${e.constraint_name ?? e.constraint ?? ""} ${e.message ?? ""}`.includes("ledger_entries_idempotency_key_unique")) return true;
  }
  return false;
}

/**
 * Post one entry, safe under concurrency and replay. Pass a transaction to make it part of a larger
 * one: it then runs in a savepoint, a refusal leaves the outer transaction usable, and rolling back
 * the outer transaction removes the entry. Any transaction doing this and locking other rows must
 * take its locks in a fixed order, because this holds the user's balance row until it commits.
 */
export async function postLedgerEntry(db: Db, input: PostEntryInput): Promise<PostedEntry> {
  validate(input);
  try {
    return await db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      // The row lock is what serialises one user's posts: everything below sees the latest balance.
      await tx.insert(balances).values({ userId: input.userId }).onConflictDoNothing({ target: balances.userId });
      const [locked] = await tx.select({ balanceMicro: balances.balanceMicro }).from(balances).where(eq(balances.userId, input.userId)).for("update");

      const existing = await findByKey(tx, input.idempotencyKey);
      if (existing) {
        assertSameEntry(existing, input);
        return { entry: existing, balanceMicro: locked.balanceMicro, replayed: true };
      }

      const next = locked.balanceMicro + input.amountMicro;
      if (!Number.isSafeInteger(next)) throw new InvalidLedgerEntryError("That balance would be too big to count exactly.");
      if (next < 0 && input.amountMicro < 0 && !input.allowNegative) throw new InsufficientBalanceError(locked.balanceMicro, input.amountMicro);

      const [entry] = await tx
        .insert(ledgerEntries)
        .values({
          userId: input.userId,
          kind: input.kind,
          amountMicro: input.amountMicro,
          balanceAfterMicro: next,
          allowNegative: input.allowNegative ?? false,
          refType: input.refType,
          refId: input.refId,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      await tx
        .update(balances)
        .set({ balanceMicro: next, updatedAt: sql`now()` })
        .where(eq(balances.userId, input.userId));
      return { entry, balanceMicro: next, replayed: false };
    });
  } catch (error) {
    // Only another user's post can get here: one user's are serialised by the lock above.
    if (!isKeyViolation(error)) throw error;
    const existing = await findByKey(db, input.idempotencyKey);
    if (existing) assertSameEntry(existing, input);
    throw new IdempotencyConflictError(input.idempotencyKey);
  }
}

/** The balance as cached. A user who has never had an entry has no row, and reads as zero. */
export async function getBalanceMicro(db: Db, userId: string): Promise<number> {
  const [row] = await db.select({ balanceMicro: balances.balanceMicro }).from(balances).where(eq(balances.userId, userId)).limit(1);
  return row?.balanceMicro ?? 0;
}

/** The balance worked out from the entries, which are the source of truth. */
export async function balanceFromEntriesMicro(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMicro}), 0)` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.userId, userId));
  return Number(row?.total ?? 0);
}

/** Every user whose cached balance differs from their entries. Should always be empty (M7 reports on it). */
export async function findBalanceMismatches(db: Db): Promise<Array<{ userId: string; balanceMicro: number; entriesMicro: number }>> {
  const rows = await db.execute(sql`
    SELECT coalesce(b.user_id, e.user_id) AS user_id, coalesce(b.balance_micro, 0) AS balance_micro, coalesce(e.total, 0) AS entries_micro
    FROM balances b
    FULL JOIN (SELECT user_id, sum(amount_micro) AS total FROM ledger_entries GROUP BY user_id) e ON e.user_id = b.user_id
    WHERE coalesce(b.balance_micro, 0) <> coalesce(e.total, 0)`);
  // postgres-js returns an array; PGlite returns { rows }.
  const list = (Array.isArray(rows) ? rows : ((rows as unknown as { rows: unknown[] }).rows ?? [])) as Array<{ user_id: string; balance_micro: string; entries_micro: string }>;
  return list.map((r) => ({ userId: r.user_id, balanceMicro: Number(r.balance_micro), entriesMicro: Number(r.entries_micro) }));
}
