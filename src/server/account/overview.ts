import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { getAddress, type Abi, type AbiFunction } from "viem";

import { adminFunctions } from "@/lib/deploy/admin-functions";
import { markLive } from "@/lib/account";
import type { Db } from "@/server/db/client";
import { appDataUsage } from "@/server/db/app-data-schema";
import { deployments } from "@/server/db/deploy-schema";
import { publications } from "@/server/db/publish-schema";
import { projects } from "@/server/db/schema";

/**
 * Everything the Settings page shows (D62). Each query is scoped to the signed-in user through
 * `projects.owner_id`, and the deployment queries check both that and `deployments.user_id`.
 * Selects are explicit lists: no hashes, tokens, emails or stored source ever leave this file.
 */

export interface AppRow {
  id: string;
  name: string;
  status: string;
  chainId: number;
  updatedAt: Date;
  /** Null until the first publish. */
  slug: string | null;
  live: boolean;
  contracts: number;
  dataRecords: number;
  dataBytes: number;
}

export async function listApps(db: Db, userId: string, limit = 200): Promise<AppRow[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      chainId: projects.chainId,
      updatedAt: projects.updatedAt,
      slug: publications.slug,
      unpublishedAt: publications.unpublishedAt,
      disabledAt: publications.disabledAt,
    })
    .from(projects)
    .leftJoin(publications, eq(publications.projectId, projects.id))
    .where(eq(projects.ownerId, userId))
    .orderBy(desc(projects.updatedAt))
    .limit(limit);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const [usage, deployed] = await Promise.all([
    db.select({ projectId: appDataUsage.projectId, rows: appDataUsage.rows, bytes: appDataUsage.bytes }).from(appDataUsage).where(and(inArray(appDataUsage.projectId, ids), eq(appDataUsage.wallet, "*"))),
    db.select({ id: deployments.id, projectId: deployments.projectId, chainId: deployments.chainId, contractName: deployments.contractName, createdAt: deployments.createdAt }).from(deployments).where(and(inArray(deployments.projectId, ids), eq(deployments.userId, userId))),
  ]);
  const live = markLive(deployed).filter((d) => d.live);
  return rows.map((r) => {
    const u = usage.find((x) => x.projectId === r.id);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      chainId: r.chainId,
      updatedAt: r.updatedAt,
      slug: r.slug,
      live: Boolean(r.slug && !r.unpublishedAt && !r.disabledAt),
      contracts: live.filter((d) => d.projectId === r.id).length,
      dataRecords: u?.rows ?? 0,
      dataBytes: u?.bytes ?? 0,
    };
  });
}

export interface ContractRow {
  id: string;
  projectId: string;
  projectName: string;
  chainId: number;
  contractName: string;
  address: string;
  txHash: string;
  verifyStatus: string;
  upgradeable: boolean;
  /** Newest deploy of this contract in its project and network. Older ones were replaced. */
  live: boolean;
  createdAt: Date;
}

async function ownedDeployments(db: Db, userId: string, limit: number) {
  return db
    .select({
      id: deployments.id,
      projectId: deployments.projectId,
      projectName: projects.name,
      chainId: deployments.chainId,
      contractName: deployments.contractName,
      address: deployments.address,
      txHash: deployments.txHash,
      verifyStatus: deployments.verifyStatus,
      proxy: deployments.proxy,
      abi: deployments.abi,
      createdAt: deployments.createdAt,
    })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .where(and(eq(projects.ownerId, userId), eq(deployments.userId, userId)))
    .orderBy(desc(deployments.createdAt))
    .limit(limit);
}

export async function listContracts(db: Db, userId: string, limit = 500): Promise<ContractRow[]> {
  const rows = await ownedDeployments(db, userId, limit);
  return markLive(rows).map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectName: r.projectName,
    chainId: r.chainId,
    contractName: r.contractName,
    address: getAddress(r.address),
    txHash: r.txHash,
    verifyStatus: r.verifyStatus,
    upgradeable: Boolean(r.proxy),
    live: r.live,
    createdAt: r.createdAt,
  }));
}

export interface AdminContract {
  deploymentId: string;
  projectId: string;
  projectName: string;
  chainId: number;
  contractName: string;
  address: string;
  /** Whether the ABI has owner(), so the page can check the signed-in wallet against it. */
  hasOwner: boolean;
  functions: Array<{ name: string; label: string; supported: boolean; reason?: string; sensitive: boolean; abi: AbiFunction }>;
}

/** Admin-style functions of every live contract. Replaced contracts are left out: only the newest deploy is the app's. */
export async function listAdminFunctions(db: Db, userId: string, limit = 500): Promise<AdminContract[]> {
  const rows = markLive(await ownedDeployments(db, userId, limit)).filter((r) => r.live);
  const out: AdminContract[] = [];
  for (const r of rows) {
    const abi = r.abi as Abi;
    const functions = adminFunctions(abi);
    if (!functions.length) continue;
    out.push({
      deploymentId: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      chainId: r.chainId,
      contractName: r.contractName,
      address: getAddress(r.address),
      hasOwner: abi.some((i) => i.type === "function" && i.name === "owner" && i.inputs.length === 0 && i.outputs.length === 1 && i.outputs[0].type === "address"),
      functions: functions.map(({ name, label, supported, reason, sensitive, abi: fn }) => ({ name, label, supported, reason, sensitive, abi: fn })),
    });
  }
  return out;
}
