import { isAddress, type Address } from "viem";

/** G$ on Celo mainnet. User-confirmed (D23); it matches GoodProtocol's production-celo deployment. */
export const GOODDOLLAR_MAINNET: Address = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";

export const CELO_MAINNET_ID = 42220;
export const CELO_SEPOLIA_ID = 11142220;

/**
 * The G$ address a deploy uses on a chain (D23). Mainnet is always the real G$. Celo Sepolia has
 * no official G$, so it is GoodBuild's test G$ (src/server/deploy/test-gd, deployed with
 * `pnpm deploy:test-gd`), whose address goes in NEXT_PUBLIC_TEST_GD_ADDRESS. Null until it exists.
 */
export function goodDollarAddress(chainId: number, testAddress: string | undefined = process.env.NEXT_PUBLIC_TEST_GD_ADDRESS): Address | null {
  if (chainId === CELO_MAINNET_ID) return GOODDOLLAR_MAINNET;
  if (chainId === CELO_SEPOLIA_ID && testAddress && isAddress(testAddress, { strict: false })) return testAddress as Address;
  return null;
}

/** True when the address on this chain is GoodBuild's test token, not the real G$. */
export function isTestGoodDollar(chainId: number) {
  return chainId === CELO_SEPOLIA_ID;
}
