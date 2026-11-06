// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { balances, ledgerEntries, messages, projects, turnJobs, usageEvents, users } from "@/server/db/schema";
import { appDataRecords } from "@/server/db/app-data-schema";
import { deleteProjectData } from "@/server/app-data/store";
import {
  IdempotencyConflictError,
  InsufficientBalanceError,
  InvalidLedgerEntryError,
  balanceFromEntriesMicro,
  findBalanceMismatches,
  getBalanceMicro,
  postLedgerEntry,
} from "./ledger";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

const DOLLAR = 1_000_000;

/** A rejected query's own message and its driver cause, which is where Postgres's text ends up. */
async function failure(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const e = error as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ""}`;
  }
  throw new Error("expected this to be refused, and it succeeded");
}

describe.each(testBackends())("credits ledger on $name", (backend) => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await backend.open();
    db = database.db;
    await database.migrate(MIGRATIONS);
  }, 120_000);

  afterAll(async () => {
    await database?.close();
  });

  async function newUser(): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({ wallet: `0x${randomUUID().replaceAll("-", "")}` })
      .returning({ id: users.id });
    return u.id;
  }

  const key = () => `test:${randomUUID()}`;

  async function funded(amountMicro: number): Promise<string> {
    const userId = await newUser();
    await postLedgerEntry(db, { userId, kind: "deposit", amountMicro, idempotencyKey: key() });
    return userId;
  }

  async function entriesOf(userId: string) {
    return db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId)).orderBy(asc(ledgerEntries.seq));
  }

  async function expectConsistent(userId: string, expected: number) {
    expect(await getBalanceMicro(db, userId)).toBe(expected);
    expect(await balanceFromEntriesMicro(db, userId)).toBe(expected);
    // Each entry must follow from the one before it, not only add up at the end.
    let running = 0;
    for (const entry of await entriesOf(userId)) {
      running += entry.amountMicro;
      expect(entry.balanceAfterMicro).toBe(running);
    }
    expect(running).toBe(expected);
  }

  describe("double posting", () => {
    it("the same key twice posts once and says it was a replay", async () => {
      const userId = await newUser();
      const input = { userId, kind: "deposit", amountMicro: 5 * DOLLAR, idempotencyKey: key(), refType: "topup", refId: "gb_1" } as const;
      const first = await postLedgerEntry(db, input);
      const second = await postLedgerEntry(db, input);
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.entry.id).toBe(first.entry.id);
      expect(await entriesOf(userId)).toHaveLength(1);
      await expectConsistent(userId, 5 * DOLLAR);
    });

    it("a replay returns the balance now, not the balance when it was first posted", async () => {
      const userId = await newUser();
      const input = { userId, kind: "deposit", amountMicro: DOLLAR, idempotencyKey: key() } as const;
      await postLedgerEntry(db, input);
      await postLedgerEntry(db, { userId, kind: "deposit", amountMicro: DOLLAR, idempotencyKey: key() });
      const replay = await postLedgerEntry(db, input);
      expect(replay.balanceMicro).toBe(2 * DOLLAR);
      expect(replay.entry.balanceAfterMicro).toBe(DOLLAR);
    });

    it.each([
      ["a different amount", { amountMicro: 9 * DOLLAR }],
      ["a different kind", { kind: "adjust" as const }],
      ["a different reference", { refId: "gb_other" }],
    ])("the same key with %s is refused and changes nothing", async (_, change) => {
      const userId = await newUser();
      const input = { userId, kind: "deposit" as const, amountMicro: DOLLAR, idempotencyKey: key(), refType: "topup", refId: "gb_1" };
      await postLedgerEntry(db, input);
      await expect(postLedgerEntry(db, { ...input, ...change })).rejects.toBeInstanceOf(IdempotencyConflictError);
      expect(await entriesOf(userId)).toHaveLength(1);
      await expectConsistent(userId, DOLLAR);
    });

    it("one user can't use another user's key, and neither balance moves", async () => {
      const owner = await newUser();
      const thief = await newUser();
      const idempotencyKey = key();
      await postLedgerEntry(db, { userId: owner, kind: "deposit", amountMicro: DOLLAR, idempotencyKey });
      await expect(postLedgerEntry(db, { userId: thief, kind: "deposit", amountMicro: DOLLAR, idempotencyKey })).rejects.toBeInstanceOf(IdempotencyConflictError);
      await expectConsistent(owner, DOLLAR);
      await expectConsistent(thief, 0);
    });
  });

  describe("racing posts", () => {
    it("40 deliveries of one key at once post exactly once", async () => {
      const userId = await newUser();
      const input = { userId, kind: "deposit", amountMicro: 3 * DOLLAR, idempotencyKey: key() } as const;
      const results = await Promise.all(Array.from({ length: 40 }, () => postLedgerEntry(db, input)));
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(new Set(results.map((r) => r.entry.id)).size).toBe(1);
      expect(await entriesOf(userId)).toHaveLength(1);
      await expectConsistent(userId, 3 * DOLLAR);
    });

    it("40 different posts at once to a brand new user all count", async () => {
      const userId = await newUser();
      await Promise.all(Array.from({ length: 40 }, () => postLedgerEntry(db, { userId, kind: "deposit", amountMicro: 1_000, idempotencyKey: key() })));
      expect(await entriesOf(userId)).toHaveLength(40);
      await expectConsistent(userId, 40_000);
    });

    it("debits racing past the balance: only what's affordable goes through, and it never dips below zero", async () => {
      const userId = await funded(5 * DOLLAR);
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => postLedgerEntry(db, { userId, kind: "usage", amountMicro: -DOLLAR, idempotencyKey: key() })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
      const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(refused).toHaveLength(15);
      for (const r of refused) expect(r.reason).toBeInstanceOf(InsufficientBalanceError);
      for (const entry of await entriesOf(userId)) expect(entry.balanceAfterMicro).toBeGreaterThanOrEqual(0);
      await expectConsistent(userId, 0);
    });

    it("two users racing for one key: one wins, and the other is refused rather than crashing", async () => {
      const a = await newUser();
      const b = await newUser();
      const idempotencyKey = key();
      const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => postLedgerEntry(db, { userId: i % 2 ? a : b, kind: "deposit", amountMicro: DOLLAR, idempotencyKey })));
      const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(refused).toHaveLength(5);
      for (const r of refused) expect(r.reason).toBeInstanceOf(IdempotencyConflictError);
      expect((await db.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, idempotencyKey)))).toHaveLength(1);
      expect((await getBalanceMicro(db, a)) + (await getBalanceMicro(db, b))).toBe(DOLLAR);
      expect(await findBalanceMismatches(db)).toEqual([]);
    });

    it("mixed traffic for many users at once leaves every balance matching its entries", async () => {
      const people = await Promise.all(Array.from({ length: 5 }, () => funded(DOLLAR)));
      await Promise.allSettled(
        Array.from({ length: 60 }, (_, i) => {
          const userId = people[i % people.length];
          return i % 3 === 0
            ? postLedgerEntry(db, { userId, kind: "deposit", amountMicro: 700 + i, idempotencyKey: key() })
            : postLedgerEntry(db, { userId, kind: "usage", amountMicro: -(50_000 + i), idempotencyKey: key() });
        }),
      );
      for (const userId of people) await expectConsistent(userId, await balanceFromEntriesMicro(db, userId));
      expect(await findBalanceMismatches(db)).toEqual([]);
    });
  });

  describe("the rule for going below zero (D45)", () => {
    it("refuses by default and writes nothing, not even an empty balance row", async () => {
      const userId = await newUser();
      await expect(postLedgerEntry(db, { userId, kind: "usage", amountMicro: -1, idempotencyKey: key() })).rejects.toBeInstanceOf(InsufficientBalanceError);
      expect(await entriesOf(userId)).toHaveLength(0);
      expect(await db.select().from(balances).where(eq(balances.userId, userId))).toHaveLength(0);
    });

    it("a debit that exactly empties the balance is fine", async () => {
      const userId = await funded(DOLLAR);
      await postLedgerEntry(db, { userId, kind: "usage", amountMicro: -DOLLAR, idempotencyKey: key() });
      await expectConsistent(userId, 0);
    });

    it("a refused key can be used again later, once it can succeed", async () => {
      const userId = await newUser();
      const input = { userId, kind: "usage", amountMicro: -DOLLAR, idempotencyKey: key() } as const;
      await expect(postLedgerEntry(db, input)).rejects.toBeInstanceOf(InsufficientBalanceError);
      await postLedgerEntry(db, { userId, kind: "deposit", amountMicro: DOLLAR, idempotencyKey: key() });
      expect((await postLedgerEntry(db, input)).replayed).toBe(false);
      await expectConsistent(userId, 0);
    });

    it("a chargeback after the credit is spent goes below zero when the caller says so, and it shows on the row", async () => {
      const userId = await funded(DOLLAR);
      await postLedgerEntry(db, { userId, kind: "usage", amountMicro: -DOLLAR, idempotencyKey: key() });
      const { entry, balanceMicro } = await postLedgerEntry(db, { userId, kind: "adjust", amountMicro: -DOLLAR, idempotencyKey: key(), refType: "dispute", refId: "gb_1", allowNegative: true });
      expect(balanceMicro).toBe(-DOLLAR);
      expect(entry.allowNegative).toBe(true);
      await expectConsistent(userId, -DOLLAR);
    });

    it("an AI cost already incurred can go below zero when the caller says so", async () => {
      const userId = await funded(100);
      await postLedgerEntry(db, { userId, kind: "usage", amountMicro: -150, idempotencyKey: key(), allowNegative: true });
      await expectConsistent(userId, -50);
    });

    it("a refund can never go below zero, even when asked", async () => {
      const userId = await funded(100);
      await expect(postLedgerEntry(db, { userId, kind: "refund", amountMicro: -200, idempotencyKey: key(), allowNegative: true })).rejects.toBeInstanceOf(InvalidLedgerEntryError);
      await expectConsistent(userId, 100);
    });

    it("once negative, a further debit is still refused without the flag", async () => {
      const userId = await newUser();
      await postLedgerEntry(db, { userId, kind: "adjust", amountMicro: -100, idempotencyKey: key(), allowNegative: true });
      await expect(postLedgerEntry(db, { userId, kind: "usage", amountMicro: -1, idempotencyKey: key() })).rejects.toBeInstanceOf(InsufficientBalanceError);
      await expectConsistent(userId, -100);
    });

    it("a deposit that only part-repays a negative balance is accepted", async () => {
      const userId = await newUser();
      await postLedgerEntry(db, { userId, kind: "adjust", amountMicro: -100, idempotencyKey: key(), allowNegative: true });
      await postLedgerEntry(db, { userId, kind: "deposit", amountMicro: 40, idempotencyKey: key() });
      await expectConsistent(userId, -60);
    });

    it("the database itself refuses a below-zero row without the flag", async () => {
      const userId = await newUser();
      const message = await failure(
        db.transaction(async (tx) => {
          await tx.insert(balances).values({ userId, balanceMicro: -5 });
          await tx.insert(ledgerEntries).values({ userId, kind: "usage", amountMicro: -5, balanceAfterMicro: -5, idempotencyKey: key() });
        }),
      );
      expect(message).toContain("ledger_entries_negative_check");
    });
  });

  describe("bad input", () => {
    it.each([
      ["zero", "adjust", 0],
      ["a fraction of a micro-dollar", "deposit", 1.5],
      ["not a number", "deposit", NaN],
      ["infinity", "deposit", Infinity],
      ["too big to count exactly", "deposit", Number.MAX_SAFE_INTEGER + 2],
      ["a negative deposit", "deposit", -1],
      ["a positive debit", "usage", 1],
      ["a positive refund", "refund", 1],
    ] as const)("refuses %s", async (_, kind, amountMicro) => {
      const userId = await funded(DOLLAR);
      await expect(postLedgerEntry(db, { userId, kind, amountMicro, idempotencyKey: key() })).rejects.toBeInstanceOf(InvalidLedgerEntryError);
      await expectConsistent(userId, DOLLAR);
    });

    it("refuses an empty key, an oversized key and an unknown kind", async () => {
      const userId = await newUser();
      await expect(postLedgerEntry(db, { userId, kind: "deposit", amountMicro: 1, idempotencyKey: "" })).rejects.toBeInstanceOf(InvalidLedgerEntryError);
      await expect(postLedgerEntry(db, { userId, kind: "deposit", amountMicro: 1, idempotencyKey: "k".repeat(300) })).rejects.toBeInstanceOf(InvalidLedgerEntryError);
      await expect(postLedgerEntry(db, { userId, kind: "gift" as "deposit", amountMicro: 1, idempotencyKey: key() })).rejects.toBeInstanceOf(InvalidLedgerEntryError);
    });

    it("refuses a balance that would be too big to count exactly", async () => {
      const userId = await funded(Number.MAX_SAFE_INTEGER - 1);
      await expect(postLedgerEntry(db, { userId, kind: "deposit", amountMicro: 10, idempotencyKey: key() })).rejects.toBeInstanceOf(InvalidLedgerEntryError);
      await expectConsistent(userId, Number.MAX_SAFE_INTEGER - 1);
    });

    it("an unknown user can't be credited", async () => {
      await expect(postLedgerEntry(db, { userId: randomUUID(), kind: "deposit", amountMicro: 1, idempotencyKey: key() })).rejects.toThrow();
    });
  });

  describe("the database refuses tampering", () => {
    it.each([
      ["update an amount", (id: string) => sql`UPDATE ledger_entries SET amount_micro = 999 WHERE user_id = ${id}`],
      ["update a key", (id: string) => sql`UPDATE ledger_entries SET idempotency_key = 'x' WHERE user_id = ${id}`],
      ["delete an entry", (id: string) => sql`DELETE FROM ledger_entries WHERE user_id = ${id}`],
      ["delete a balance", (id: string) => sql`DELETE FROM balances WHERE user_id = ${id}`],
      ["truncate the ledger", () => sql`TRUNCATE ledger_entries`],
      ["truncate balances", () => sql`TRUNCATE balances`],
      ["truncate users, cascading to the ledger", () => sql`TRUNCATE users CASCADE`],
    ])("can't %s", async (_, statement) => {
      const userId = await funded(DOLLAR);
      expect(await failure(db.execute(statement(userId)))).toMatch(/refused/);
      await expectConsistent(userId, DOLLAR);
      expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(1);
    });

    it("can't change a balance so it no longer matches the entries", async () => {
      const userId = await funded(DOLLAR);
      expect(await failure(db.execute(sql`UPDATE balances SET balance_micro = 999999999 WHERE user_id = ${userId}`))).toMatch(/differs from ledger/);
      await expectConsistent(userId, DOLLAR);
    });

    it("can't add an entry without updating the balance", async () => {
      const userId = await funded(DOLLAR);
      const message = await failure(db.insert(ledgerEntries).values({ userId, kind: "deposit", amountMicro: DOLLAR, balanceAfterMicro: 2 * DOLLAR, idempotencyKey: key() }));
      expect(message).toMatch(/differs from ledger/);
      await expectConsistent(userId, DOLLAR);
    });

    it("can't give someone a balance from nothing", async () => {
      const userId = await newUser();
      expect(await failure(db.insert(balances).values({ userId, balanceMicro: DOLLAR }))).toMatch(/differs from ledger/);
      expect(await getBalanceMicro(db, userId)).toBe(0);
    });

    it("can't insert a row breaking the sign rules, or a duplicate key, directly", async () => {
      const userId = await newUser();
      const row = { userId, balanceAfterMicro: 5 };
      expect(await failure(db.insert(ledgerEntries).values({ ...row, kind: "deposit", amountMicro: -5, idempotencyKey: key() }))).toContain("ledger_entries_kind_sign_check");
      expect(await failure(db.insert(ledgerEntries).values({ ...row, kind: "adjust", amountMicro: 0, idempotencyKey: key() }))).toContain("ledger_entries_kind_sign_check");
      expect(await failure(db.insert(ledgerEntries).values({ ...row, kind: "gift" as "deposit", amountMicro: 5, idempotencyKey: key() }))).toContain("ledger_entries_kind_sign_check");
      expect(await failure(db.insert(ledgerEntries).values({ ...row, kind: "refund", amountMicro: -5, allowNegative: true, idempotencyKey: key() }))).toContain("ledger_entries_allow_negative_check");
      expect(await failure(db.insert(ledgerEntries).values({ ...row, kind: "deposit", amountMicro: 5, idempotencyKey: "" }))).toContain("ledger_entries_key_check");
    });
  });

  describe("transactions", () => {
    it("a rolled-back outer transaction leaves nothing, and the key is free again", async () => {
      const userId = await newUser();
      const input = { userId, kind: "deposit", amountMicro: DOLLAR, idempotencyKey: key() } as const;
      const message = await failure(
        db.transaction(async (tx) => {
          const posted = await postLedgerEntry(tx as unknown as Db, input);
          expect(posted.balanceMicro).toBe(DOLLAR);
          throw new Error("something later in the transaction failed");
        }),
      );
      expect(message).toContain("something later");
      expect(await entriesOf(userId)).toHaveLength(0);
      expect(await db.select().from(balances).where(eq(balances.userId, userId))).toHaveLength(0);
      expect((await postLedgerEntry(db, input)).replayed).toBe(false);
      await expectConsistent(userId, DOLLAR);
    });

    it("a refused entry inside an outer transaction doesn't spoil what's around it", async () => {
      const userId = await newUser();
      await db.transaction(async (tx) => {
        await postLedgerEntry(tx as unknown as Db, { userId, kind: "deposit", amountMicro: 10, idempotencyKey: key() });
        await expect(postLedgerEntry(tx as unknown as Db, { userId, kind: "usage", amountMicro: -11, idempotencyKey: key() })).rejects.toBeInstanceOf(InsufficientBalanceError);
        await postLedgerEntry(tx as unknown as Db, { userId, kind: "usage", amountMicro: -4, idempotencyKey: key() });
      });
      await expectConsistent(userId, 6);
    });

    it("another user's key refused inside an outer transaction doesn't spoil it either", async () => {
      const owner = await newUser();
      const other = await newUser();
      const taken = key();
      await postLedgerEntry(db, { userId: owner, kind: "deposit", amountMicro: 1, idempotencyKey: taken });
      await db.transaction(async (tx) => {
        await expect(postLedgerEntry(tx as unknown as Db, { userId: other, kind: "deposit", amountMicro: 1, idempotencyKey: taken })).rejects.toBeInstanceOf(IdempotencyConflictError);
        await postLedgerEntry(tx as unknown as Db, { userId: other, kind: "deposit", amountMicro: 2, idempotencyKey: key() });
      });
      await expectConsistent(other, 2);
    });
  });

  describe("deleting users and projects doesn't lose money records", () => {
    async function project(ownerId: string) {
      const [p] = await db.insert(projects).values({ ownerId, name: "P", chainId: 11142220 }).returning({ id: projects.id });
      return p.id;
    }

    function usage(userId: string, projectId: string | null) {
      return db.insert(usageEvents).values({ userId, projectId, callId: randomUUID(), model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: 8, chargedMicro: 10, markupBps: 2500 });
    }

    async function job(userId: string, projectId: string, funding: "free" | "paid") {
      const [m] = await db.insert(messages).values({ projectId, role: "user", content: "x" }).returning({ id: messages.id });
      const [j] = await db.insert(turnJobs).values({ userId, projectId, mode: "build", prompt: "x", userMessageId: m.id, funding, status: "done" }).returning({ id: turnJobs.id });
      return j.id;
    }

    it("a user with ledger entries can't be deleted, and everything stays", async () => {
      const userId = await funded(DOLLAR);
      expect(await failure(db.delete(users).where(eq(users.id, userId)))).toMatch(/foreign key|ledger_entries|balances|Failed query/);
      await expectConsistent(userId, DOLLAR);
      expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(1);
    });

    it("a user with only usage rows can't be deleted, so the free total (D29) can't shrink", async () => {
      const userId = await newUser();
      const projectId = await project(userId);
      await usage(userId, projectId);
      await failure(db.delete(users).where(eq(users.id, userId)));
      expect(await db.select().from(usageEvents).where(eq(usageEvents.userId, userId))).toHaveLength(1);
    });

    it("a user with no money records can still be deleted, as today", async () => {
      const userId = await newUser();
      const projectId = await project(userId);
      await job(userId, projectId, "free");
      await db.delete(users).where(eq(users.id, userId));
      expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(0);
      expect(await db.select().from(projects).where(eq(projects.id, projectId))).toHaveLength(0);
    });

    it("deleting a project keeps the ledger and the usage rows with their funding, as today's free jobs go", async () => {
      const userId = await funded(DOLLAR);
      const projectId = await project(userId);
      const jobId = await job(userId, projectId, "free");
      await usage(userId, projectId);
      await db.insert(usageEvents).values({ userId, projectId, callId: randomUUID(), model: "m", inputTokens: 1, outputTokens: 1, providerCostMicro: 8, chargedMicro: 10, markupBps: 2500, funding: "paid" });
      await postLedgerEntry(db, { userId, kind: "usage", amountMicro: -10, idempotencyKey: key(), refType: "project", refId: projectId });

      await db.delete(projects).where(eq(projects.id, projectId));

      expect(await db.select().from(turnJobs).where(eq(turnJobs.id, jobId))).toHaveLength(0);
      const rows = await db.select().from(usageEvents).where(eq(usageEvents.userId, userId));
      expect(rows.map((r) => [r.projectId, r.funding]).sort()).toEqual([
        [null, "free"],
        [null, "paid"],
      ]);
      expect((await entriesOf(userId)).at(-1)?.refId).toBe(projectId);
      await expectConsistent(userId, DOLLAR - 10);
    });

    it("a paid job refuses the delete of its project or its user, and nothing goes", async () => {
      const userId = await newUser();
      const projectId = await project(userId);
      const jobId = await job(userId, projectId, "paid");
      expect(await failure(db.delete(projects).where(eq(projects.id, projectId)))).toMatch(/refused|Failed query/);
      expect(await failure(db.delete(users).where(eq(users.id, userId)))).toMatch(/refused|Failed query/);
      expect(await db.select().from(turnJobs).where(eq(turnJobs.id, jobId))).toHaveLength(1);
      expect(await db.select().from(projects).where(eq(projects.id, projectId))).toHaveLength(1);
    });

    it("clearing an app's data, as a takedown does, touches no money record", async () => {
      const userId = await funded(DOLLAR);
      const projectId = await project(userId);
      await usage(userId, projectId);
      await deleteProjectData(db, projectId);
      expect(await db.select().from(appDataRecords).where(eq(appDataRecords.projectId, projectId))).toHaveLength(0);
      expect(await db.select().from(usageEvents).where(eq(usageEvents.projectId, projectId))).toHaveLength(1);
      await expectConsistent(userId, DOLLAR);
    });
  });

  describe("the balance is derivable from the entries", () => {
    it("a fresh user reads as zero, and reading writes nothing", async () => {
      const userId = await newUser();
      expect(await getBalanceMicro(db, userId)).toBe(0);
      expect(await balanceFromEntriesMicro(db, userId)).toBe(0);
      expect(await db.select().from(balances).where(eq(balances.userId, userId))).toHaveLength(0);
    });

    it("stays equal through a long run of random entries, replays and refusals", async () => {
      const userId = await newUser();
      // Seeded, so a failure here can be reproduced.
      let state = 20_261_106;
      const random = (n: number) => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state % n;
      };
      const used: string[] = [];
      let expected = 0;
      for (let i = 0; i < 200; i++) {
        const roll = random(10);
        if (roll < 4) {
          const amountMicro = 1 + random(1_000_000);
          const idempotencyKey = key();
          await postLedgerEntry(db, { userId, kind: "deposit", amountMicro, idempotencyKey });
          used.push(idempotencyKey);
          expected += amountMicro;
        } else if (roll < 9) {
          const amountMicro = -(1 + random(1_000_000));
          if (expected + amountMicro < 0) {
            await expect(postLedgerEntry(db, { userId, kind: "usage", amountMicro, idempotencyKey: key() })).rejects.toBeInstanceOf(InsufficientBalanceError);
          } else {
            await postLedgerEntry(db, { userId, kind: "usage", amountMicro, idempotencyKey: key() });
            expected += amountMicro;
          }
        } else if (used.length) {
          const idempotencyKey = used[random(used.length)];
          const [original] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, idempotencyKey));
          expect((await postLedgerEntry(db, { userId, kind: original.kind, amountMicro: original.amountMicro, idempotencyKey })).replayed).toBe(true);
        }
      }
      await expectConsistent(userId, expected);
      expect(await findBalanceMismatches(db)).toEqual([]);
    }, 120_000);

    it("the check finds a balance that has really drifted", async () => {
      const userId = await funded(DOLLAR);
      // Only a superuser can do this: it turns the guards off for this one transaction, to prove the check isn't empty.
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = replica`);
        await tx.execute(sql`UPDATE balances SET balance_micro = 7 WHERE user_id = ${userId}`);
      });
      expect(await findBalanceMismatches(db)).toEqual([{ userId, balanceMicro: 7, entriesMicro: DOLLAR }]);
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = replica`);
        await tx.execute(sql`UPDATE balances SET balance_micro = ${DOLLAR} WHERE user_id = ${userId}`);
      });
      expect(await findBalanceMismatches(db)).toEqual([]);
    });
  });
});
