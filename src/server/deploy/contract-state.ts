import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { MANIFEST_PATH, parseManifest } from "@/lib/deploy/manifest";
import { isDeployableSource } from "@/lib/deploy/test-file";
import type { Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { sourceKey } from "./compile";
import { isUpgradeableProject } from "./upgradeable";

export interface ContractState {
  /** Contracts this code needs, in manifest order. */
  names: string[];
  /** Deployed from exactly this code. */
  live: string[];
  /** Deployed, but from older code: the chain doesn't have the latest changes. */
  outdated: string[];
  /** Outdated contracts behind a proxy (D33): they get the changes at the same address. */
  upgradable: string[];
  /** This project opted in to upgradeable contracts (D33). */
  upgradeable: boolean;
}

/** How the project's saved contracts compare with what's on its chain. */
export async function contractState(db: Db, project: { id: string; chainId: number }, files: Record<string, string>): Promise<ContractState> {
  const upgradeable = await isUpgradeableProject(db, project.id);
  const sources = Object.keys(files).filter(isDeployableSource);
  if (!sources.length) return { names: [], live: [], outdated: [], upgradable: [], upgradeable };
  const manifest = files[MANIFEST_PATH] ? parseManifest(files[MANIFEST_PATH]) : null;
  const names = manifest?.ok ? manifest.manifest.contracts.map((c) => c.name) : sources.map((p) => p.slice("contracts/".length, -".sol".length));
  const current = new Set<string>([sourceKey(files, "cancun", { upgradeable }), sourceKey(files, "paris", { upgradeable })]);
  const rows = await db
    .select({ name: deployments.contractName, sourceHash: deployments.sourceHash, proxy: deployments.proxy })
    .from(deployments)
    .where(and(eq(deployments.projectId, project.id), eq(deployments.chainId, project.chainId)))
    .orderBy(desc(deployments.createdAt));
  const deployed = new Set(rows.map((r) => r.name));
  const live = new Set(rows.filter((r) => current.has(r.sourceHash)).map((r) => r.name));
  const newest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!newest.has(r.name)) newest.set(r.name, r);
  const outdated = names.filter((n) => deployed.has(n) && !live.has(n));
  return { names, live: names.filter((n) => live.has(n)), outdated, upgradable: upgradeable ? outdated.filter((n) => newest.get(n)?.proxy) : [], upgradeable };
}
