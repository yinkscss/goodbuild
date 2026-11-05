import { createWalletClient, custom, type EIP1193Provider, type WalletClient } from "viem";
import { celo, celoSepolia } from "viem/chains";

/** The Celo chains GoodBuild signs on (viem definitions, D17 / P1). */
export const CELO_CHAINS = { [celoSepolia.id]: celoSepolia, [celo.id]: celo } as const;

export function celoChainFor(chainId: number | null | undefined) {
  return chainId === celo.id ? celo : celoSepolia;
}

/**
 * One viem wallet client from any EIP-1193 provider: Magic's `rpcProvider`, an injected
 * wallet (MetaMask, MiniPay) or WalletConnect. Deploy code only ever sees this type (D22).
 */
export function walletClientFor(provider: EIP1193Provider, address: `0x${string}`, chainId: number | null): WalletClient {
  return createWalletClient({ account: address, chain: celoChainFor(chainId), transport: custom(provider) });
}

/** Switch a wallet to a Celo chain, adding it first if the wallet doesn't know it (error 4902). */
export async function switchWalletChain(client: WalletClient, chainId: number): Promise<void> {
  const chain = celoChainFor(chainId);
  try {
    await client.switchChain({ id: chain.id });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await client.addChain({ chain });
    await client.switchChain({ id: chain.id });
  }
}
