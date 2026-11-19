// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { keccak256, parseTransaction, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createTestDb, type Db } from "@/server/db/client";
import { gasGrants } from "@/server/db/gas-grant-schema";
import { balances, ledgerEntries, users } from "@/server/db/schema";
import { appSettings } from "@/server/db/settings-schema";
import { DEPLOY_DAY_BUDGET_WEI, DEPLOY_GRANTS_PER_DAY, DEPLOY_GRANTS_PER_DAY_BUYER, DEPLOY_MAX_WEI, estimateDeployFeeWei, sponsorDeployFee, type DeployFeePlan } from "./deploy-grant";
import { ensureGas, GRANT_TARGET_WEI, type GrantChain, type GrantDeps } from "./grant";

// A throwaway key that only ever signs in this test. It never touches a network.
const gasAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const FEE = BigInt(400_000_000_000); // 400 gwei cap

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const addr = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}` as Address;
async function newUser() {
  const [u] = await db.insert(users).values({ wallet: addr() }).returning();
  return u;
}

function fakeChain(opts: { verified?: boolean; gasBalance?: bigint } = {}) {
  const balances = new Map<string, bigint>();
  balances.set(gasAccount.address.toLowerCase(), opts.gasBalance ?? BigInt("500000000000000000000"));
  const mined = new Map<string, "success" | "reverted">();
  let nonce = 0;
  const chain: GrantChain = {
    readRoot: vi.fn(async (w: Address) => (opts.verified === false ? null : w)) as GrantChain["readRoot"],
    getBalance: vi.fn(async (a: Address) => balances.get(a.toLowerCase()) ?? BigInt(0)),
    pendingNonce: vi.fn(async () => nonce),
    fees: vi.fn(async () => ({ maxFeePerGas: FEE, maxPriorityFeePerGas: BigInt(2_500_000_000) })),
    sendRaw: vi.fn(async (raw: Hex) => {
      const tx = parseTransaction(raw);
      if (mined.has(keccak256(raw)) || (tx.nonce ?? 0) !== nonce) return;
      mined.set(keccak256(raw), "success");
      nonce += 1;
      const to = tx.to!.toLowerCase();
      balances.set(to, (balances.get(to) ?? BigInt(0)) + (tx.value ?? BigInt(0)));
    }),
    receipt: vi.fn(async (hash: Hex) => mined.get(hash) ?? null),
  };
  return { chain, balances };
}
/** One ledger row, written directly: this module must not import the credits code (see grant.test.ts). */
async function ledgerRow(userId: string, kind: "deposit" | "adjust", refType: string) {
  await db.transaction(async (tx) => {
    await tx.insert(balances).values({ userId, balanceMicro: 1_000_000 });
    await tx.insert(ledgerEntries).values({ userId, kind, amountMicro: 1_000_000, balanceAfterMicro: 1_000_000, idempotencyKey: `${refType}:${randomUUID()}`, refType });
  });
}
const deps = (chain: GrantChain, extra: Partial<GrantDeps> = {}): GrantDeps => ({ chain, signer: gasAccount, alert: vi.fn(async () => {}), sleep: async () => {}, waitMs: 5, ...extra });

const plan = (over: Partial<DeployFeePlan> = {}): DeployFeePlan => ({
  projectId: randomUUID(),
  chainId: 42220,
  sourceHash: randomUUID(),
  steps: [{ name: "TipJar", bytecodeBytes: 2_000 }],
  alreadyDeployed: {},
  ...over,
});

it("estimates only the contracts still to deploy, and adds the proxy of a first upgradeable deploy", () => {
  const one = estimateDeployFeeWei(plan(), FEE);
  const two = estimateDeployFeeWei(plan({ steps: [{ name: "A", bytecodeBytes: 2_000 }, { name: "B", bytecodeBytes: 2_000 }] }), FEE);
  const reused = estimateDeployFeeWei(plan({ steps: [{ name: "A", bytecodeBytes: 2_000 }, { name: "B", bytecodeBytes: 2_000 }], alreadyDeployed: { B: "0x1" } }), FEE);
  const proxied = estimateDeployFeeWei(plan({ steps: [{ name: "A", bytecodeBytes: 2_000, upgradeable: { kind: "first", proxyBytecode: `0x${"00".repeat(500)}` } }] }), FEE);
  expect(two).toBe(one * BigInt(2));
  expect(reused).toBe(one);
  expect(proxied).toBeGreaterThan(one);
  // A 2 kB contract measured 479k gas at 200 gwei in MAINNET_PLAN; this has to be above that at 400 gwei.
  expect(one).toBeGreaterThan(BigInt(479_062) * FEE);
});

it("tops a verified wallet up to the estimate, and the person keeps signing the deploy themselves", async () => {
  const f = fakeChain();
  const u = await newUser();
  const p = plan();
  expect(await sponsorDeployFee(db, u, p, deps(f.chain))).toBe("granted");
  expect(f.balances.get(u.wallet.toLowerCase())).toBe(estimateDeployFeeWei(p, FEE));
  const [row] = await db.select().from(gasGrants);
  expect(row.reason).toBe("deploy");
  expect(row.status).toBe("confirmed");
  expect(row.planKey).toContain(p.sourceHash);
});

it("sends nothing when the wallet already has enough, on Sepolia, or when everything is deployed", async () => {
  const f = fakeChain();
  const u = await newUser();
  const p = plan();
  f.balances.set(u.wallet.toLowerCase(), estimateDeployFeeWei(p, FEE));
  expect(await sponsorDeployFee(db, u, p, deps(f.chain))).toBe("enough");
  expect(await sponsorDeployFee(db, u, plan({ chainId: 11142220 }), deps(f.chain))).toBe("skipped");
  expect(await sponsorDeployFee(db, u, plan({ alreadyDeployed: { TipJar: "0x1" } }), deps(f.chain))).toBe("skipped");
  expect(await db.select().from(gasGrants)).toHaveLength(0);
});

it("never throws and sends nothing for the unverified, with no key, with the switch off, or above the ceiling", async () => {
  const u = await newUser();
  expect(await sponsorDeployFee(db, u, plan(), deps(fakeChain({ verified: false }).chain))).toBe("skipped");
  expect(await sponsorDeployFee(db, u, plan(), deps(fakeChain().chain, { signer: null }))).toBe("skipped");
  const huge = plan({ steps: [{ name: "Big", bytecodeBytes: 24_576 }, { name: "Big2", bytecodeBytes: 24_576 }] });
  expect(estimateDeployFeeWei(huge, FEE)).toBeGreaterThan(DEPLOY_MAX_WEI);
  expect(await sponsorDeployFee(db, u, huge, deps(fakeChain().chain))).toBe("skipped");
  await db.insert(appSettings).values({ key: "gas_deploy_grants", value: "off" });
  expect(await sponsorDeployFee(db, u, plan(), deps(fakeChain().chain))).toBe("skipped");
  expect(await db.select().from(gasGrants)).toHaveLength(0);
});

it("the global gas switch also stops deploy top-ups", async () => {
  await db.insert(appSettings).values({ key: "gas_grants", value: "off" });
  expect(await sponsorDeployFee(db, await newUser(), plan(), deps(fakeChain().chain))).toBe("skipped");
});

it("preparing the same plan again the same day does not pay twice", async () => {
  const f = fakeChain();
  const u = await newUser();
  const p = plan();
  expect(await sponsorDeployFee(db, u, p, deps(f.chain))).toBe("granted");
  f.balances.set(u.wallet.toLowerCase(), BigInt(0)); // spent, say, on a failed attempt
  expect(await sponsorDeployFee(db, u, p, deps(f.chain))).toBe("skipped");
  expect(await db.select().from(gasGrants)).toHaveLength(1);
});

it("covers 3 deploys a day for most people, then resets at midnight UTC without accumulating", async () => {
  const f = fakeChain();
  const u = await newUser();
  const day1 = new Date("2026-11-19T10:00:00Z");
  for (let i = 0; i < DEPLOY_GRANTS_PER_DAY; i++) {
    f.balances.set(u.wallet.toLowerCase(), BigInt(0));
    expect(await sponsorDeployFee(db, u, plan(), deps(f.chain), day1)).toBe("granted");
  }
  f.balances.set(u.wallet.toLowerCase(), BigInt(0));
  expect(await sponsorDeployFee(db, u, plan(), deps(f.chain), day1)).toBe("skipped");
  // Next day: three more, and not 3 + 3 unused ones. A person who skipped a day gets the same three.
  const day3 = new Date("2026-11-21T00:00:01Z");
  for (let i = 0; i < DEPLOY_GRANTS_PER_DAY; i++) {
    f.balances.set(u.wallet.toLowerCase(), BigInt(0));
    expect(await sponsorDeployFee(db, u, plan(), deps(f.chain), day3)).toBe("granted");
  }
  f.balances.set(u.wallet.toLowerCase(), BigInt(0));
  expect(await sponsorDeployFee(db, u, plan(), deps(f.chain), day3)).toBe("skipped");
});

it("people who bought credits get 10 a day", async () => {
  const f = fakeChain();
  const u = await newUser();
  await ledgerRow(u.id, "deposit", "onchain");
  const now = new Date("2026-11-19T10:00:00Z");
  for (let i = 0; i < DEPLOY_GRANTS_PER_DAY_BUYER; i++) {
    f.balances.set(u.wallet.toLowerCase(), BigInt(0));
    expect(await sponsorDeployFee(db, u, plan(), deps(f.chain), now)).toBe("granted");
  }
  f.balances.set(u.wallet.toLowerCase(), BigInt(0));
  expect(await sponsorDeployFee(db, u, plan(), deps(f.chain), now)).toBe("skipped");
});

it("free credits don't count as having bought credits", async () => {
  const f = fakeChain();
  const u = await newUser();
  await ledgerRow(u.id, "adjust", "welcome");
  const now = new Date("2026-11-19T10:00:00Z");
  for (let i = 0; i < DEPLOY_GRANTS_PER_DAY; i++) {
    f.balances.set(u.wallet.toLowerCase(), BigInt(0));
    await sponsorDeployFee(db, u, plan(), deps(f.chain), now);
  }
  f.balances.set(u.wallet.toLowerCase(), BigInt(0));
  expect(await sponsorDeployFee(db, u, plan(), deps(f.chain), now)).toBe("skipped");
});

it("a deploy grant doesn't use up the vote grant, and the vote grant doesn't use up deploys", async () => {
  const f = fakeChain();
  const u = await newUser();
  expect(await sponsorDeployFee(db, u, plan(), deps(f.chain))).toBe("granted");
  f.balances.set(u.wallet.toLowerCase(), BigInt(0));
  const vote = await ensureGas(db, u, BigInt("100000000000000000"), "hackathon_vote", deps(f.chain));
  expect(vote.kind).toBe("granted");
  f.balances.set(u.wallet.toLowerCase(), BigInt(0));
  expect(await sponsorDeployFee(db, u, plan(), deps(f.chain))).toBe("granted");
  expect((await db.select().from(gasGrants)).map((r) => r.reason).sort()).toEqual(["deploy", "deploy", "hackathon_vote"]);
  expect(vote.kind === "granted" && vote.amountWei).toBe(GRANT_TARGET_WEI);
});

it("deploy top-ups stop at the daily CELO budget, whoever asks", async () => {
  const f = fakeChain();
  const big = plan({ steps: [{ name: "Big", bytecodeBytes: 12_000 }] });
  const each = estimateDeployFeeWei(big, FEE);
  expect(each).toBeLessThan(DEPLOY_MAX_WEI);
  const fits = Number(DEPLOY_DAY_BUDGET_WEI / each);
  const now = new Date("2026-11-19T10:00:00Z");
  for (let i = 0; i < fits; i++) {
    expect(await sponsorDeployFee(db, await newUser(), { ...big, sourceHash: randomUUID() }, deps(f.chain), now)).toBe("granted");
  }
  expect(await sponsorDeployFee(db, await newUser(), { ...big, sourceHash: randomUUID() }, deps(f.chain), now)).toBe("skipped");
});

it("two deploy requests at once for the same plan send one transfer", async () => {
  const f = fakeChain();
  const u = await newUser();
  const p = plan();
  await Promise.all([sponsorDeployFee(db, u, p, deps(f.chain)), sponsorDeployFee(db, u, p, deps(f.chain))]);
  expect(await db.select().from(gasGrants)).toHaveLength(1);
  expect(f.balances.get(u.wallet.toLowerCase())).toBe(estimateDeployFeeWei(p, FEE));
});
