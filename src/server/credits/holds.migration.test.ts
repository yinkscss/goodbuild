// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { messages, turnJobs } from "@/server/db/schema";
import { recordUsage } from "@/server/agent/store";
import * as capBefore from "./cap-before-m3";
import { checkAiAllowance, spentMicro } from "./cap";
import { findReservationMismatches } from "./holds";
import { findBalanceMismatches, postLedgerEntry } from "./ledger";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

/** The migrations folder as it was before M3, so a database can start where production is. */
function foldersBeforeHolds(): { folder: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "goodbuild-migrations-"));
  const folder = path.join(root, "drizzle");
  cpSync(MIGRATIONS, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  const index = journal.entries.findIndex((e) => e.tag.endsWith("_m3_holds"));
  if (index < 0) throw new Error("the M3 migration wasn't found");
  journal.entries = journal.entries.slice(0, index);
  writeFileSync(journalPath, JSON.stringify(journal));
  return { folder, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";
const PROJECT = "00000000-0000-4000-8000-0000000000aa";

async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown;
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

/** Plain SQL with no M3 column, as the code before this migration writes. */
async function seed(db: Db) {
  await db.execute(sql`INSERT INTO users (id, wallet, verified_at) VALUES (${ALICE}, '0xa', null), (${BOB}, '0xb', now())`);
  await db.execute(sql`INSERT INTO projects (id, owner_id, name, chain_id) VALUES (${PROJECT}, ${ALICE}, 'P', 11142220)`);
  for (const [i, status] of ["queued", "running", "done", "error", "stopped", "cancelled"].entries()) {
    const message = `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;
    await db.execute(sql`INSERT INTO messages (id, project_id, role, content) VALUES (${message}, ${PROJECT}, 'user', 'hi')`);
    await db.execute(sql`INSERT INTO turn_jobs (project_id, user_id, mode, prompt, user_message_id, status, funding) VALUES (${PROJECT}, ${ALICE}, 'build', 'hi', ${message}, ${status}, ${i % 2 ? "free" : "exempt"})`);
  }
  for (const [n, [user, provider, charged, funding]] of ([[ALICE, 150_000, 187_500, "free"], [ALICE, 40_000, 50_000, "exempt"], [BOB, 800_000, 1_000_000, "free"]] as const).entries()) {
    await db.execute(sql`INSERT INTO usage_events (user_id, call_id, model, input_tokens, output_tokens, provider_cost_micro, charged_micro, markup_bps, funding) VALUES (${user}, ${`seed-${n}`}, 'm', 1, 1, ${provider}, ${charged}, 2500, ${funding})`);
  }
}

/** Every total anyone reads. None of it may move. */
async function totals(db: Db) {
  const [usage] = await rows<{ provider: string; charged: string; count: string }>(db, sql`SELECT sum(provider_cost_micro) AS provider, sum(charged_micro) AS charged, count(*) AS count FROM usage_events`);
  return {
    usage,
    usageByFunding: await rows(db, sql`SELECT funding, sum(charged_micro) AS charged FROM usage_events GROUP BY funding ORDER BY funding`),
    jobs: await rows(db, sql`SELECT status, funding, count(*) AS n FROM turn_jobs GROUP BY status, funding ORDER BY status, funding`),
    balances: await rows(db, sql`SELECT user_id, balance_micro FROM balances ORDER BY user_id`),
    entries: await rows(db, sql`SELECT user_id, kind, amount_micro, balance_after_micro, idempotency_key FROM ledger_entries ORDER BY seq`),
    sums: await rows(db, sql`SELECT user_id, sum(amount_micro) AS total FROM ledger_entries GROUP BY user_id ORDER BY user_id`),
  };
}

describe.each(testBackends())("migration to M3 over existing rows on $name", (backend) => {
  let database: TestDatabase;
  let db: Db;
  let cleanup = () => undefined as void;
  let before: Awaited<ReturnType<typeof totals>>;
  let decisionsBefore: unknown[];
  const decisions = (cap: { checkAiAllowance: (db: Db, input: { userId: string }, env: Record<string, string | undefined>) => Promise<unknown>; spentMicro: (db: Db, userId: string) => Promise<number> }) =>
    Promise.all([
      cap.spentMicro(db, ALICE),
      cap.spentMicro(db, BOB),
      cap.checkAiAllowance(db, { userId: BOB }, { VERIFIED_CAP_MICRO: "5000000", FREE_AI_BUDGET_MICRO: "4000000" }),
      cap.checkAiAllowance(db, { userId: ALICE }, { UNVERIFIED_CAP_MICRO: "5000000", FREE_AI_BUDGET_MICRO: "1" }),
      cap.checkAiAllowance(db, { userId: ALICE }, { UNVERIFIED_CAP_MICRO: "187500", FREE_AI_BUDGET_MICRO: "99000000" }),
      cap.checkAiAllowance(db, { userId: ALICE }, { UNVERIFIED_CAP_MICRO: "187501", FREE_AI_BUDGET_MICRO: "99000000" }),
    ]);

  beforeAll(async () => {
    const old = foldersBeforeHolds();
    cleanup = old.cleanup;
    database = await backend.open();
    db = database.db;
    await database.migrate(old.folder);
    await seed(db);
    // Ledger rows as the code before M3 posts them, with several entries for one user.
    await db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO balances (user_id, balance_micro) VALUES (${BOB}, 2760000)`);
      await tx.execute(sql`INSERT INTO ledger_entries (user_id, kind, amount_micro, balance_after_micro, idempotency_key) VALUES (${BOB}, 'deposit', 3000000, 3000000, 'topup:a')`);
      await tx.execute(sql`INSERT INTO ledger_entries (user_id, kind, amount_micro, balance_after_micro, idempotency_key) VALUES (${BOB}, 'usage', -250000, 2750000, 'usage:a')`);
      await tx.execute(sql`INSERT INTO ledger_entries (user_id, kind, amount_micro, balance_after_micro, idempotency_key) VALUES (${BOB}, 'adjust', 10000, 2760000, 'adjust:a')`);
    });
    before = await totals(db);
    decisionsBefore = await decisions(capBefore);
    await database.migrate(MIGRATIONS);
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    cleanup();
  });

  it("the seed really has something to lose", () => {
    expect(before.balances).toHaveLength(1);
    expect(before.entries).toHaveLength(3);
    expect(Number(before.usage.count)).toBe(3);
    expect(decisionsBefore[3]).toMatchObject({ allowed: false, reason: "budget_full" });
    expect(decisionsBefore[4]).toMatchObject({ allowed: false, reason: "free_limit" });
    expect(decisionsBefore[5]).toEqual({ allowed: true });
  });

  it("no total changes", async () => {
    expect(await totals(db)).toEqual(before);
    expect(await findBalanceMismatches(db)).toEqual([]);
  });

  it("the free counters and the decisions made from them don't change", async () => {
    expect(await decisions({ checkAiAllowance, spentMicro })).toEqual(decisionsBefore);
  });

  it("nothing is held, and nothing is released, on any existing row", async () => {
    expect(await rows(db, sql`SELECT DISTINCT hold_micro::int, released_micro::int FROM turn_jobs`)).toEqual([{ hold_micro: 0, released_micro: 0 }]);
    expect(await rows(db, sql`SELECT DISTINCT reserved_micro::int FROM balances`)).toEqual([{ reserved_micro: 0 }]);
    expect(await findReservationMismatches(db)).toEqual([]);
  });

  it("a ledger with history keeps working: the next post chains on the old ones", async () => {
    await postLedgerEntry(db, { userId: BOB, kind: "deposit", amountMicro: 5, idempotencyKey: "topup:after" });
    await recordUsage(db, { userId: BOB, projectId: PROJECT, messageId: null, callId: "after", model: "deepseek-flash", inputTokens: 1000, outputTokens: 10, cachedInputTokens: 0, funding: "paid" });
    expect(await findBalanceMismatches(db)).toEqual([]);
  });

  it("old code still works after the migration, so a rollback is safe", async () => {
    // Writes no M3 column, and ends jobs the way it always did.
    const [m] = await db.insert(messages).values({ projectId: PROJECT, role: "user", content: "x" }).returning({ id: messages.id });
    await db.execute(sql`INSERT INTO turn_jobs (project_id, user_id, mode, prompt, user_message_id) VALUES (${PROJECT}, ${ALICE}, 'build', 'x', ${m.id})`);
    await db.execute(sql`UPDATE turn_jobs SET status = 'done' WHERE user_message_id = ${m.id}`);
    await db.execute(sql`INSERT INTO usage_events (user_id, call_id, model, input_tokens, output_tokens, provider_cost_micro, charged_micro, markup_bps) VALUES (${ALICE}, 'rollback', 'm', 1, 1, 1, 1, 2500)`);
    // A paid job left behind by new code: the old worker refuses to start it, which ends it, and its hold goes back.
    const [p] = await db.insert(messages).values({ projectId: PROJECT, role: "user", content: "y" }).returning({ id: messages.id });
    const [job] = await db.insert(turnJobs).values({ projectId: PROJECT, userId: BOB, mode: "build", prompt: "y", userMessageId: p.id, funding: "paid", holdMicro: 400_000 }).returning();
    await db.execute(sql`UPDATE turn_jobs SET status = 'error', error = 'x', finished_at = now(), lease_owner = NULL, lease_expires_at = NULL WHERE id = ${job.id}`);
    expect(await rows(db, sql`SELECT hold_micro::int, released_micro::int FROM turn_jobs WHERE id = ${job.id}`)).toEqual([{ hold_micro: 0, released_micro: 400_000 }]);
    expect(await findReservationMismatches(db)).toEqual([]);
  });
});

describe.each(testBackends())("the M3 migration refuses a broken ledger on $name", (backend) => {
  it("history that isn't a correct running total stops the migration instead of breaking later posts", async () => {
    const old = foldersBeforeHolds();
    const database = await backend.open();
    try {
      await database.migrate(old.folder);
      await database.db.execute(sql`INSERT INTO users (id, wallet) VALUES (${ALICE}, '0xa')`);
      // The sum is right, so the old check allowed it, but the running total on the row is wrong.
      await database.db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO balances (user_id, balance_micro) VALUES (${ALICE}, 100)`);
        await tx.execute(sql`INSERT INTO ledger_entries (user_id, kind, amount_micro, balance_after_micro, idempotency_key) VALUES (${ALICE}, 'deposit', 100, 999, 'wrong')`);
      });
      await expect(database.migrate(MIGRATIONS)).rejects.toThrow();
    } finally {
      await database.close();
      old.cleanup();
    }
  }, 120_000);
});
