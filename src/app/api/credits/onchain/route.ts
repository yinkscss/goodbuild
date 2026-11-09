import { NextResponse, connection } from "next/server";

import { creditsClient } from "@/server/credits/chain-client";
import { CREDITS_ABI, creditsContract } from "@/server/credits/onchain";

const NO_STORE = { "Cache-Control": "no-store" };
const CHAIN_IDS = [42220, 11142220];

/**
 * Where GoodBuild Credits live, which token pays for them and how many are left, for the "Add credits" screen. Public: it is the
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
        const [goodDollar, maxPerQuote, remaining, paused] = await Promise.all([
          client.readContract({ address: contract, abi: CREDITS_ABI, functionName: "goodDollar" }),
          client.readContract({ address: contract, abi: CREDITS_ABI, functionName: "maxPerQuote" }),
          client.readContract({ address: contract, abi: CREDITS_ABI, functionName: "remaining" }),
          client.readContract({ address: contract, abi: CREDITS_ABI, functionName: "paused" }),
        ]);
        const ready = Boolean(process.env.CREDITS_QUOTE_SIGNER_KEY?.trim());
        return { chainId, live: !paused && ready, contract, goodDollar, maxPerQuoteMicro: maxPerQuote.toString(), remainingMicro: remaining.toString(), paused };
      } catch (error) {
        console.error("credits contract read failed", chainId, error);
        return { chainId, live: false as const, contract };
      }
    }),
  );
  return NextResponse.json({ chains, onramp: { provider: process.env.ONRAMP_PROVIDER?.trim() || null } }, { headers: NO_STORE });
}
