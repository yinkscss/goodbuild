import { describe, expect, it, vi } from "vitest";
import type { Abi, Address, Hex } from "viem";

import { classifyDeployError } from "./errors";
import { newOpcodesUsed } from "./opcodes";
import { runDeploy, StepFailure, usesGoodDollar, type DeployEnv, type DeployEvent, type DeployProgress, type Plan } from "./run";
import { chainSupportsOpcode, simulateCreation, UnsupportedOpcodeError } from "./simulate";

const A: Address = "0x1111111111111111111111111111111111111111";
const GD: Address = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const ctor = (...inputs: Array<[string, string]>) => ({ type: "constructor", stateMutability: "nonpayable", inputs: inputs.map(([name, type]) => ({ name, type })) });

const plan = (over: Partial<Plan> = {}): Plan => ({
  runId: "run-1",
  chainId: 11142220,
  compilerVersion: "0.8.28+commit.7893614a",
  openZeppelin: "5.6.1",
  gooddollar: GD,
  alreadyDeployed: {},
  steps: [
    { name: "Token", abi: [ctor()] as unknown as Abi, bytecode: "0x6001", args: {}, dependsOn: [] },
    { name: "Pool", abi: [ctor(["gd_", "address"], ["token_", "address"])] as unknown as Abi, bytecode: "0x6002", args: { gd_: "${GOODDOLLAR}", token_: "${Token.address}" }, dependsOn: ["Token"] },
  ],
  ...over,
});

function env(over: Partial<DeployEnv> = {}) {
  let n = 0;
  const sent: Hex[] = [];
  const e: DeployEnv = {
    account: A,
    simulate: vi.fn(async () => ({ gas: BigInt(100) })),
    send: vi.fn(async (data: Hex) => {
      sent.push(data);
      return `0x${(++n).toString(16).padStart(64, "0")}` as Hex;
    }),
    waitForReceipt: vi.fn(async () => ({ status: "success" as const })),
    record: vi.fn(async (step) => ({ address: (step.name === "Token" ? "0x2222222222222222222222222222222222222222" : "0x3333333333333333333333333333333333333333") as Address })),
    ...over,
  };
  return { e, sent };
}

