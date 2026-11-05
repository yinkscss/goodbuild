import type { Address, Hex, PublicClient } from "viem";

import { OPCODE_ERROR } from "./errors";
import { NEW_OPCODES, newOpcodesUsed } from "./opcodes";

/** Thrown when the target chain doesn't implement an instruction the bytecode uses (D17). */
export class UnsupportedOpcodeError extends Error {
  readonly code = "opcode";
  constructor(readonly opcodes: string[]) {
    super(`This network doesn't support ${opcodes.join(", ")} yet.`);
    this.name = "UnsupportedOpcodeError";
  }
}

const PROBE_ADDRESS: Address = "0x00000000000000000000000000000000000b10b1";

/**
 * Ask the chain whether one opcode exists: run a two-instruction program at a scratch address
 * through eth_call with a state override. Returns true/false, or null if the RPC can't tell
 * (no state-override support), in which case the creation simulation is the only check.
 */
export async function chainSupportsOpcode(client: Pick<PublicClient, "call">, name: string): Promise<boolean | null> {
  const probe = NEW_OPCODES[name];
  if (!probe) return true;
  try {
    await client.call({ to: PROBE_ADDRESS, data: "0x", stateOverride: [{ address: PROBE_ADDRESS, code: probe.probe }] });
    return true;
  } catch (error) {
    const text = `${(error as Error).message ?? ""} ${(error as { details?: string }).details ?? ""}`;
    if (OPCODE_ERROR.test(text)) return false;
    return null;
  }
}

export interface SimulateArgs {
  account: Address;
  /** Creation data: bytecode plus ABI-encoded constructor arguments. Or a call's data, with `to`. */
  data: Hex;
  /** Runtime bytecode, scanned for opcodes the chain may not know. */
  runtimeBytecode?: Hex;
  /** A call to a live contract instead of a creation: pointing a proxy at new code (D33). */
  to?: Address;
}

/**
 * Pre-deploy simulation (D17): fail loudly on a rejected bytecode, before the user signs.
 * 1. Every post-Paris opcode in the runtime code must exist on the chain.
 * 2. The creation transaction must succeed in eth_estimateGas, which also catches constructor
 *    reverts (a bad argument) and returns the gas to show in the summary.
 * 3. The wallet must hold enough CELO to pay for it.
 */
export async function simulateCreation(client: Pick<PublicClient, "call" | "estimateGas" | "getBalance" | "getGasPrice">, args: SimulateArgs): Promise<{ gas: bigint }> {
  const used = args.runtimeBytecode ? newOpcodesUsed(args.runtimeBytecode) : [];
  const missing: string[] = [];
  for (const name of used) if ((await chainSupportsOpcode(client, name)) === false) missing.push(name);
  if (missing.length) throw new UnsupportedOpcodeError(missing);
  const gas = await client.estimateGas({ account: args.account, data: args.data, to: args.to });
  // Some wallets (Magic's among them) answer an unfunded send with a bare "internal error".
  const [balance, price] = await Promise.all([client.getBalance({ address: args.account }), client.getGasPrice()]);
  if (balance < gas * price) throw Object.assign(new Error("insufficient funds for the network fee"), { code: "insufficient_funds" });
  return { gas };
}
