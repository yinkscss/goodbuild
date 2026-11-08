import { getAddress, type Address } from "viem";

/** The deployed contract for a chain, from CREDITS_CONTRACT_<chainId>. Null when none is set. */
export function creditsContract(chainId: number, env: NodeJS.ProcessEnv = process.env): Address | null {
  const raw = env[`CREDITS_CONTRACT_${chainId}`]?.trim();
  return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? getAddress(raw) : null;
}
