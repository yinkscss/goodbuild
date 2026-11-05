import "server-only";

import { and, eq } from "drizzle-orm";

import { MANIFEST_PATH, parseManifest } from "@/lib/deploy/manifest";
import type { Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { sourceKey } from "./compile";

export interface ContractState {
  /** Contracts this code needs, in manifest order. */
  names: string[];
  /** Deployed from exactly this code. */
  live: string[];
  /** Deployed, but from older code: the chain doesn't have the latest changes. */
  outdated: string[];
}

/** How the project's saved contracts compare with what's on its chain. */
export async function contractState(db: Db, project: { id: string; chainId: number }, files: Record<string, string>): Promise<ContractState> {
  const sources = Object.keys(files).filter((p) => p.startsWith("contracts/") && p.endsWith(".sol") && !p.startsWith("contracts/test/"));
  if (!sources.length) return { names: [], live: [], outdated: [] };
  const manifest = files[MANIFEST_PATH] ? parseManifest(files[MANIFEST_PATH]) : null;
  const names = manifest?.ok ? manifest.manifest.contracts.map((c) => c.name) : sources.map((p) => p.slice("contracts/".length, -".sol".length));
  const current = new Set<string>([sourceKey(files, "cancun"), sourceKey(files, "paris")]);
  const rows = await db
    .select({ name: deployments.contractName, sourceHash: deployments.sourceHash })
    .from(deployments)
    .where(and(eq(deployments.projectId, project.id), eq(deployments.chainId, project.chainId)));
  const deployed = new Set(rows.map((r) => r.name));
  const live = new Set(rows.filter((r) => current.has(r.sourceHash)).map((r) => r.name));
  return { names, live: names.filter((n) => live.has(n)), outdated: names.filter((n) => deployed.has(n) && !live.has(n)) };
}
