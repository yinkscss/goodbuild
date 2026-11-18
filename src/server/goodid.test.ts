// @vitest-environment node
import { describe, expect, it } from "vitest";
import { zeroAddress, type Address } from "viem";

import { readGoodIdentity } from "./goodid";

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
