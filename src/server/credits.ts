import "server-only";

export interface CreditSnapshot {
  /** G$ balance; null until the credits ledger exists (M6, CREDITS.md). */
  balanceGd: number | null;
  /** USD per G$ at the latest price snapshot; null until M6. */
  usdPerGd: number | null;
}

/**
 * The user's credit balance. Until the vault and ledger ship (M6) this returns
 * nulls, and the UI says "Testnet beta · free" rather than inventing a balance.
 */
export async function getCredits(userId: string): Promise<CreditSnapshot> {
  void userId;
  return { balanceGd: null, usdPerGd: null };
}
