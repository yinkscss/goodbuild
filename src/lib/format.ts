import { celo, celoSepolia } from "viem/chains";

/** 0x7a3…e41c */
export function shortAddress(address: string, head = 5, tail = 4): string {
  if (!address || address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

const EXPLORERS: Record<number, string | undefined> = {
  [celo.id]: celo.blockExplorers?.default.url,
  [celoSepolia.id]: celoSepolia.blockExplorers?.default.url,
};

/** Address page on the chain's default explorer (from viem's chain definitions). */
export function explorerAddressUrl(chainId: number, address: string): string | null {
  const base = EXPLORERS[chainId];
  return base ? `${base.replace(/\/$/, "")}/address/${address}` : null;
}

export function chainName(chainId: number | null): string {
  if (chainId === celo.id) return "Celo";
  if (chainId === celoSepolia.id) return "Celo Sepolia";
  return chainId === null ? "Unknown network" : `Chain ${chainId}`;
}
