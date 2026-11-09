import { desc, eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { onchainCreditEvents } from "@/server/db/onchain-credits-schema";

export interface TopUp {
  id: string;
  chainId: number;
  txHash: string;
  /** Credit added, in micro-USD. */
  amountMicro: number;
  createdAt: Date;
}

/** The user's recent on-chain top-ups that the ledger has credited, newest first. */
export async function listTopUps(db: Db, userId: string, limit = 10): Promise<TopUp[]> {
  const rows = await db
    .select()
    .from(onchainCreditEvents)
    .where(eq(onchainCreditEvents.userId, userId))
    .orderBy(desc(onchainCreditEvents.createdAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, chainId: r.chainId, txHash: r.txHash, amountMicro: r.amountMicro, createdAt: r.createdAt }));
}
