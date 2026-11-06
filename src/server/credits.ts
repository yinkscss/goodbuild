import "server-only";

import { getDb, type Db } from "@/server/db/client";
import { getBalanceMicro } from "@/server/credits/ledger";

export interface CreditSnapshot {
  /** The real ledger balance in micro-USD (D45). Null if it couldn't be read, which never means zero. */
  balanceMicro: number | null;
  /**
   * Always null for now. The UI reads null as "Testnet beta · free", and a 0 here would disable the
   * prompt with "Top up to keep building" for everyone. M8 moves the UI to `balanceMicro` (D38: USD only).
   */
  balanceGd: number | null;
  /** Always null for now, as above. */
  usdPerGd: number | null;
}

/**
 * The user's credit balance. Nothing shows it yet, so a failed read mustn't take the home page down:
 * it logs and reports null. Anything deciding about money must call the ledger directly.
 */
export async function getCredits(userId: string, database?: Db): Promise<CreditSnapshot> {
  let balanceMicro: number | null = null;
  try {
    balanceMicro = await getBalanceMicro(database ?? (await getDb()), userId);
  } catch (error) {
    console.warn(`[credits] couldn't read the balance: ${(error as Error).message}`);
  }
  return { balanceMicro, balanceGd: null, usdPerGd: null };
}
