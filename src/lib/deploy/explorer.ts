import { CELO_MAINNET_ID } from "@/config/gooddollar";

/** Block explorer for a Celo chain. Celo's docs point Sepolia at Blockscout (checked 5 Nov 2026). */
export function explorerBase(chainId: number): string {
  return chainId === CELO_MAINNET_ID ? "https://celoscan.io" : "https://celo-sepolia.blockscout.com";
}
export const explorerAddressUrl = (chainId: number, address: string) => `${explorerBase(chainId)}/address/${address}`;
export const explorerTxUrl = (chainId: number, hash: string) => `${explorerBase(chainId)}/tx/${hash}`;
export const chainLabel = (chainId: number) => (chainId === CELO_MAINNET_ID ? "Celo" : "Celo Sepolia");
