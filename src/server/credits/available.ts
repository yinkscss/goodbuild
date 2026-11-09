import "server-only";

import type { Db } from "@/server/db/client";
import { freeRemainingMicro } from "./cap";

/** What a person can spend on builds: paid credit plus the free AI still left (free is used first). Null when the paid balance can't be read. */
export async function availableMicro(db: Db, userId: string, paidMicro: number | null): Promise<number | null> {
  if (paidMicro === null) return null;
  const free = await freeRemainingMicro(db, userId).catch(() => 0);
  return paidMicro + (free ?? 0);
}
