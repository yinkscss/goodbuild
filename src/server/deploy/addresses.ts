import "server-only";

import { and, desc, eq } from "drizzle-orm";
import type { Address } from "viem";

import { PLATFORM_DIR } from "@/server/agent/template";
import type { Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";

/** Latest deployed address per contract and chain: { RTXPool: { 11142220: "0x…" } }. */
export async function loadDeployedAddresses(
  db: Db,
  projectId: string,
  /** Skip a deployment whose ABI differs: the app must not call new functions on old code. */
  currentAbis: Record<string, unknown> = {},
): Promise<Record<string, Record<number, Address>>> {
  const rows = await db
    .select({ name: deployments.contractName, chainId: deployments.chainId, address: deployments.address, abi: deployments.abi })
    .from(deployments)
    .where(eq(deployments.projectId, projectId))
    .orderBy(desc(deployments.createdAt));
  const out: Record<string, Record<number, Address>> = {};
  for (const r of rows) {
    if (currentAbis[r.name] && JSON.stringify(currentAbis[r.name]) !== JSON.stringify(r.abi)) continue;
    out[r.name] ??= {};
    out[r.name][r.chainId] ??= r.address as Address; // newest first, so the first row per chain wins
  }
  return out;
}

/** What the agent is told about the project's live contracts on every turn. */
export function deploymentsBlock(addresses: Record<string, Record<number, Address>>): string {
  const lines = Object.entries(addresses).flatMap(([name, map]) => Object.entries(map).map(([chainId, address]) => `- ${name} on chain ${chainId}: ${address}`));
  if (!lines.length) return "";
  return `Deployed contracts (live on-chain, recorded by GoodBuild):\n${lines.join("\n")}\nThe ABI and these addresses are already in ${PLATFORM_DIR}<Name>.ts. Read them through <Name>Abi and <Name>Address[chain.id], never hardcode them, and make the app use real data for these contracts. If you change a deployed contract's functions or events, tell the user it must be deployed again: until then its address map is empty for that contract and the app should show its not-deployed state.`;
}

const ADDRESS_MAP = (name: string) => new RegExp(`(export const ${name}Address: Partial<Record<number, Address>> = )\\{[\\s\\S]*?\\};`);

/** Put deployed addresses into platform-owned contract modules, leaving every other file alone. */
export function withDeployedAddresses(
  files: Record<string, string>,
  addresses: Record<string, Record<number, Address>>,
): Record<string, string> {
  const out = { ...files };
  for (const [name, map] of Object.entries(addresses)) {
    const path = `${PLATFORM_DIR}${name}.ts`;
    const source = out[path];
    if (!source) continue;
    out[path] = source.replace(ADDRESS_MAP(name), (_m, head: string) => `${head}${JSON.stringify(map, null, 2)};`);
  }
  return out;
}

export async function deployedAddressesFor(db: Db, projectId: string, chainId: number, name: string): Promise<Address | undefined> {
  const [row] = await db
    .select({ address: deployments.address })
    .from(deployments)
    .where(and(eq(deployments.projectId, projectId), eq(deployments.chainId, chainId), eq(deployments.contractName, name)))
    .orderBy(desc(deployments.createdAt))
    .limit(1);
  return row?.address as Address | undefined;
}
