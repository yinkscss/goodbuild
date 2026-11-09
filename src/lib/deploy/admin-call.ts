import { createPublicClient, http, type AbiFunction, type Address, type Hex, type WalletClient } from "viem";

import { celoChainFor } from "@/lib/auth/wallet-client";

/** Read owner() with the public RPC. Null when the contract has none or the read fails. */
export async function readOwner(chainId: number, contract: Address): Promise<Address | null> {
  try {
    const client = createPublicClient({ chain: celoChainFor(chainId), transport: http() });
    const owner = await client.readContract({
      address: contract,
      abi: [{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address", name: "" }] }] as const,
      functionName: "owner",
    });
    return owner;
  } catch {
    return null;
  }
}

/** Simulate first so a call the contract would refuse never reaches the wallet, then sign in the user's own wallet. Keys never leave it. */
export async function runAdminCall(args: { client: WalletClient; account: Address; chainId: number; embedded: boolean; contract: Address; fn: AbiFunction; callArgs: unknown[] }): Promise<Hex> {
  const chain = celoChainFor(args.chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  const call = { address: args.contract, abi: [args.fn], functionName: args.fn.name, args: args.callArgs, account: args.account } as const;
  await publicClient.simulateContract(call as never);
  const fees = args.embedded ? { gas: ((await publicClient.estimateContractGas(call as never)) * BigInt(13)) / BigInt(10), ...(await publicClient.estimateFeesPerGas()) } : {};
  const hash = await args.client.writeContract({ ...call, chain, ...fees } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw Object.assign(new Error("execution reverted"), { code: "reverted" });
  return hash;
}
