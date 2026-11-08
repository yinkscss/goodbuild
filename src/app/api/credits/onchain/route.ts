import { NextResponse, connection } from "next/server";

import { creditsClient } from "@/server/credits/chain-client";
import { CREDITS_ABI, creditsContract } from "@/server/credits/onchain";

const NO_STORE = { "Cache-Control": "no-store" };
const CHAIN_IDS = [42220, 11142220];

/**
 * Where GoodBuild Credits live and what a CELO buys, for the "Add credits" screen. Public: it is the
 * same information anyone can read from the contract. A chain with no contract set shows as not live.
 */
export async function GET() {
  await connection();
  const chains = await Promise.all(
    CHAIN_IDS.map(async (chainId) => {
      const contract = creditsContract(chainId);
      if (!contract) return { chainId, live: false as const };
      try {
        const client = creditsClient(chainId);
        const [creditsPerCelo, maxPerMint, paused] = await Promise.all([
          client.readContract({ address: contract, abi: CREDITS_ABI, functionName: "creditsPerCelo" }),
          client.readContract({ address: contract, abi: CREDITS_ABI, functionName: "maxPerMint" }),
          client.readContract({ address: contract, abi: CREDITS_ABI, functionName: "paused" }),
        ]);
        return { chainId, live: !paused, contract, creditsPerCelo: creditsPerCelo.toString(), maxPerMint: maxPerMint.toString(), paused };
      } catch (error) {
        console.error("credits contract read failed", chainId, error);
        return { chainId, live: false as const, contract };
      }
    }),
  );
  return NextResponse.json({ chains, onramp: { provider: process.env.ONRAMP_PROVIDER?.trim() || null } }, { headers: NO_STORE });
}
