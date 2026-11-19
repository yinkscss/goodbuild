// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import { MAX_PAID_REFERRALS, REFERRAL_BONUS_CREDITS } from "@/lib/referral";
import { getBalanceMicro } from "@/server/credits/ledger";
import { MIGRATIONS, testBackends, type TestDatabase } from "@/server/credits/test-backends";
import type { Db } from "@/server/db/client";
import { flowstateVoters, hackathonReferrals } from "@/server/db/hackathon-schema";
import { referrals } from "@/server/db/referral-schema";
import { users } from "@/server/db/schema";
import { attributeInvite, ensureInviteCode, hasUnsettledInvite, inviteSummary, settleInviteOnVote } from "./referrals";

const credits = (micro: number) => micro / MICRO_PER_CREDIT;

describe.each(testBackends())("invites on $name", (backend) => {
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
  async function person(verified = true) {
    const root = hex();
    const [u] = await db.insert(users).values({ wallet: hex(), goodidRoot: verified ? root : null }).returning({ id: users.id });
    return { id: u.id, root };
  }
  const bal = async (id: string) => credits(await getBalanceMicro(db, id));
  const env = {};

  it("makes one stable random code per person", async () => {
    const a = await person();
    const code = await ensureInviteCode(db, a.id);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(await ensureInviteCode(db, a.id)).toBe(code);
    expect(await ensureInviteCode(db, randomUUID())).toBeNull();
    // No code until verified with GoodDollar.
    const unverified = await person(false);
    expect(await ensureInviteCode(db, unverified.id)).toBeNull();
    expect(await inviteSummary(db, unverified.id)).toBeNull();
  });

  it("pays both sides when the invited person's vote lands, once", async () => {
    const a = await person();
    const b = await person();
    const code = (await ensureInviteCode(db, a.id))!;
    expect(await attributeInvite(db, { code, refereeUserId: b.id })).toEqual({ recorded: true });
    expect(await hasUnsettledInvite(db, b.id)).toBe(true);
    expect(await bal(b.id)).toBe(0);
    await settleInviteOnVote(db, { userId: b.id, root: b.root, env });
    await settleInviteOnVote(db, { userId: b.id, root: b.root, env });
    await Promise.all([settleInviteOnVote(db, { userId: b.id, root: b.root, env }), settleInviteOnVote(db, { userId: b.id, root: b.root, env })]);
    expect(await bal(b.id)).toBe(REFERRAL_BONUS_CREDITS);
    expect(await bal(a.id)).toBe(REFERRAL_BONUS_CREDITS);
    expect(await hasUnsettledInvite(db, b.id)).toBe(false);
    expect(await inviteSummary(db, a.id)).toMatchObject({ invited: 1, voted: 1, earnedCredits: REFERRAL_BONUS_CREDITS });
  });

  it("ignores bad, unknown and own codes, and people who already voted", async () => {
    const a = await person();
    const code = (await ensureInviteCode(db, a.id))!;
    expect((await attributeInvite(db, { code: "nope", refereeUserId: a.id })).recorded).toBe(false);
    expect((await attributeInvite(db, { code: "ZZZZZZZZ", refereeUserId: a.id })).recorded).toBe(false);
    expect((await attributeInvite(db, { code, refereeUserId: a.id })).recorded).toBe(false);
    expect((await attributeInvite(db, { code: 42, refereeUserId: a.id })).recorded).toBe(false);
    const voter = await person();
    await db.insert(flowstateVoters).values({ userId: voter.id, votedAt: new Date() });
    expect((await attributeInvite(db, { code, refereeUserId: voter.id })).recorded).toBe(false);
    // Invited once: a second link from someone else doesn't take over.
    const other = await person();
    const otherCode = (await ensureInviteCode(db, other.id))!;
    const b = await person();
    expect((await attributeInvite(db, { code, refereeUserId: b.id })).recorded).toBe(true);
    expect((await attributeInvite(db, { code: otherCode, refereeUserId: b.id })).recorded).toBe(false);
  });

  it("pays nobody when the inviter isn't verified or is the same identity (no inviting yourself)", async () => {
    // A code can only come from a verified person, so make a code and then take the verification away.
    const spare = await person();
    const code = (await ensureInviteCode(db, spare.id))!;
    await db.update(users).set({ goodidRoot: null }).where(eq(users.id, spare.id));
    const b = await person();
    await attributeInvite(db, { code, refereeUserId: b.id });
    await settleInviteOnVote(db, { userId: b.id, root: b.root, env });
    expect(await bal(b.id)).toBe(0);
    expect(await bal(spare.id)).toBe(0);

    const a = await person();
    const code2 = (await ensureInviteCode(db, a.id))!;
    const twin = await person();
    await attributeInvite(db, { code: code2, refereeUserId: twin.id });
    await settleInviteOnVote(db, { userId: twin.id, root: a.root, env });
    expect(await bal(twin.id)).toBe(0);
    expect(await bal(a.id)).toBe(0);
  });

  it("doesn't also invite someone the hackathon link (D136) already invited", async () => {
    const a = await person();
    const code = (await ensureInviteCode(db, a.id))!;
    const b = await person();
    await db.insert(hackathonReferrals).values({ hackathon: "million-2027", referrerUserId: a.id, refereeUserId: b.id, refereeRoot: b.root });
    expect((await attributeInvite(db, { code, refereeUserId: b.id })).recorded).toBe(false);
    // Same identity under a second account: attributed, but never paid.
    const c = await person();
    await attributeInvite(db, { code, refereeUserId: c.id });
    await settleInviteOnVote(db, { userId: c.id, root: b.root, env });
    expect(await bal(c.id)).toBe(0);
  });

  it("pays an inviter for at most three friends, and one account per identity", async () => {
    const a = await person();
    const code = (await ensureInviteCode(db, a.id))!;
    for (let i = 0; i < MAX_PAID_REFERRALS + 1; i++) {
      const f = await person();
      await attributeInvite(db, { code, refereeUserId: f.id });
      await settleInviteOnVote(db, { userId: f.id, root: f.root, env });
      expect(await bal(f.id)).toBe(REFERRAL_BONUS_CREDITS);
    }
    expect(await bal(a.id)).toBe(MAX_PAID_REFERRALS * REFERRAL_BONUS_CREDITS);
    // A second account behind a friend's identity gets nothing.
    const f = await person();
    await attributeInvite(db, { code, refereeUserId: f.id });
    await settleInviteOnVote(db, { userId: f.id, root: f.root, env });
    const dup = await person();
    await attributeInvite(db, { code, refereeUserId: dup.id });
    await settleInviteOnVote(db, { userId: dup.id, root: f.root, env });
    expect(await bal(dup.id)).toBe(0);
  });

  it("holds the bonus when the referral pot can't cover both sides, then pays later", async () => {
    const a = await person();
    const code = (await ensureInviteCode(db, a.id))!;
    const b = await person();
    await attributeInvite(db, { code, refereeUserId: b.id });
    await settleInviteOnVote(db, { userId: b.id, root: b.root, env: { HACKATHON_REFERRAL_BUDGET_CREDITS: "0" } });
    expect(await bal(b.id)).toBe(0);
    expect(await bal(a.id)).toBe(0);
    expect(await hasUnsettledInvite(db, b.id)).toBe(true);
    await settleInviteOnVote(db, { userId: b.id, root: b.root, env });
    expect(await bal(b.id)).toBe(REFERRAL_BONUS_CREDITS);
    expect(await bal(a.id)).toBe(REFERRAL_BONUS_CREDITS);
    const [row] = await db.select().from(referrals).where(eq(referrals.refereeUserId, b.id));
    expect(row.settledAt).not.toBeNull();
  });
});
