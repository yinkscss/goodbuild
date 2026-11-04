/**
 * Networks for Stage 1. Testnet first (Celo Sepolia, P1); mainnet stays behind a flag.
 * Alfajores was retired on 30 Sep 2025, so it is not offered anywhere.
 */
export type NetworkId = "celo-sepolia" | "celo";

export interface NetworkOption {
  id: NetworkId;
  chainId: number;
  label: string;
  shortLabel: string;
}

export const NETWORKS: Record<NetworkId, NetworkOption> = {
  "celo-sepolia": { id: "celo-sepolia", chainId: 11142220, label: "Celo Sepolia", shortLabel: "Sepolia" },
  celo: { id: "celo", chainId: 42220, label: "Celo", shortLabel: "Celo" },
};

export const DEFAULT_NETWORK: NetworkId = "celo-sepolia";

export function isMainnetEnabled(flag: string | undefined = process.env.NEXT_PUBLIC_ENABLE_MAINNET): boolean {
  return flag === "true" || flag === "1";
}
