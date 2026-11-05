import "server-only";

import { eq } from "drizzle-orm";
import { parseAbi, zeroAddress, type Address, type PublicClient } from "viem";
import { celo } from "viem/chains";

import type { Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { publicClientFor } from "@/server/deploy/service";

/** GoodDollar's production Identity contract, on Celo mainnet even for testnet builders. */
export const GOODDOLLAR_IDENTITY: Address = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42";

const ABI = parseAbi(["function getWhitelistedRoot(address account) view returns (address)"]);

/** The verified wallet behind this one (itself, or the one it's linked to), or null. */
export async function readGoodIdRoot(client: Pick<PublicClient, "readContract">, wallet: Address): Promise<Address | null> {
  const root = await client.readContract({ address: GOODDOLLAR_IDENTITY, abi: ABI, functionName: "getWhitelistedRoot", args: [wallet] });
  return root === zeroAddress ? null : root;
}

/**
 * Ask the contract whether this account's wallet is verified, and record it. The chain is the only
 * thing trusted here, never what the browser or GoodDollar's redirect says. Verification is kept once
 * recorded: it unlocks one fixed allowance per person (D30), so a later expiry changes nothing.
 */
export async function syncGoodId(db: Db, user: { id: string; wallet: string; verifiedAt: Date | null }, client: Pick<PublicClient, "readContract"> = publicClientFor(celo.id)): Promise<boolean> {
  if (user.verifiedAt) return true;
  const root = await readGoodIdRoot(client, user.wallet as Address);
  if (!root) return false;
  await db.update(users).set({ goodidRoot: root.toLowerCase(), verifiedAt: new Date() }).where(eq(users.id, user.id));
  return true;
}
