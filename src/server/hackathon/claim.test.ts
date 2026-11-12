// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Address } from "viem";

import { MICRO_PER_CREDIT } from "@/lib/credits-math";
import { getBalanceMicro } from "@/server/credits/ledger";
import { MIGRATIONS, testBackends, type TestDatabase } from "@/server/credits/test-backends";
import type { Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { hackathonRegistrations } from "@/server/db/hackathon-schema";
import { projects, users } from "@/server/db/schema";
import { CLAIMS_CLOSE, DEPLOY_CREDITS, START_CREDITS, claimHackathon, hackathonStatus } from "./claim";

const NOW = new Date("2026-12-10T12:00:00Z");
const credits = (micro: number) => micro / MICRO_PER_CREDIT;

describe.each(testBackends())("hackathon claims on $name", (backend) => {
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
  const root = () => wallet() as Address;

  async function newUser() {
    const [u] = await db.insert(users).values({ wallet: wallet() }).returning({ id: users.id, wallet: users.wallet });
    return u;
  }

  async function deploy(userId: string, chainId = 42220, at = new Date(NOW.getTime() + 60_000)) {
    const [p] = await db.insert(projects).values({ ownerId: userId, name: "P", chainId }).returning({ id: projects.id });
    await db.insert(deployments).values({ projectId: p.id, userId, version: 1, runId: "r", chainId, contractName: "C", address: wallet(), deployer: wallet(), txHash: `0x${randomUUID()}`, blockNumber: 1, compilerVersion: "0.8.28", evmVersion: "cancun", sourceHash: "h", abi: [], createdAt: at });
  }

  const deps = (r: Address | null, env: Record<string, string | undefined> = {}, now = NOW) => ({ readRoot: async () => r, env, now });

  it("refuses a wallet the chain says isn't verified", async () => {
    const u = await newUser();
    await expect(claimHackathon(db, u, deps(null))).rejects.toMatchObject({ code: "not_verified" });
    expect(await getBalanceMicro(db, u.id)).toBe(0);
  });

  it("pays the first part once, however often it's called", async () => {
    const u = await newUser();
    const r = root();
    const first = await claimHackathon(db, u, deps(r));
    expect(first).toEqual({ registered: true, startCredits: START_CREDITS, deployCredits: 0, deployPending: true });
    await claimHackathon(db, u, deps(r));
    expect(credits(await getBalanceMicro(db, u.id))).toBe(START_CREDITS);
    const [row] = await db.select({ root: users.goodidRoot, at: users.verifiedAt }).from(users).where(eq(users.id, u.id));
    expect(row.root).toBe(r.toLowerCase());
    expect(row.at).not.toBeNull();
  });

  it("refuses a second account with the same GoodDollar root", async () => {
    const r = root();
    const a = await newUser();
    const b = await newUser();
    await claimHackathon(db, a, deps(r));
    await expect(claimHackathon(db, b, deps(r))).rejects.toMatchObject({ code: "claimed_elsewhere" });
    expect(await getBalanceMicro(db, b.id)).toBe(0);
  });

  it("pays the second part only after a Celo deploy made after registering", async () => {
    const u = await newUser();
    const r = root();
    await deploy(u.id, 42220, new Date(NOW.getTime() - 60_000)); // before registering: doesn't count
    await claimHackathon(db, u, deps(r));
    expect((await hackathonStatus(db, u.id)).deployPending).toBe(true);
    await deploy(u.id, 1); // not Celo: doesn't count
    await claimHackathon(db, u, deps(r));
    expect((await hackathonStatus(db, u.id)).deployPending).toBe(true);
    await deploy(u.id, 11142220);
    const s = await claimHackathon(db, u, deps(r));
    expect(s).toMatchObject({ deployCredits: DEPLOY_CREDITS, deployPending: false });
    await claimHackathon(db, u, deps(r));
    expect(credits(await getBalanceMicro(db, u.id))).toBe(START_CREDITS + DEPLOY_CREDITS);
  });

  it("stops at the budget, and after the deadline, and when switched off", async () => {
    // Everything granted so far counts against the budget, so set it to exactly what's been given.
    const u = await newUser();
    await claimHackathon(db, u, deps(root()));
    const total = await db.select().from(hackathonRegistrations);
    const given = total.reduce((s, row) => s + row.startMicro + row.deployMicro, 0) / MICRO_PER_CREDIT;
    const v = await newUser();
    await expect(claimHackathon(db, v, deps(root(), { HACKATHON_BUDGET_CREDITS: String(given) }))).rejects.toMatchObject({ code: "budget_spent" });
    await expect(claimHackathon(db, v, deps(root(), {}, CLAIMS_CLOSE))).rejects.toMatchObject({ code: "closed" });
    await expect(claimHackathon(db, v, deps(root(), { HACKATHON_CLAIMS: "off" }))).rejects.toMatchObject({ code: "off" });
    expect(await getBalanceMicro(db, v.id)).toBe(0);
  });
});
