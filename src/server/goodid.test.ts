// @vitest-environment node
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { zeroAddress, type Address } from "viem";

import { createTestDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { readGoodIdentity, recordingRootReader } from "./goodid";

const ROOT = "0x00000000000000000000000000000000000000aa" as Address;
const WALLET = "0x00000000000000000000000000000000000000bb" as Address;

function client(answers: Record<string, unknown | Error>) {
  return {
    readContract: (async ({ functionName }: { functionName: string }) => {
      const a = answers[functionName];
      if (a instanceof Error) throw a;
      return a;
    }) as never,
  };
}

describe("readGoodIdentity", () => {
  it("adds the authentication period (days) to lastAuthenticated (seconds)", async () => {
    const id = await readGoodIdentity(client({ getWhitelistedRoot: ROOT, lastAuthenticated: BigInt(1_700_000_000), authenticationPeriod: BigInt(180) }), WALLET);
    expect(id.root).toBe(ROOT);
    expect(id.expiresAt?.toISOString()).toBe(new Date((1_700_000_000 + 180 * 86_400) * 1000).toISOString());
  });

  it("has no root and no expiry for an unverified wallet", async () => {
    expect(await readGoodIdentity(client({ getWhitelistedRoot: zeroAddress }), WALLET)).toEqual({ root: null, expiresAt: null });
  });

  it("leaves the expiry unknown when the contract can't say, so the root still decides", async () => {
    expect(await readGoodIdentity(client({ getWhitelistedRoot: ROOT, lastAuthenticated: new Error("reverted"), authenticationPeriod: BigInt(180) }), WALLET)).toEqual({ root: ROOT, expiresAt: null });
    expect(await readGoodIdentity(client({ getWhitelistedRoot: ROOT, lastAuthenticated: BigInt(0), authenticationPeriod: BigInt(180) }), WALLET)).toEqual({ root: ROOT, expiresAt: null });
  });
});

describe("recordingRootReader", () => {
  it("records the signed-in wallet's own verification, so /stats counts people verified elsewhere", async () => {
    const db = await createTestDb();
    const [user] = await db.insert(users).values({ wallet: WALLET }).returning();
    expect(await recordingRootReader(db, user, client({ getWhitelistedRoot: ROOT }))(WALLET)).toBe(ROOT);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.verifiedAt).toBeInstanceOf(Date);
    expect(row.goodidRoot).toBe(ROOT);
  });

  it("never records another wallet's root (a project owner's) against this account, nor an unverified one", async () => {
    const db = await createTestDb();
    const [user] = await db.insert(users).values({ wallet: WALLET }).returning();
    await recordingRootReader(db, user, client({ getWhitelistedRoot: ROOT }))("0x00000000000000000000000000000000000000cc");
    await recordingRootReader(db, user, client({ getWhitelistedRoot: zeroAddress }))(WALLET);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.verifiedAt).toBeNull();
  });
});
