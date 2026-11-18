"use client";

import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

import { useAuth } from "@/lib/auth/context";

/** GoodDollar's UBI contract on Celo mainnet (same as GOODDOLLAR_UBI in server/goodid.ts). */
export const GOODDOLLAR_UBI = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1" as const;

const UBI_ABI = [
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "checkEntitlement", stateMutability: "view", inputs: [{ name: "_member", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export class UbiClaimError extends Error {
  constructor(
    message: string,
    readonly needsCelo = false,
  ) {
    super(message);
  }
}

/**
 * Claim today's G$ UBI from the signed-in wallet, on Celo mainnet whatever network the builder is on
 * (D123). The person signs the transaction and pays its small CELO fee. Resolves once it's mined.
 * If GoodDollar says nothing is due (claimed already today, from any linked wallet), it sends nothing.
 */
export function useClaimUbi() {
  const auth = useAuth();
  return async function claimUbi(): Promise<void> {
    const wallet = (auth.wallet?.address ?? auth.user?.wallet) as `0x${string}` | undefined;
    if (!wallet) throw new UbiClaimError("Connect the wallet you signed in with, then try again.");
    const reader = createPublicClient({ chain: celo, transport: http() });
    const due = await reader.readContract({ address: GOODDOLLAR_UBI, abi: UBI_ABI, functionName: "checkEntitlement", args: [wallet] }).catch(() => null);
    if (due === BigInt(0)) return;
    try {
      if (auth.wallet?.chainId !== celo.id) await auth.switchChain(celo.id);
      const client = await auth.getWalletClient();
      const hash = await client.writeContract({ account: wallet, chain: celo, address: GOODDOLLAR_UBI, abi: UBI_ABI, functionName: "claim" });
      await reader.waitForTransactionReceipt({ hash, timeout: 120_000 });
    } catch (error) {
      const text = (error as Error).message ?? "";
      if (/gas required exceeds|insufficient funds/i.test(text)) throw new UbiClaimError("You need a little CELO on Celo for the network fee to claim G$.", true);
      if (/user rejected|denied|rejected the request/i.test(text)) throw new UbiClaimError("You cancelled it in your wallet. Nothing was claimed.");
      if (/not whitelisted/i.test(text)) throw new UbiClaimError("GoodDollar doesn't see this wallet as verified yet.");
      throw new UbiClaimError("We couldn't claim your G$. Try again in a moment.");
    }
  };
}
