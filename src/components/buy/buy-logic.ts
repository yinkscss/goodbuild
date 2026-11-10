export type Asset = "g" | "celo";
export type TopUpStatus = "awaiting_payment" | "paid_in" | "delivered" | "failed" | "expired";

export const MIN_NAIRA = 1_000;
export const MAX_NAIRA = 2_000_000;

/** The steps a person sees. A step is done once the order has reached its status. */
export const STEPS: Array<{ key: TopUpStatus; label: (asset: string) => string }> = [
  { key: "awaiting_payment", label: () => "Order created. Waiting for your bank transfer" },
  { key: "paid_in", label: () => "Naira received" },
  { key: "delivered", label: (asset) => `${asset} sent to your wallet` },
];

/** Position of a status in the happy path. Failed and expired come after everything, so they never move a finished order back. */
export function statusIndex(status: TopUpStatus): number {
  if (status === "awaiting_payment") return 0;
  if (status === "paid_in") return 1;
  if (status === "delivered") return 2;
  return 3;
}

export const nairaValid = (n: number) => Number.isInteger(n) && n >= MIN_NAIRA && n <= MAX_NAIRA;

/** G$ shows whole numbers (it is worth a fraction of a cent); CELO shows up to four decimals. */
export function formatAmount(value: number, asset: Asset): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: asset === "g" ? 0 : 4 });
}
