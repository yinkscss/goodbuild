import type { Abi } from "viem";
import { describe, expect, it } from "vitest";

import { exitFunctions } from "./exit-functions";

const fn = (name: string, inputs: string[] = [], stateMutability = "nonpayable") => ({ type: "function", name, stateMutability, outputs: [], inputs: inputs.map((type, i) => ({ type, name: `a${i}` })) });

describe("exitFunctions", () => {
  it("finds simple ways out and says what each needs", () => {
    const abi = [fn("withdraw"), fn("claimRefund", ["uint256"]), fn("withdrawTo", ["address"])] as Abi;
    expect(exitFunctions(abi).map((e) => [e.name, e.input])).toEqual([["withdraw", "none"], ["claimRefund", "amount"], ["withdrawTo", "wallet"]]);
  });

  it("ignores everything else", () => {
    const abi = [
      fn("tip", ["uint256"]),
      fn("withdrawable", [], "view"),
      fn("withdrawFor", ["address", "uint256"]),
      fn("withdrawNote", ["string"]),
      { type: "event", name: "withdraw", inputs: [] },
    ] as Abi;
    expect(exitFunctions(abi)).toEqual([]);
  });
});
