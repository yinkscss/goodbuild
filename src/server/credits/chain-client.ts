import "server-only";

import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { celo, celoSepolia } from "viem/chains";

const CHAINS = { [celo.id]: celo, [celoSepolia.id]: celoSepolia } as const;

/** Chains GoodBuild Credits can live on. */
export function creditsChain(chainId: number) {
  return CHAINS[chainId as keyof typeof CHAINS] ?? null;
}

/**
 * A read client for a chain. Mainnet tries CELO_RPC_URL first (a paid or private node), then the
 * public forno node, so one provider being down doesn't stop crediting (C5).
 */
export function creditsClient(chainId: number): PublicClient {
  const chain = creditsChain(chainId);
  if (!chain) throw new Error(`Unsupported chain ${chainId}`);
  const override = chainId === celo.id ? process.env.CELO_RPC_URL?.trim() : process.env.CELO_SEPOLIA_RPC_URL?.trim();
  const transports = [...(override ? [http(override)] : []), http(chain.rpcUrls.default.http[0])];
  return createPublicClient({ chain, transport: fallback(transports) }) as PublicClient;
}
