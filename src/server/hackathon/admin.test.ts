// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Address } from "viem";

import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import { getBalanceMicro, postLedgerEntry } from "@/server/credits/ledger";
import { MIGRATIONS, testBackends, type TestDatabase } from "@/server/credits/test-backends";
import type { Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { hackathonParticipants } from "@/server/db/hackathon-schema";
import { expireUnusedCredits, hackathonReport, sweepHackathonExpiry } from "./admin";
import { CLAIMS_CLOSE, START_CREDITS, claimCloseFor, claimHackathon } from "./claim";

// In the past: ledger rows get the database clock, which must fall after these registrations.
const NOW = new Date("2026-11-01T12:00:00Z");
const AFTER = new Date(CLAIMS_CLOSE.getTime() + 60_000);
const C = MICRO_PER_CREDIT;

describe.each(testBackends())("hackathon admin on $name", (backend) => {
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

  const hex = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0").slice(0, 40)}`;

  async function registered(opts: { accountAge?: number } = {}) {
    const createdAt = new Date(NOW.getTime() - (opts.accountAge ?? 86_400_000));
    const [u] = await db.insert(users).values({ wallet: hex(), createdAt }).returning({ id: users.id, wallet: users.wallet });
    const root = hex() as Address;
    await claimHackathon(db, u, { readRoot: async () => root, now: NOW, env: {} });
    return { ...u, root };
  }

  const spend = (userId: string, credits: number) => postLedgerEntry(db, { userId, kind: "usage", amountMicro: -credits * C, idempotencyKey: `t:${randomUUID()}` });
  const buy = (userId: string, credits: number) => postLedgerEntry(db, { userId, kind: "deposit", amountMicro: credits * C, idempotencyKey: `t:${randomUUID()}` });

  it("won't expire before claims close, and the worker's sweep waits too", async () => {
    await expect(expireUnusedCredits(db, NOW)).rejects.toThrow(/after claims close/);
    expect(await sweepHackathonExpiry(async () => db, NOW)).toBeNull();
  });

  it("removes only the unspent grant, never bought credits, and only once", async () => {
    const idle = await registered(); // spent nothing: loses all 20
    const half = await registered(); // spent 5: loses 15
    const buyer = await registered(); // bought 100, spent 30: the grant is used up, keeps 90
    await spend(half.id, 5);
    await buy(buyer.id, 100);
    await spend(buyer.id, 30);

    const result = await expireUnusedCredits(db, AFTER);
    expect(result.skipped).toBe(0);
    expect(await getBalanceMicro(db, idle.id)).toBe(0);
    expect(await getBalanceMicro(db, half.id)).toBe(0);
    expect(await getBalanceMicro(db, buyer.id)).toBe(90 * C);

    const again = await expireUnusedCredits(db, AFTER);
    expect(again.checked).toBe(0);
    expect(await getBalanceMicro(db, buyer.id)).toBe(90 * C);
  });

  it("reports totals, new-wallet flags and refused second claims", async () => {
    const fresh = await registered({ accountAge: 60_000 });
    const [other] = await db.insert(users).values({ wallet: hex() }).returning({ id: users.id, wallet: users.wallet });
    await expect(claimHackathon(db, other, { readRoot: async () => fresh.root, now: NOW, env: {} })).rejects.toMatchObject({ code: "claimed_elsewhere" });

    const r = await hackathonReport(db, NOW, {});
    expect(r.registered).toBeGreaterThanOrEqual(4);
    expect(r.grantedCredits).toBe(r.registered * START_CREDITS);
    expect(r.rows.find((x) => x.root === fresh.root.toLowerCase())).toMatchObject({ freshWallet: true, startCredits: START_CREDITS });
    expect(r.refused).toEqual([expect.objectContaining({ wallet: other.wallet, root: fresh.root.toLowerCase(), code: "claimed_elsewhere" })]);
    expect(r.perDay).toEqual([{ day: "2026-11-01", count: r.registered }]);
    expect(r.closed).toBe(false);
  });

  it("keeps a Kadpoly member's credits, and their claim, open until Kadpoly closes (D166)", async () => {
    const KADPOLY_CLOSE = new Date("2026-12-31T23:00:00Z");
    const member = await registered();
    await db.insert(hackathonParticipants).values({ hackathon: "kadpoly-2026", userId: member.id, email: "k@example.com" });
    const mainOnly = await registered();
    expect(await claimCloseFor(db, member.id)).toEqual(KADPOLY_CLOSE);
    expect(await claimCloseFor(db, mainOnly.id)).toEqual(CLAIMS_CLOSE);

    // 11 Dec: main closed, Kadpoly still open. The member waits; the main-only builder is expired.
    const midway = await expireUnusedCredits(db, AFTER);
    expect(midway.waiting).toBeGreaterThanOrEqual(1);
    expect(await getBalanceMicro(db, member.id)).toBe(START_CREDITS * C);
    expect(await getBalanceMicro(db, mainOnly.id)).toBe(0);

    // A new Kadpoly member can still claim after 10 Dec; a main-only newcomer can't.
    const [late] = await db.insert(users).values({ wallet: hex() }).returning({ id: users.id, wallet: users.wallet });
    await db.insert(hackathonParticipants).values({ hackathon: "kadpoly-2026", userId: late.id, email: "late@example.com" });
    await expect(claimHackathon(db, late, { readRoot: async () => hex() as Address, now: AFTER, env: {} })).resolves.toMatchObject({ registered: true });
    const [stranger] = await db.insert(users).values({ wallet: hex() }).returning({ id: users.id, wallet: users.wallet });
    await expect(claimHackathon(db, stranger, { readRoot: async () => hex() as Address, now: AFTER, env: {} })).rejects.toMatchObject({ code: "closed" });
    await expect(claimHackathon(db, late, { readRoot: async () => hex() as Address, now: KADPOLY_CLOSE, env: {} })).rejects.toMatchObject({ code: "closed" });

    // After Kadpoly closes, the member's unspent grant goes too.
    await expireUnusedCredits(db, new Date(KADPOLY_CLOSE.getTime() + 60_000));
    expect(await getBalanceMicro(db, member.id)).toBe(0);
  });
});
