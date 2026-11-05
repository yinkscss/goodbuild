// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";

import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { GOODDOLLAR_IDENTITY, syncGoodId } from "./goodid";

const WALLET = "0x7a3000000000000000000000000000000000e41c";
const ROOT = "0x7A3000000000000000000000000000000000AAAA";

let db: Db;
let user: { id: string; wallet: string; verifiedAt: Date | null };
const clientReturning = (root: string) => ({ readContract: vi.fn(async () => root) }) as never;
const saved = async () => (await db.select().from(users).where(eq(users.id, user.id)))[0];

beforeEach(async () => {
  db = await createTestDb();
  user = await signInUser(db, { wallet: WALLET, walletKind: "embedded", attestation: { ageOk: true, notUsPerson: true } });
});

describe("syncGoodId", () => {
  it("records nothing when the contract says the wallet isn't verified", async () => {
    expect(await syncGoodId(db, user, clientReturning(zeroAddress))).toBe(false);
    expect((await saved()).verifiedAt).toBeNull();
  });

  it("records the verified root, lowercased, asking the production contract about this wallet", async () => {
    const client = clientReturning(ROOT) as unknown as { readContract: ReturnType<typeof vi.fn> };
    expect(await syncGoodId(db, user, client as never)).toBe(true);
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: GOODDOLLAR_IDENTITY, args: [WALLET] }));
    expect(await saved()).toMatchObject({ goodidRoot: ROOT.toLowerCase() });
    expect((await saved()).verifiedAt).toBeInstanceOf(Date);
  });

  it("doesn't ask again once verified", async () => {
    const client = clientReturning(zeroAddress) as unknown as { readContract: ReturnType<typeof vi.fn> };
    expect(await syncGoodId(db, { ...user, verifiedAt: new Date() }, client as never)).toBe(true);
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("passes a chain failure up rather than guessing", async () => {
    const client = { readContract: vi.fn(async () => { throw new Error("rpc down"); }) } as never;
    await expect(syncGoodId(db, user, client)).rejects.toThrow("rpc down");
    expect((await saved()).verifiedAt).toBeNull();
  });
});
