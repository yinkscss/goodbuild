// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { keccak256, parseTransaction, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { gasGrants } from "@/server/db/gas-grant-schema";
import { appSettings } from "@/server/db/settings-schema";
import { ensureGas, GasGrantError, GRANT_TARGET_WEI, GRANTS_PER_DAY, type GrantChain, type GrantDeps } from "./grant";

// A throwaway key that only ever signs in this test. It never touches a network.
const gasAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const NEED = BigInt("150000000000000000"); // 0.15 CELO fee cap

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const addr = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}` as Address;

async function newUser(wallet = addr()) {
  const [u] = await db.insert(users).values({ wallet }).returning();
  return u;
}

/** A tiny fake chain: balances, verified roots, a mempool and blocks that mine on demand. */
function fakeChain(opts: { roots?: Map<string, string | null>; mineOn?: "send" | "never"; gasBalance?: bigint } = {}) {
  const balances = new Map<string, bigint>();
  balances.set(gasAccount.address.toLowerCase(), opts.gasBalance ?? BigInt("20000000000000000000"));
  const mined = new Map<string, "success" | "reverted">();
  const sent: Hex[] = [];
  let nonce = 0;
  const chain: GrantChain = {
    readRoot: vi.fn(async (w: Address) => (opts.roots ? (opts.roots.get(w.toLowerCase()) ?? null) : w)) as GrantChain["readRoot"],
    getBalance: vi.fn(async (a: Address) => balances.get(a.toLowerCase()) ?? BigInt(0)),
    pendingNonce: vi.fn(async () => nonce),
    fees: vi.fn(async () => ({ maxFeePerGas: BigInt(400_000_000_000), maxPriorityFeePerGas: BigInt(2_500_000_000) })),
    sendRaw: vi.fn(async (raw: Hex) => {
      sent.push(raw);
      const hash = keccak256(raw);
      if (opts.mineOn === "never" || mined.has(hash)) return;
      const tx = parseTransaction(raw);
      mined.set(hash, "success");
      nonce = Math.max(nonce, (tx.nonce ?? 0) + 1);
      const to = tx.to!.toLowerCase();
      balances.set(to, (balances.get(to) ?? BigInt(0)) + (tx.value ?? BigInt(0)));
    }),
    receipt: vi.fn(async (hash: Hex) => mined.get(hash) ?? null),
  };
  return { chain, balances, sent, mined };
}

function deps(chain: GrantChain, extra: Partial<GrantDeps> = {}): GrantDeps {
  return { chain, signer: gasAccount, alert: vi.fn(async () => {}), sleep: async () => {}, waitMs: 5, ...extra };
}

it("tops a verified, empty wallet up to 0.3 CELO, once", async () => {
  const u = await newUser();
  const f = fakeChain();
  const out = await ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain));
  expect(out.kind).toBe("granted");
  expect(f.balances.get(u.wallet.toLowerCase())).toBe(GRANT_TARGET_WEI);
  const [row] = await db.select().from(gasGrants);
  expect(row).toMatchObject({ status: "confirmed", wallet: u.wallet.toLowerCase(), reason: "hackathon_vote", nonce: 0 });

  // Already funded: nothing more is sent.
  expect(await ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain))).toEqual({ kind: "enough" });
  // Spent it all: the person has had their grant.
  f.balances.set(u.wallet.toLowerCase(), BigInt(0));
  await expect(ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain))).rejects.toMatchObject({ code: "used" });
  expect(f.sent).toHaveLength(1);
});

it("only tops up the difference when the wallet already holds some CELO", async () => {
  const u = await newUser();
  const f = fakeChain();
  f.balances.set(u.wallet.toLowerCase(), BigInt("100000000000000000"));
  await ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain));
  const tx = parseTransaction(f.sent[0]);
  expect(tx.value).toBe(BigInt("200000000000000000"));
  expect(tx.to?.toLowerCase()).toBe(u.wallet.toLowerCase());
});

it("refuses unverified wallets without touching the gas wallet", async () => {
  const u = await newUser();
  const f = fakeChain({ roots: new Map() });
  await expect(ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain))).rejects.toMatchObject({ code: "not_verified" });
  expect(f.sent).toHaveLength(0);
});

it("gives two wallets of the same person one grant", async () => {
  const a = await newUser();
  const b = await newUser();
  const root = a.wallet.toLowerCase();
  const f = fakeChain({ roots: new Map([[a.wallet.toLowerCase(), root], [b.wallet.toLowerCase(), root]]) });
  await ensureGas(db, a, NEED, "hackathon_vote", deps(f.chain));
  await expect(ensureGas(db, b, NEED, "hackathon_vote", deps(f.chain))).rejects.toMatchObject({ code: "used" });
  expect(f.sent).toHaveLength(1);
});

it("sends once when the same person asks many times at once", async () => {
  const u = await newUser();
  const f = fakeChain();
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain))));
  expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  const distinct = new Set(f.sent.map((raw) => keccak256(raw)));
  expect(distinct.size).toBe(1);
  expect(await db.select().from(gasGrants)).toHaveLength(1);
});

it("never reuses a nonce across different people asking at once", async () => {
  const people = await Promise.all(Array.from({ length: 6 }, () => newUser()));
  const f = fakeChain({ mineOn: "never" });
  await Promise.allSettled(people.map((u) => ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain))));
  const nonces = (await db.select().from(gasGrants)).map((r) => r.nonce);
  expect(new Set(nonces).size).toBe(6);
});

it("stops at the daily limit", async () => {
  const f = fakeChain();
  for (let i = 0; i < GRANTS_PER_DAY; i++) await ensureGas(db, await newUser(), NEED, "hackathon_vote", deps(f.chain));
  await expect(ensureGas(db, await newUser(), NEED, "hackathon_vote", deps(f.chain))).rejects.toMatchObject({ code: "daily_limit" });
  expect(f.sent).toHaveLength(GRANTS_PER_DAY);
});

it("resends the same signed transaction after a slow network, never a new payment", async () => {
  const u = await newUser();
  const f = fakeChain({ mineOn: "never" });
  await expect(ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain))).rejects.toMatchObject({ code: "pending" });
  const [first] = await db.select().from(gasGrants);
  expect(first.status).toBe("signed");
  // Later it is mined; the retry only rebroadcasts and records it.
  f.mined.set(first.txHash as Hex, "success");
  const out = await ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain));
  expect(out).toMatchObject({ kind: "granted", txHash: first.txHash });
  expect(new Set(f.sent.map((raw) => keccak256(raw)))).toEqual(new Set([first.txHash]));
});

it("hands a transfer stuck for 10 minutes to the owner and stops", async () => {
  const u = await newUser();
  const f = fakeChain({ mineOn: "never" });
  await expect(ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain))).rejects.toBeInstanceOf(GasGrantError);
  const alert = vi.fn(async () => {});
  const later = () => new Date(Date.now() + 11 * 60_000);
  await expect(ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain, { now: later, alert }))).rejects.toMatchObject({ code: "review" });
  expect(alert).toHaveBeenCalledOnce();
  expect((await db.select().from(gasGrants))[0].status).toBe("needs_review");
});

it("the kill switch stops new grants but still finishes a signed one", async () => {
  const u = await newUser();
  const f = fakeChain({ mineOn: "never" });
  await expect(ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain))).rejects.toMatchObject({ code: "pending" });
  await db.insert(appSettings).values({ key: "gas_grants", value: "off" });
  await expect(ensureGas(db, await newUser(), NEED, "hackathon_vote", deps(f.chain))).rejects.toMatchObject({ code: "off" });
  const [row] = await db.select().from(gasGrants);
  f.mined.set(row.txHash as Hex, "success");
  expect(await ensureGas(db, u, NEED, "hackathon_vote", deps(f.chain))).toMatchObject({ kind: "granted" });
});

it("is off without a key, and says so when the gas wallet is empty", async () => {
  const f = fakeChain({ gasBalance: BigInt("10000000000000000") });
  await expect(ensureGas(db, await newUser(), NEED, "hackathon_vote", deps(f.chain, { signer: null }))).rejects.toMatchObject({ code: "off" });
  const alert = vi.fn(async () => {});
  await expect(ensureGas(db, await newUser(), NEED, "hackathon_vote", deps(f.chain, { alert }))).rejects.toMatchObject({ code: "empty" });
  expect(alert).toHaveBeenCalledOnce();
  expect(f.sent).toHaveLength(0);
});

it("refuses when the fee is above what a grant can cover", async () => {
  const f = fakeChain();
  await expect(ensureGas(db, await newUser(), GRANT_TARGET_WEI + BigInt(1), "hackathon_vote", deps(f.chain))).rejects.toMatchObject({ code: "too_expensive" });
});

it("imports nothing from credits, Paystack or GoodCash", () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  for (const file of readdirSync(dir)) {
    const src = readFileSync(path.join(dir, file), "utf8");
    for (const line of src.split("\n").filter((l) => /^\s*import|from\s+["']/.test(l)))
      expect(line, `${file}: ${line}`).not.toMatch(/credits|paystack|goodcash/i);
  }
});