describe("runDeploy", () => {
  it("deploys in order with one signature each and feeds the first address into the second", async () => {
    const { e, sent } = env();
    const events: DeployEvent[] = [];
    const out = await runDeploy(plan(), e, (ev) => events.push(ev));
    expect(out).toEqual({ Token: "0x2222222222222222222222222222222222222222", Pool: "0x3333333333333333333333333333333333333333" });
    expect(e.send).toHaveBeenCalledTimes(2);
    // Pool's creation data ends with the encoded (G$, Token) arguments.
    expect(sent[1].toLowerCase()).toContain(GD.slice(2).toLowerCase());
    expect(sent[1].toLowerCase()).toContain("2222222222222222222222222222222222222222");
    const phases = events.filter((x) => x.type === "phase" && x.step === "Token").map((x) => (x as { phase: string }).phase);
    expect(phases).toEqual(["waiting", "simulating", "signing", "broadcasting", "recording", "done"]);
  });

  it("keeps the first contract when the second fails, and resumes without redeploying it", async () => {
    const first = env({ send: vi.fn(async (data: Hex) => (data.includes("6002") ? Promise.reject(Object.assign(new Error("User rejected"), { code: 4001 })) : ("0x" + "01".repeat(32)) as Hex)) });
    const err = await runDeploy(plan(), first.e).catch((x) => x as StepFailure);
    expect(err).toBeInstanceOf(StepFailure);
    expect((err as StepFailure).step).toBe("Pool");
    expect((err as StepFailure).error.kind).toBe("user_rejected");
    expect(first.e.record).toHaveBeenCalledTimes(1);

    const second = env();
    const out = await runDeploy(plan({ alreadyDeployed: { Token: "0x2222222222222222222222222222222222222222" } }), second.e);
    expect(second.e.send).toHaveBeenCalledTimes(1); // only the Pool
    expect(out.Pool).toBeDefined();
  });

  it("Try again with the same progress never redeploys a finished contract", async () => {
    const progress: DeployProgress = { deployed: {}, sent: {} };
    let rejectPool = true;
    const { e } = env({
      send: vi.fn(async (data: Hex) => {
        if (data.includes("6002") && rejectPool) throw Object.assign(new Error("User rejected"), { code: 4001 });
        return `0x${(data.includes("6002") ? "02" : "01").repeat(32)}` as Hex;
      }),
    });
    await expect(runDeploy(plan(), e, undefined, progress)).rejects.toBeInstanceOf(StepFailure);
    expect(progress.deployed.Token).toBeDefined();

    rejectPool = false;
    const out = await runDeploy(plan(), e, undefined, progress);
    expect(out.Pool).toBeDefined();
    expect((e.send as ReturnType<typeof vi.fn>).mock.calls.filter(([d]) => !String(d).includes("6002"))).toHaveLength(1);
    expect(e.record).toHaveBeenCalledTimes(2);
  });

  it("a failed record keeps the mined transaction: the retry records it without a new signature", async () => {
    const progress: DeployProgress = { deployed: {}, sent: {} };
    let down = true;
    const record = vi.fn(async () => {
      if (down) throw new Error("server down");
      return { address: A };
    });
    const { e } = env({ record });
    await expect(runDeploy(plan({ steps: plan().steps.slice(0, 1) }), e, undefined, progress)).rejects.toBeInstanceOf(StepFailure);
    down = false;
    await runDeploy(plan({ steps: plan().steps.slice(0, 1) }), e, undefined, progress);
    expect(e.send).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(2);
    expect(progress.sent).toEqual({});
  });

  it("a reverted transaction is not reused: the retry sends a new one", async () => {
    const progress: DeployProgress = { deployed: {}, sent: {} };
    const receipts: Array<"reverted" | "success"> = ["reverted", "success"];
    const { e } = env({ waitForReceipt: vi.fn(async () => ({ status: receipts.shift()! })) });
    const one = plan({ steps: plan().steps.slice(0, 1) });
    await expect(runDeploy(one, e, undefined, progress)).rejects.toBeInstanceOf(StepFailure);
    await runDeploy(one, e, undefined, progress);
    expect(e.send).toHaveBeenCalledTimes(2);
  });

  it("a transaction that never mines is dropped, so the retry isn't stuck waiting on it", async () => {
    const progress: DeployProgress = { deployed: {}, sent: {} };
    const timeout = Object.assign(new Error("timed out"), { name: "WaitForTransactionReceiptTimeoutError" });
    const { e } = env({ waitForReceipt: vi.fn(async () => Promise.reject(timeout)) });
    await expect(runDeploy(plan({ steps: plan().steps.slice(0, 1) }), e, undefined, progress)).rejects.toBeInstanceOf(StepFailure);
    expect(progress.sent).toEqual({});
  });

  it("resumes a transaction remembered from before a reload, without a new signature", async () => {
    const progress: DeployProgress = { deployed: {}, sent: { Token: `0x${"09".repeat(32)}` } };
    const { e } = env();
    await runDeploy(plan({ steps: plan().steps.slice(0, 1) }), e, undefined, progress);
    expect(e.send).not.toHaveBeenCalled();
    expect(e.record).toHaveBeenCalledTimes(1);
  });

  it("knows whether a plan uses G$", () => {
    expect(usesGoodDollar(plan())).toBe(true);
    expect(usesGoodDollar({ steps: plan().steps.slice(0, 1) })).toBe(false);
  });

  it("stops before signing when the simulation fails, and says it was the bytecode", async () => {
    const { e } = env({ simulate: vi.fn(async () => Promise.reject(new UnsupportedOpcodeError(["MCOPY"]))) });
    const err = (await runDeploy(plan(), e).catch((x) => x)) as StepFailure;
    expect(err.error.kind).toBe("opcode");
    expect(err.opcodes).toEqual(["MCOPY"]);
    expect(e.send).not.toHaveBeenCalled();
  });

  it("reports an on-chain revert after broadcasting", async () => {
    const { e } = env({ waitForReceipt: vi.fn(async () => ({ status: "reverted" as const })) });
    const err = (await runDeploy(plan(), e).catch((x) => x)) as StepFailure;
    expect(err.error.kind).toBe("revert");
    expect(e.record).not.toHaveBeenCalled();
  });

  it("fails on a missing G$ address instead of sending a bad constructor argument", async () => {
    const { e } = env();
    const err = (await runDeploy(plan({ gooddollar: null }), e).catch((x) => x)) as StepFailure;
    expect(err).toBeInstanceOf(StepFailure);
    expect(e.send).toHaveBeenCalledTimes(1); // Token went out; Pool never did
  });
});

