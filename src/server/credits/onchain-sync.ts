import "server-only";

import { getDb } from "@/server/db/client";
import { creditsClient } from "./chain-client";
import { creditsContract, syncRedemptions } from "./onchain";

const SYNC_MS = 60_000;
const CHAIN_IDS = [42220, 11142220];
const g = globalThis as { __gbCreditsSync?: ReturnType<typeof setInterval> };

/** Start the once-a-minute scan for `Redeemed` events (D52). One timer per process, whatever hot reload does. */
export function startCreditsSync() {
  if (g.__gbCreditsSync || !CHAIN_IDS.some((c) => creditsContract(c))) return;
  const tick = async () => {
    const db = await getDb();
    for (const chainId of CHAIN_IDS) {
      if (!creditsContract(chainId)) continue;
      try {
        await syncRedemptions(db, creditsClient(chainId), chainId);
      } catch (error) {
        console.error(`[credits] sync failed on ${chainId}`, error);
      }
    }
  };
  g.__gbCreditsSync = setInterval(() => void tick(), SYNC_MS);
  g.__gbCreditsSync.unref?.();
  void tick();
}
