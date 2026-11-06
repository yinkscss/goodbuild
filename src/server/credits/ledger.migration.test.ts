// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { checkAiAllowance, spentMicro } from "./cap";
import { getBalanceMicro } from "./ledger";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

/** The migrations folder as it was before the ledger, so a database can start where production is. */
function foldersBeforeLedger(): { folder: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "goodbuild-migrations-"));
  const folder = path.join(root, "drizzle");
  cpSync(MIGRATIONS, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  const index = journal.entries.findIndex((e) => e.tag === "0010_credits_ledger");
  if (index < 0) throw new Error("migration 0010_credits_ledger not found");
  journal.entries = journal.entries.slice(0, index);
  writeFileSync(journalPath, JSON.stringify(journal));
  return { folder, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";
const PROJECT = "00000000-0000-4000-8000-0000000000aa";
const MESSAGE = "00000000-0000-4000-8000-0000000000bb";
const JOB = "00000000-0000-4000-8000-0000000000cc";

/** Plain SQL with no funding column, exactly as the code before this migration writes. */
async function seed(db: Db) {
  await db.execute(sql`INSERT INTO users (id, wallet, verified_at) VALUES (${ALICE}, '0xa', null), (${BOB}, '0xb', now())`);
  await db.execute(sql`INSERT INTO projects (id, owner_id, name, chain_id) VALUES (${PROJECT}, ${ALICE}, 'P', 11142220)`);
  await db.execute(sql`INSERT INTO messages (id, project_id, role, content) VALUES (${MESSAGE}, ${PROJECT}, 'user', 'hi')`);
  await db.execute(sql`INSERT INTO turn_jobs (id, project_id, user_id, mode, prompt, user_message_id, status) VALUES (${JOB}, ${PROJECT}, ${ALICE}, 'build', 'hi', ${MESSAGE}, 'running')`);
  await oldUsage(db, "call-1", ALICE, 150_000, 187_500);
  await oldUsage(db, "call-2", ALICE, 40_000, 50_000);
  await oldUsage(db, "call-3", BOB, 800_000, 1_000_000);
}

function oldUsage(db: Db, callId: string, userId: string, provider: number, charged: number) {
  return db.execute(sql`INSERT INTO usage_events (user_id, call_id, model, input_tokens, output_tokens, provider_cost_micro, charged_micro, markup_bps) VALUES (${userId}, ${callId}, 'm', 1, 1, ${provider}, ${charged}, 2500)`);
}

async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown;
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

/** Everything the free limits (D28 to D30) decide from. None of it may move. */
async function freeCounters(db: Db) {
  const [total] = await rows<{ provider: string; charged: string; count: string }>(db, sql`SELECT sum(provider_cost_micro) AS provider, sum(charged_micro) AS charged, count(*) AS count FROM usage_events`);
  const tight = { FREE_AI_BUDGET_MICRO: "1000000", VERIFIED_CAP_MICRO: "5000000" };
  const room = { FREE_AI_BUDGET_MICRO: "4000000", VERIFIED_CAP_MICRO: "5000000" };
  return {
    provider: Number(total.provider),
    charged: Number(total.charged),
    count: Number(total.count),
    aliceSpent: await spentMicro(db, ALICE),
    bobSpent: await spentMicro(db, BOB),
    aliceNearCap: await checkAiAllowance(db, { userId: ALICE }, { ...room, UNVERIFIED_CAP_MICRO: "237500" }),
    aliceUnderCap: await checkAiAllowance(db, { userId: ALICE }, { ...room, UNVERIFIED_CAP_MICRO: "237501" }),
    bob: await checkAiAllowance(db, { userId: BOB }, room),
    budgetFull: await checkAiAllowance(db, { userId: BOB }, tight),
  };
}

describe.each(testBackends())("migration 0010 over existing rows on $name", (backend) => {
  let database: TestDatabase;
  let db: Db;
  let cleanup = () => undefined as void;
  let before: Awaited<ReturnType<typeof freeCounters>>;

  beforeAll(async () => {
    const old = foldersBeforeLedger();
    cleanup = old.cleanup;
    database = await backend.open();
    db = database.db;
    await database.migrate(old.folder);
    await seed(db);
    before = await freeCounters(db);
    await database.migrate(MIGRATIONS);
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    cleanup();
  });

  it("the seed really exercises the limits: the cap and the budget decide both ways", () => {
    expect(before.provider).toBe(990_000);
    expect(before.aliceNearCap).toMatchObject({ allowed: false, reason: "free_limit" });
    expect(before.aliceUnderCap).toEqual({ allowed: true });
    expect(before.budgetFull).toMatchObject({ allowed: false, reason: "budget_full" });
  });

  it("every existing row becomes free", async () => {
    expect(await rows(db, sql`SELECT DISTINCT funding FROM usage_events`)).toEqual([{ funding: "free" }]);
    expect(await rows(db, sql`SELECT DISTINCT funding FROM turn_jobs`)).toEqual([{ funding: "free" }]);
  });

  it("today's free counters, the $4 total and the decisions from them don't change", async () => {
    expect(await freeCounters(db)).toEqual(before);
  });

  it("nobody has a balance, and the money tables start empty", async () => {
    expect(await getBalanceMicro(db, ALICE)).toBe(0);
    expect(await rows(db, sql`SELECT count(*)::int AS n FROM ledger_entries`)).toEqual([{ n: 0 }]);
    expect(await rows(db, sql`SELECT count(*)::int AS n FROM balances`)).toEqual([{ n: 0 }]);
  });

  it("the older code still writes after the migration, so a rollback is safe, and its rows are free", async () => {
    await oldUsage(db, "call-after", ALICE, 1, 1);
    await db.execute(sql`INSERT INTO messages (id, project_id, role, content) VALUES ('00000000-0000-4000-8000-0000000000bc', ${PROJECT}, 'user', 'again')`);
    await db.execute(sql`INSERT INTO turn_jobs (project_id, user_id, mode, prompt, user_message_id) VALUES (${PROJECT}, ${ALICE}, 'build', 'again', '00000000-0000-4000-8000-0000000000bc')`);
    expect(await rows(db, sql`SELECT funding FROM usage_events WHERE call_id = 'call-after'`)).toEqual([{ funding: "free" }]);
    expect(await rows(db, sql`SELECT DISTINCT funding FROM turn_jobs`)).toEqual([{ funding: "free" }]);
  });

  it("a funding value outside the four is refused on both tables", async () => {
    await expect(db.execute(sql`UPDATE usage_events SET funding = 'gift'`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE turn_jobs SET funding = 'gift'`)).rejects.toThrow();
  });
});
