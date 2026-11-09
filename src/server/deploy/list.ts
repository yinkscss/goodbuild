import { desc, eq } from "drizzle-orm";
import { getAddress } from "viem";

import type { Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { projects } from "@/server/db/schema";

export interface UserDeployment {
  id: string;
  projectId: string;
  projectName: string;
  chainId: number;
  contractName: string;
  address: string;
  txHash: string;
  /** pending | verified | failed | unsupported */
  verifyStatus: string;
  verifyProvider: string | null;
  upgradeable: boolean;
  createdAt: Date;
}

/** Every contract this user has deployed, across all their projects, newest first. Only their own rows. */
export async function listUserDeployments(db: Db, userId: string, limit = 200): Promise<UserDeployment[]> {
  const rows = await db
    .select({ d: deployments, projectName: projects.name })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .where(eq(deployments.userId, userId))
    .orderBy(desc(deployments.createdAt))
    .limit(limit);
  return rows.map(({ d, projectName }) => ({
    id: d.id,
    projectId: d.projectId,
    projectName,
    chainId: d.chainId,
    contractName: d.contractName,
    address: getAddress(d.address),
    txHash: d.txHash,
    verifyStatus: d.verifyStatus,
    verifyProvider: d.verifyProvider,
    upgradeable: Boolean(d.proxy),
    createdAt: d.createdAt,
  }));
}
