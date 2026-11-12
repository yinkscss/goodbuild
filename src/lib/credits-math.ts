/** GoodBuild Credits are 6-decimal units: 1_000_000 = $1 of AI builds (D51). */
export const UNITS_PER_DOLLAR = 1_000_000;
/**
 * What people see is credits, not dollars: 1 credit = $0.01 = 10_000 units. Storage, the ledger and billing
 * stay in micro-USD; this is display only.
 */
export const MICRO_PER_CREDIT = 10_000;

/** Whole credits for a micro-USD amount (rounded), e.g. 2_500_000 -> 250. */
export function microToCredits(micro: number): number {
  return Math.round(micro / MICRO_PER_CREDIT);
}

/** "250 credits", "1 credit", "< 1 credit" for a nonzero amount under half a credit. */
export function formatCredits(micro: number): string {
  const credits = microToCredits(micro);
  if (micro > 0 && credits < 1) return "< 1 credit";
  return `${credits.toLocaleString("en-US")} ${credits === 1 ? "credit" : "credits"}`;
}

/** Just the number, for tight spots that add their own label: "250". */
export function formatCreditsShort(micro: number): string {
  return microToCredits(micro).toLocaleString("en-US");
}

const WEI_PER_CELO = BigInt(10) ** BigInt(18);

/** CELO (wei) needed to buy `dollars` of credit at `creditsPerCelo` units per CELO. Rounds up so it never comes up short. */
export function weiForDollars(dollars: number, creditsPerCelo: bigint): bigint {
  if (!(dollars > 0) || creditsPerCelo <= BigInt(0)) return BigInt(0);
  const units = BigInt(Math.round(dollars * UNITS_PER_DOLLAR));
  return (units * WEI_PER_CELO + creditsPerCelo - BigInt(1)) / creditsPerCelo;
}

export function creditsForWei(wei: bigint, creditsPerCelo: bigint): bigint {
  return (wei * creditsPerCelo) / WEI_PER_CELO;
}

export function formatCelo(wei: bigint): string {
  const whole = wei / WEI_PER_CELO;
  const frac = ((wei % WEI_PER_CELO) * BigInt(10000)) / WEI_PER_CELO;
  return `${whole}.${frac.toString().padStart(4, "0")}`;
}
