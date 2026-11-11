// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { contractUpgrades, deployments } from "@/server/db/deploy-schema";
import { onchainCreditEvents } from "@/server/db/onchain-credits-schema";
import { publications } from "@/server/db/publish-schema";
import { users } from "@/server/db/schema";
import { createProjectFromPrompt } from "@/server/projects";
import { SIGNUP_WEEKS, loadPublicStats, weekStartUtc } from "./public-stats";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const yes = { ageOk: true, notUsPerson: true };
const NOW = new Date("2026-11-11T12:00:00Z");
const MAINNET = 42220;
const SEPOLIA = 11142220;
const hex = (n: number, len: number) => `0x${n.toString(16).padStart(len, "0")}`;

async function deploy(userId: string, projectId: string, n: number, chainId: number, extra: Partial<typeof deployments.$inferInsert> = {}) {
  await db.insert(deployments).values({
    projectId,
    userId,
    version: 1,
    runId: `run-${n}`,
    chainId,
    contractName: `C${n}`,
    address: hex(n, 40),
    deployer: "0x00000000000000000000000000000000deadbeef",
    txHash: hex(n, 64),
    blockNumber: n,
    compilerVersion: "0.8.28",
    evmVersion: "cancun",
    sourceHash: "0x00",
    abi: [],
    ...extra,
  });
}

describe("public stats", () => {
  it("weeks start on Monday, UTC", () => {
    expect(weekStartUtc(new Date("2026-11-11T12:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStartUtc(new Date("2026-11-09T00:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStartUtc(new Date("2026-11-08T23:59:00Z")).toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("counts users, builds, live apps and mainnet facts, and leaves out testnet, takedowns and wallets", async () => {
    const a = await signInUser(db, { wallet: "0xaaaa", walletKind: "external", attestation: yes }, NOW);
    const b = await signInUser(db, { wallet: "0xbbbb", walletKind: "external", attestation: yes }, NOW);
    const old = await signInUser(db, { wallet: "0xcccc", walletKind: "external", attestation: yes }, NOW);
    await db.update(users).set({ createdAt: new Date("2026-01-01T00:00:00Z"), lastSeenAt: new Date("2026-01-01T00:00:00Z") }).where(eqId(old.id));
    await db.update(users).set({ verifiedAt: NOW }).where(eqId(a.id));

    const p1 = await createProjectFromPrompt(db, a.id, { prompt: "Tip jar", network: "celo" });
    const p2 = await createProjectFromPrompt(db, b.id, { prompt: "Savings circle", network: "celo" });
    const p3 = await createProjectFromPrompt(db, b.id, { prompt: "Taken down app", network: "celo" });

    // Behind a proxy: two deploy transactions (code, then proxy).
    await deploy(a.id, p1.id, 1, MAINNET, { verifyStatus: "verified", proxy: { implementation: hex(7, 40), implementationTx: hex(600, 64), admin: hex(9, 40), codeHash: "0x00", layout: null } });
    await deploy(a.id, p1.id, 2, MAINNET);
    await deploy(b.id, p2.id, 3, SEPOLIA, { verifyStatus: "verified" });

    const [proxy] = await db.select({ id: deployments.id }).from(deployments).where(eq(deployments.address, hex(1, 40)));
    await db.insert(contractUpgrades).values({
      deploymentId: proxy.id,
      chainId: MAINNET,
      txHash: hex(500, 64),
      fromImplementation: hex(7, 40),
      toImplementation: hex(8, 40),
      implementationTx: hex(501, 64),
      version: 2,
      sourceHash: "0x00",
    });

    await db.insert(onchainCreditEvents).values([
      { chainId: MAINNET, txHash: hex(700, 64), logIndex: 0, blockNumber: 1, wallet: "0xaaaa", amountMicro: 1_000_000 },
      { chainId: MAINNET, txHash: hex(701, 64), logIndex: 0, blockNumber: 2, wallet: "0xbbbb", amountMicro: 1_000_000 },
      { chainId: SEPOLIA, txHash: hex(702, 64), logIndex: 0, blockNumber: 3, wallet: "0xbbbb", amountMicro: 1_000_000 },
    ]);

    await db.insert(publications).values([
      { projectId: p1.id, slug: "tip-jar", versionNumber: 1 },
      { projectId: p2.id, slug: "circle", versionNumber: 1, unpublishedAt: NOW },
      { projectId: p3.id, slug: "gone", versionNumber: 1, disabledAt: NOW },
    ]);

    const s = await loadPublicStats(db, NOW);

    expect(s.users).toEqual({ total: 3, newLast7Days: 2, newLast30Days: 2, signedInLast7Days: 2, signedInLast30Days: 2, goodIdVerified: 1 });
    expect(s.signupsByWeek).toHaveLength(SIGNUP_WEEKS);
    expect(s.signupsByWeek.at(-1)).toEqual({ weekStart: "2026-11-09", signups: 2 });
    expect(s.builds.projects).toBe(3);
    expect(s.apps.live).toBe(1);
    expect(s.liveApps.map((x) => x.slug)).toEqual(["tip-jar"]);

    expect(s.mainnet.contracts).toBe(2);
    expect(s.mainnet.contractsSourceChecked).toBe(1);
    expect(s.mainnet.transactions).toEqual({ total: 3 + 2 + 2, deploys: 3, upgrades: 2, creditPurchases: 2 });
    expect(s.contracts.map((c) => c.address).sort()).toEqual([hex(1, 40), hex(2, 40)]);

    const json = JSON.stringify(s).toLowerCase();
    for (const secret of ["0xaaaa", "0xbbbb", "0xcccc", "deadbeef", a.id, b.id, "taken down app", "gone"]) expect(json).not.toContain(secret.toLowerCase());
  });

  it("works on an empty database", async () => {
    const s = await loadPublicStats(db, NOW);
    expect(s.users.total).toBe(0);
    expect(s.mainnet.transactions.total).toBe(0);
    expect(s.contracts).toEqual([]);
    expect(s.signupsByWeek.every((w) => w.signups === 0)).toBe(true);
  });
});

function eqId(id: string) {
  return eq(users.id, id);
}
