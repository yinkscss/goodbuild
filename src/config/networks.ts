/**
 * Networks for Stage 1. Celo mainnet is the default; Celo Sepolia stays one tap away for testing. Who may deploy to mainnet is a server
 * setting that changes while the app runs (D50), so nothing here knows about it.
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

export const DEFAULT_NETWORK: NetworkId = "celo";
