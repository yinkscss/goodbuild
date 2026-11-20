// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { encodeEventTopics, encodeAbiParameters, erc20Abi } from "viem";
import { GOODDOLLAR_MAINNET } from "@/config/gooddollar";
import { eq } from "drizzle-orm";
import { MIGRATIONS, testBackends, type TestDatabase } from "@/server/credits/test-backends";
import { users } from "@/server/db/schema";
import { referrals } from "@/server/db/referral-schema";
import { ambassadorEarnings, ambassadorPayouts } from "@/server/db/ambassador-schema";
import { qualifyAmbassador, requestPayout, changePayout, confirmPayout, ambassadorDashboard } from "./service";
const rpc = vi.hoisted(() => ({ getTransactionReceipt: vi.fn(), getBlockNumber: vi.fn(), getBlock: vi.fn(), readContract: vi.fn() }));
vi.mock("@/server/deploy/service", () => ({ publicClientFor: () => rpc }));
let database: TestDatabase;
beforeAll(async () => { database = await testBackends()[0].open(); await database.migrate(MIGRATIONS); process.env.AMBASSADOR_START = "2026-01-01T00:00:00Z"; },120000);
afterAll(async () => { delete process.env.AMBASSADOR_START; await database?.close(); });
const wallet = () => `0x${randomUUID().replaceAll("-", "").padEnd(40,"0")}`;
async function person() { const [u] = await database.db.insert(users).values({ wallet: wallet(), goodidRoot: wallet(), verifiedAt: new Date("2026-02-01") }).returning(); return u; }
it("qualifies a new identity once, blocks duplicates, self identities and prelaunch verification", async () => {
 const db = database.db; const a = await person(); const b = await person();
 await db.insert(referrals).values({referrerUserId:a.id,refereeUserId:b.id,createdAt:new Date("2026-02-01")});
 await qualifyAmbassador(db,b.id,b.goodidRoot!); await qualifyAmbassador(db,b.id,b.goodidRoot!);
 expect((await ambassadorDashboard(db,a.id)).availableG).toBe(5000);
 const c = await person(); await db.insert(referrals).values({referrerUserId:a.id,refereeUserId:c.id});
 await qualifyAmbassador(db,c.id,b.goodidRoot!); expect((await ambassadorDashboard(db,a.id)).availableG).toBe(5000);
 await qualifyAmbassador(db,c.id,a.goodidRoot!); expect((await ambassadorDashboard(db,a.id)).availableG).toBe(5000);
 await db.update(users).set({verifiedAt:new Date("2025-01-01")}).where(eq(users.id,c.id));
 await qualifyAmbassador(db,c.id,c.goodidRoot!); expect((await ambassadorDashboard(db,a.id)).availableG).toBe(5000);
});
it("reserves all available earnings once, releases rejected requests, and guards processing state", async () => {
 const db = database.db; const a = await person();
 await expect(requestPayout(db,a.id)).rejects.toThrow(/five/);
 for(let i=0;i<6;i++) { const b = await person(); const [r] = await db.insert(referrals).values({referrerUserId:a.id,refereeUserId:b.id}).returning(); await db.insert(ambassadorEarnings).values({referralId:r.id,userId:a.id,root:b.goodidRoot!}); }
 const p = await requestPayout(db,a.id); expect(p.amountG).toBe(30000); expect(p.wallet).toBe(a.wallet);
 await expect(requestPayout(db,a.id)).rejects.toThrow(/already/);
 expect((await ambassadorDashboard(db,a.id)).availableG).toBe(0);
 await changePayout(db,a.id,p.id,"reject","Incorrect request");
 expect((await ambassadorDashboard(db,a.id)).availableG).toBe(30000);
 const next = await requestPayout(db,a.id); await changePayout(db,a.id,next.id,"process");
 await expect(changePayout(db,a.id,next.id,"reject","no")).rejects.toThrow(/processing/);
 await expect(changePayout(db,a.id,next.id,"reconcile","")).rejects.toThrow(/reason/);
 await changePayout(db,a.id,next.id,"reconcile","Checked wallet and pending transactions; no payment sent");
 const [row] = await db.select().from(ambassadorPayouts).where(eq(ambassadorPayouts.id,next.id)); expect(row.status).toBe("requested");
});

it("verifies exact G$ receipt evidence with finality and makes confirmation idempotent", async () => {
 const db = database.db; const a = await person();
 const sender = "0x1111111111111111111111111111111111111111" as const;
 process.env.AMBASSADOR_PAYOUT_WALLETS = sender;
 const [p] = await db.insert(ambassadorPayouts).values({userId:a.id,wallet:a.wallet,amountG:25000,status:"processing",createdAt:new Date("2026-02-01")}).returning();
 const hash = ("0x"+"a".repeat(64)) as `0x${string}`;
 const log = { address:GOODDOLLAR_MAINNET,logIndex:1,data:encodeAbiParameters([{type:"uint256"}],[BigInt(25000)*BigInt(10)**BigInt(18)]),topics:encodeEventTopics({abi:erc20Abi,eventName:"Transfer",args:{from:sender,to:a.wallet as `0x${string}`}}) };
 rpc.getTransactionReceipt.mockResolvedValue({status:"success",blockNumber:BigInt(100),logs:[log]});
 rpc.getBlockNumber.mockResolvedValue(BigInt(110));
 rpc.getBlock.mockResolvedValue({timestamp:BigInt(1800000000)});
 rpc.readContract.mockResolvedValue(18);
 await expect(confirmPayout(db,a.id,p.id,hash)).rejects.toThrow(/30 block/);
 rpc.getBlockNumber.mockResolvedValue(BigInt(140));
 rpc.getTransactionReceipt.mockResolvedValue({status:"success",blockNumber:BigInt(100),logs:[{...log,address:sender}]});
 await expect(confirmPayout(db,a.id,p.id,hash)).rejects.toThrow(/exact G/);
 rpc.getTransactionReceipt.mockResolvedValue({status:"success",blockNumber:BigInt(100),logs:[log]});
 await confirmPayout(db,a.id,p.id,hash); await confirmPayout(db,a.id,p.id,hash);
 const [paid] = await db.select().from(ambassadorPayouts).where(eq(ambassadorPayouts.id,p.id));
 expect(paid.status).toBe("paid"); expect(paid.txHash).toBe(hash);
 delete process.env.AMBASSADOR_PAYOUT_WALLETS;
});
