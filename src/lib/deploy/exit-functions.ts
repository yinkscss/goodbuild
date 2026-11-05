import type { Abi, AbiFunction } from "viem";

/** A function on an old contract that may let funds out, and what it needs from the user. */
export interface ExitFunction {
  name: string;
  input: "none" | "amount" | "wallet";
  abi: AbiFunction;
}

const EXIT_NAME = /^(withdraw|claim|refund|redeem|exit|rescue|sweep)/i;

/**
 * Functions we can offer as a button, chosen from the contract's own ABI. Only simple shapes: anything
 * needing other arguments would mean guessing. The name is just a hint, so every call is simulated
 * first and the chain decides whether this wallet may run it.
 */
export function exitFunctions(abi: Abi): ExitFunction[] {
  const out: ExitFunction[] = [];
  for (const item of abi) {
    if (item.type !== "function" || item.stateMutability !== "nonpayable" || !EXIT_NAME.test(item.name)) continue;
    const [first, ...rest] = item.inputs;
    if (rest.length) continue;
    if (!first) out.push({ name: item.name, input: "none", abi: item });
    else if (first.type === "uint256") out.push({ name: item.name, input: "amount", abi: item });
    else if (first.type === "address") out.push({ name: item.name, input: "wallet", abi: item });
  }
  return out;
}

export interface OldContract {
  name: string;
  address: `0x${string}`;
  /** G$ it holds, in wei as a string. */
  gdBalance: string;
  exits: ExitFunction[];
}