describe("opcode scan and probes", () => {
  it("finds MCOPY in code but not inside PUSH data or the metadata trailer", () => {
    // PUSH2 0x5e5e (data, not code), then MCOPY, then STOP, then a 2-byte CBOR trailer of length 0x0001 holding 0x5e.
    expect(newOpcodesUsed("0x615e5e5e00" as Hex)).toEqual(["MCOPY"]);
    expect(newOpcodesUsed("0x615e5e00" as Hex)).toEqual([]);
    expect(newOpcodesUsed("0x5f00" as Hex)).toEqual(["PUSH0"]);
    expect(newOpcodesUsed(("0x00" + "5e" + "0001") as Hex)).toEqual([]);
  });

  it("says unsupported only for an invalid-opcode answer, and unknown when the RPC can't tell", async () => {
    const reject = (m: string) => ({ call: vi.fn(async () => Promise.reject(new Error(m))) });
    expect(await chainSupportsOpcode(reject("invalid opcode: opcode 0x5e not defined"), "MCOPY")).toBe(false);
    expect(await chainSupportsOpcode(reject("state override not supported"), "MCOPY")).toBeNull();
    expect(await chainSupportsOpcode({ call: vi.fn(async () => ({ data: "0x" as Hex })) }, "MCOPY")).toBe(true);
  });

  it("stops before signing when the wallet can't pay the network fee, and says so", async () => {
    const client = { call: vi.fn(), estimateGas: vi.fn(async () => BigInt(1234)), getBalance: vi.fn(async () => BigInt(0)), getGasPrice: vi.fn(async () => BigInt(2)) };
    const error = await simulateCreation(client as never, { account: A, data: "0x60" }).catch((e: unknown) => e);
    expect(classifyDeployError(error).kind).toBe("insufficient_funds");
  });

  it("simulateCreation throws UnsupportedOpcodeError before estimating gas", async () => {
    const client = { call: vi.fn(async () => Promise.reject(new Error("invalid opcode: opcode 0x5e not defined"))), estimateGas: vi.fn(async () => BigInt(1)) };
    await expect(simulateCreation(client as never, { account: A, data: "0x60", runtimeBytecode: "0x5e00" as Hex })).rejects.toBeInstanceOf(UnsupportedOpcodeError);
    expect(client.estimateGas).not.toHaveBeenCalled();
  });

  it("returns gas for a clean bytecode", async () => {
    const client = { call: vi.fn(async () => ({ data: "0x" as Hex })), estimateGas: vi.fn(async () => BigInt(1234)), getBalance: vi.fn(async () => BigInt(10_000)), getGasPrice: vi.fn(async () => BigInt(2)) };
    expect(await simulateCreation(client as never, { account: A, data: "0x60", runtimeBytecode: "0x5e00" as Hex })).toEqual({ gas: BigInt(1234) });
  });
});
