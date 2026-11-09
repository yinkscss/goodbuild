import { getAddress, type Address } from "viem";

/** The deployed contract for a chain, from CREDITS_CONTRACT_<chainId>. Null when none is set, and in production for any chain but Celo mainnet. */
export function creditsContract(chainId: number, env: NodeJS.ProcessEnv = process.env): Address | null {
  // Test G$ is free, so in production only Celo mainnet may mint credits: a Sepolia contract would turn faucet tokens into real AI.
  if (env.NODE_ENV === "production" && chainId !== 42220 && env.CREDITS_ALLOW_TESTNET !== "1") return null;
  const raw = env[`CREDITS_CONTRACT_${chainId}`]?.trim();
  return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? getAddress(raw) : null;
}
