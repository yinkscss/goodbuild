// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Address } from "viem";

import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import { MAX_PAID_REFERRALS, REFERRAL_BONUS_CREDITS } from "@/lib/hackathon-referral";
import { getBalanceMicro } from "@/server/credits/ledger";
import { MIGRATIONS, testBackends, type TestDatabase } from "@/server/credits/test-backends";
import type { Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { hackathonReferrals } from "@/server/db/hackathon-schema";
import { projects, users } from "@/server/db/schema";
import { CLAIMS_CLOSE, START_CREDITS, claimHackathon, hackathonStatus } from "./claim";
import { ensureReferralCode, referralSummary } from "./referrals";

const NOW = new Date("2026-12-01T12:00:00Z");
const credits = (micro: number) => micro / MICRO_PER_CREDIT;

describe.each(testBackends())("hackathon referrals on $name", (backend) => {
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

  const wallet = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0").slice(0, 40)}`;
  const deps = (r: Address, ref?: unknown, env: Record<string, string | undefined> = {}, now = NOW) => ({ readRoot: async () => r, ref, env, now });

  async function builder(ref?: unknown, env: Record<string, string | undefined> = {}) {
    const [u] = await db.insert(users).values({ wallet: wallet() }).returning({ id: users.id, wallet: users.wallet });
    const root = wallet() as Address;
    await claimHackathon(db, u, deps(root, ref, env));
    return { ...u, root };
  }
  async function deploy(userId: string) {
    const [p] = await db.insert(projects).values({ ownerId: userId, name: "P", chainId: 42220 }).returning({ id: projects.id });
    await db.insert(deployments).values({ projectId: p.id, userId, version: 1, runId: "r", chainId: 42220, contractName: "C", address: wallet(), deployer: wallet(), txHash: `0x${randomUUID()}`, blockNumber: 1, compilerVersion: "0.8.28", evmVersion: "cancun", sourceHash: "h", abi: [], createdAt: new Date(NOW.getTime() + 60_000) });
  }
  const bal = async (id: string) => credits(await getBalanceMicro(db, id));

  it("makes one stable code per registered builder and none for others", async () => {
    const a = await builder();
    const code = await ensureReferralCode(db, a.id);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(await ensureReferralCode(db, a.id)).toBe(code);
    const [stranger] = await db.insert(users).values({ wallet: wallet() }).returning({ id: users.id });
    expect(await ensureReferralCode(db, stranger.id)).toBeNull();
  });

  it("pays both sides once the invited builder deploys, and only once", async () => {
    const a = await builder();
    const code = (await ensureReferralCode(db, a.id))!;
    const b = await builder(code);
    expect(await bal(b.id)).toBe(START_CREDITS);
    expect(await bal(a.id)).toBe(START_CREDITS);
    await deploy(b.id);
    await claimHackathon(db, b, deps(b.root));
    await claimHackathon(db, b, deps(b.root));
    await Promise.all([claimHackathon(db, b, deps(b.root)), claimHackathon(db, b, deps(b.root))]);
    expect(await bal(b.id)).toBe(START_CREDITS + 30 + REFERRAL_BONUS_CREDITS);
    expect(await bal(a.id)).toBe(START_CREDITS + REFERRAL_BONUS_CREDITS);
    expect(await referralSummary(db, a.id)).toMatchObject({ invited: 1, earned: 1, waiting: 0 });
  });

  it("ignores empty, malformed, unknown, self and same-identity codes", async () => {
    const a = await builder();
    const code = (await ensureReferralCode(db, a.id))!;
    for (const bad of [undefined, null, "", 42, {}, "abc", "!!!!!!!!", "ZZZZZZZZ", `${code}x`]) await builder(bad);
    // Same GoodDollar identity under another account.
    const [twin] = await db.insert(users).values({ wallet: wallet() }).returning({ id: users.id, wallet: users.wallet });
    await expect(claimHackathon(db, twin, deps(a.root, code))).rejects.toBeTruthy();
    const rows = await db.select().from(hackathonReferrals).where(eq(hackathonReferrals.referrerUserId, a.id));
    expect(rows).toHaveLength(0);
  });

  it("gives an already-registered account arriving with a code nothing", async () => {
    const a = await builder();
    const b = await builder();
    await claimHackathon(db, b, deps(b.root, await ensureReferralCode(db, a.id)));
    await deploy(b.id);
    await claimHackathon(db, b, deps(b.root, await ensureReferralCode(db, a.id)));
    expect(await bal(a.id)).toBe(START_CREDITS);
    expect(await bal(b.id)).toBe(START_CREDITS + 30);
  });

  it("stops paying the inviter at the cap but still pays the invited builder", async () => {
    const a = await builder();
    const code = (await ensureReferralCode(db, a.id))!;
    for (let i = 0; i < MAX_PAID_REFERRALS + 1; i++) {
      const b = await builder(code);
      await deploy(b.id);
      await claimHackathon(db, b, deps(b.root));
      expect(await bal(b.id)).toBe(START_CREDITS + 30 + REFERRAL_BONUS_CREDITS);
    }
    expect(await bal(a.id)).toBe(START_CREDITS + MAX_PAID_REFERRALS * REFERRAL_BONUS_CREDITS);
  });

  it("holds a referral when its own pot is short and pays it on a later claim", async () => {
    const a = await builder();
    const code = (await ensureReferralCode(db, a.id))!;
    const b = await builder(code);
    await deploy(b.id);
    const tight = { HACKATHON_REFERRAL_BUDGET_CREDITS: "0" };
    await claimHackathon(db, b, deps(b.root, undefined, tight));
    expect(await bal(b.id)).toBe(START_CREDITS + 30);
    expect(await referralSummary(db, a.id)).toMatchObject({ waiting: 1, earned: 0 });
    await claimHackathon(db, b, deps(b.root));
    expect(await bal(b.id)).toBe(START_CREDITS + 30 + REFERRAL_BONUS_CREDITS);
    expect(await bal(a.id)).toBe(START_CREDITS + REFERRAL_BONUS_CREDITS);
  });

  it("keeps a half-covered referral whole: neither side is paid until both can be", async () => {
    const a = await builder();
    const b = await builder(await ensureReferralCode(db, a.id));
    await deploy(b.id);
    await claimHackathon(db, b, deps(b.root, undefined, { HACKATHON_REFERRAL_BUDGET_CREDITS: String(REFERRAL_BONUS_CREDITS) }));
    expect(await bal(b.id)).toBe(START_CREDITS + 30);
    expect((await hackathonStatus(db, b.id)).referralPending).toBe(true);
    await claimHackathon(db, b, deps(b.root));
    expect(await bal(a.id)).toBe(START_CREDITS + REFERRAL_BONUS_CREDITS);
    expect((await hackathonStatus(db, b.id)).referralPending).toBeUndefined();
  });

  it("pays nothing after the hackathon closes", async () => {
    const a = await builder();
    const b = await builder(await ensureReferralCode(db, a.id));
    await deploy(b.id);
    await expect(claimHackathon(db, b, deps(b.root, undefined, {}, CLAIMS_CLOSE))).rejects.toMatchObject({ code: "closed" });
    expect(await bal(a.id)).toBe(START_CREDITS);
  });
});
