import type { Address } from "viem";

import { CELO_MAINNET_ID, CELO_SEPOLIA_ID } from "./gooddollar";

/**
 * The dollar stablecoins MiniPay holds (D74), on both Celo networks. Addresses are from Celo's fee
 * currency page (docs.celo.org/build/tools/contracts/fee-currencies) and each was read back from the
 * chain on 10 Nov 2026: a contract is there, with this symbol and these decimals. MiniPay's own
 * docs list different Celo Sepolia addresses; on that date none of them had a contract.
 *
 * `feeCurrency` is what a transaction names to pay its network fee in that coin. For the 6-decimal
 * coins it is an adapter, not the token: never send tokens to it.
 */
export type StablecoinSymbol = "USDT" | "USDC" | "USDM";

export interface Stablecoin {
  symbol: StablecoinSymbol;
  /** What people see. */
  label: string;
  address: Address;
  decimals: number;
  feeCurrency: Address;
}

export const STABLECOINS: Record<number, Record<StablecoinSymbol, Stablecoin>> = {
  [CELO_MAINNET_ID]: {
    USDT: { symbol: "USDT", label: "USDT", address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6, feeCurrency: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72" },
    USDC: { symbol: "USDC", label: "USDC", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6, feeCurrency: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B" },
    USDM: { symbol: "USDM", label: "USDm", address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18, feeCurrency: "0x765DE816845861e75A25fCA122bb6898B8B1282a" },
  },
  [CELO_SEPOLIA_ID]: {
    USDT: { symbol: "USDT", label: "USDT", address: "0xd077A400968890Eacc75cdc901F0356c943e4fDb", decimals: 6, feeCurrency: "0xe19447B12cb0d0220B2a501D8382be2f61CcF92a" },
    USDC: { symbol: "USDC", label: "USDC", address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E", decimals: 6, feeCurrency: "0xbf1441Ea57f43f35f713431001f35742c88071c7" },
    USDM: { symbol: "USDM", label: "USDm", address: "0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b", decimals: 18, feeCurrency: "0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b" },
  },
};

export const STABLECOIN_SYMBOLS: StablecoinSymbol[] = ["USDT", "USDC", "USDM"];

export function stablecoin(symbol: StablecoinSymbol, chainId: number): Stablecoin | null {
  return STABLECOINS[chainId]?.[symbol] ?? null;
}
