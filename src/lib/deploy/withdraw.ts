import { createPublicClient, http, type Address, type Hex, type WalletClient } from "viem";

import { celoChainFor } from "@/lib/auth/wallet-client";
import type { ExitFunction } from "./exit-functions";
import { classifyDeployError } from "./errors";

/** Plain words for a failed withdrawal. The important part: nothing moved. */
export function withdrawErrorMessage(error: unknown): string {
  const classified = classifyDeployError(error);
  if (classified.kind === "user_rejected") return "You cancelled in your wallet. Nothing moved.";
  return "The contract didn't allow this, so nothing moved. It may need a different wallet, such as the owner's, or a different amount.";
}

/** Simulate first, so a call the contract would refuse never reaches the wallet. */
export async function runExit(args: {
  client: WalletClient;
  account: Address;
  chainId: number;
  embedded: boolean;
  contract: Address;
  exit: ExitFunction;
  amount?: bigint;
}): Promise<Hex> {
  const chain = celoChainFor(args.chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  const callArgs = args.exit.input === "none" ? [] : args.exit.input === "wallet" ? [args.account] : [args.amount ?? BigInt(0)];
  const call = { address: args.contract, abi: [args.exit.abi], functionName: args.exit.name, args: callArgs, account: args.account } as const;
  await publicClient.simulateContract(call);
  // Email wallets get explicit gas and fees, as deploys do: left to itself, Magic can fail on a custom network.
  const fees = args.embedded ? { gas: (await publicClient.estimateContractGas(call) * BigInt(13)) / BigInt(10), ...(await publicClient.estimateFeesPerGas()) } : {};
  const hash = await args.client.writeContract({ ...call, chain, ...fees } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw Object.assign(new Error("execution reverted"), { code: "reverted" });
  return hash;
}
