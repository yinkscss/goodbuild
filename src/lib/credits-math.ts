/** GoodBuild Credits are 6-decimal units: 1_000_000 = $1 of AI builds (D51). */
export const UNITS_PER_DOLLAR = 1_000_000;
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
