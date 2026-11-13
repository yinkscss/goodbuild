import { getContractAddress, type Address, type Hex } from "viem";

/**
 * What became of a deploy transaction the wallet already sent, before anything asks for a second
 * signature (GB-03). A receipt timeout doesn't mean the transaction was dropped: it can still be
 * waiting, or the node we asked can be behind. Each wallet nonce can be used once, so the nonce the
 * transaction went out with tells "slow" apart from "dropped" and "replaced":
 *
 * - `mined`: it has a receipt; wait for it as usual and record it.
 * - `pending`: the node knows it but it isn't in a block yet; keep waiting, send nothing.
 * - `dropped`: nobody knows it and its nonce is still free; send again with that same nonce, so at
 *   most one of the two can ever be mined.
 * - `replaced`: its nonce was used by another transaction (the wallet's speed up or cancel). For a
 *   creation, `contract` is the contract that nonce made, if one exists there now.
 * - `unknown`: nobody knows it and no nonce was saved, so we can't tell. The owner decides.
 */
export type SentStatus =
  | { kind: "mined" }
  | { kind: "pending" }
  | { kind: "dropped"; nonce: number }
  | { kind: "replaced"; contract: Address | null }
  | { kind: "unknown" };

/** The four reads it needs, typed loosely so a Celo client (with its own transaction types) fits. */
export interface ReconcileClient {
  getTransactionReceipt(args: { hash: Hex }): Promise<unknown>;
  getTransaction(args: { hash: Hex }): Promise<unknown>;
  getTransactionCount(args: { address: Address; blockTag: "latest" }): Promise<number>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
}

const notFound = (error: unknown, name: string) => (error as { name?: string } | null)?.name === name;

export async function checkSentTx(client: ReconcileClient, { hash, account, nonce, creation }: { hash: Hex; account: Address; nonce?: number; creation: boolean }): Promise<SentStatus> {
  try {
    await client.getTransactionReceipt({ hash });
    return { kind: "mined" };
  } catch (error) {
    // Anything but "not found" is the network failing to answer: let it surface, and send nothing.
    if (!notFound(error, "TransactionReceiptNotFoundError")) throw error;
  }
  try {
    await client.getTransaction({ hash });
    return { kind: "pending" };
  } catch (error) {
    if (!notFound(error, "TransactionNotFoundError")) throw error;
  }
  if (nonce === undefined) return { kind: "unknown" };
  const used = await client.getTransactionCount({ address: account, blockTag: "latest" });
  if (used <= nonce) return { kind: "dropped", nonce };
  if (!creation) return { kind: "replaced", contract: null };
  const contract = getContractAddress({ from: account, nonce: BigInt(nonce) });
  const code = await client.getCode({ address: contract });
  return { kind: "replaced", contract: code && code !== "0x" ? contract : null };
}
