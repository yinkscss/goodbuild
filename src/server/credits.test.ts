// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { creditState } from "@/lib/home";
import { getCredits } from "./credits";
import { postLedgerEntry } from "./credits/ledger";

let db: Db;
let userId: string;

beforeEach(async () => {
  db = await createTestDb();
  const [u] = await db.insert(users).values({ wallet: "0xabc" }).returning({ id: users.id });
  userId = u.id;
});

describe("getCredits", () => {
  it("a user with no entries has a real balance of zero, and the UI stays in its free preview", async () => {
    const credits = await getCredits(userId, db);
    expect(credits).toEqual({ balanceMicro: 0, balanceGd: null, usdPerGd: null });
    // A 0 in balanceGd would read as "empty", which disables the prompt for everyone.
    expect(creditState(credits.balanceGd)).toBe("preview");
  });

  it("reads the real balance from the ledger", async () => {
    await postLedgerEntry(db, { userId, kind: "deposit", amountMicro: 4_200_000, idempotencyKey: "topup:one" });
    await postLedgerEntry(db, { userId, kind: "usage", amountMicro: -200_000, idempotencyKey: "usage:one" });
    expect((await getCredits(userId, db)).balanceMicro).toBe(4_000_000);
  });

  it("the UI still looks the same when someone does have a balance", async () => {
    await postLedgerEntry(db, { userId, kind: "deposit", amountMicro: 1_000_000, idempotencyKey: "topup:two" });
    const credits = await getCredits(userId, db);
    expect(credits.balanceGd).toBeNull();
    expect(credits.usdPerGd).toBeNull();
    expect(creditState(credits.balanceGd)).toBe("preview");
  });

  it("a failed read reports unknown rather than zero, and doesn't throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = { select: () => { throw new Error("database is down"); } } as unknown as Db;
    expect(await getCredits(userId, broken)).toEqual({ balanceMicro: null, balanceGd: null, usdPerGd: null });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
