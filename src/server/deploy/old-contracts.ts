import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { erc20Abi, type Abi, type Address, type PublicClient } from "viem";

import { goodDollarAddress } from "@/config/gooddollar";
import { exitFunctions, type OldContract } from "@/lib/deploy/exit-functions";
import type { Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { publicClientFor } from "./service";

/** Contracts a newer deploy replaced that still hold G$, newest first. A failed read leaves one out. */
export async function oldContractsWithFunds(db: Db, project: { id: string; chainId: number }, client: Pick<PublicClient, "readContract"> = publicClientFor(project.chainId)): Promise<OldContract[]> {
  const token = goodDollarAddress(project.chainId);
  if (!token) return [];
  const rows = await db
    .select({ name: deployments.contractName, address: deployments.address, abi: deployments.abi })
    .from(deployments)
    .where(and(eq(deployments.projectId, project.id), eq(deployments.chainId, project.chainId)))
    .orderBy(desc(deployments.createdAt));

  const seen = new Set<string>();
  const out: OldContract[] = [];
  for (const row of rows) {
    if (!seen.has(row.name)) {
      seen.add(row.name); // the newest of each name is the live one
      continue;
    }
    const address = row.address as Address;
    const balance = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] }).catch(() => BigInt(0));
    if (balance > BigInt(0)) out.push({ name: row.name, address, gdBalance: String(balance), exits: exitFunctions(row.abi as Abi) });
  }
  return out;
}
