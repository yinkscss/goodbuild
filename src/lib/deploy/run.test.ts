import { describe, expect, it, vi } from "vitest";
import type { Abi, Address, Hex } from "viem";

import { classifyDeployError, errorDetail } from "./errors";
import { newOpcodesUsed } from "./opcodes";
import { runDeploy, SIMULATE_TIMEOUT_MS, StepFailure, usesGoodDollar, withDeadline, type DeployEnv, type DeployEvent, type DeployProgress, type Plan } from "./run";
import { chainSupportsOpcode, simulateCreation, UnsupportedOpcodeError } from "./simulate";
import { encodeUpgrade } from "./upgradeable";

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
  replaces: [],
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

  it("stops waiting on a chain check that never answers, so the modal can offer Try again", async () => {
    // The Playwright run on 6 Nov 2026 sat on "Checking on Celo…" because the RPC fetch never settled.
    vi.useFakeTimers();
    try {
      const { e } = env({ simulate: vi.fn(() => new Promise<never>(() => undefined)) });
      const events: DeployEvent[] = [];
      const run = runDeploy(plan({ steps: plan().steps.slice(0, 1) }), e, (ev) => events.push(ev)).catch((x: unknown) => x);
      await vi.advanceTimersByTimeAsync(SIMULATE_TIMEOUT_MS + 10);
      const err = (await run) as StepFailure;
      expect(err).toBeInstanceOf(StepFailure);
      expect(err.error.kind).toBe("timeout");
      expect(err.error.message).toMatch(/nothing was sent/i);
      expect(e.send).not.toHaveBeenCalled();
      expect(events.at(-1)).toMatchObject({ phase: "failed" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a deadline rejects a promise that never settles, and passes a quick one through", async () => {
    vi.useFakeTimers();
    try {
      const slow = withDeadline(new Promise<never>(() => undefined), 1000).catch((x: Error & { code?: string }) => x.code);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await slow).toBe("rpc_timeout");
      await expect(withDeadline(Promise.resolve(7), 1000)).resolves.toBe(7);
    } finally {
      vi.useRealTimers();
    }
    expect(classifyDeployError(new Error("The request took too long to respond.")).kind).toBe("timeout");
  });

  it("hands the wallet the simulation's gas estimate", async () => {
    const { e } = env();
    await runDeploy(plan({ steps: plan().steps.slice(0, 1) }), e);
    expect(e.send).toHaveBeenCalledWith(expect.any(String), BigInt(100));
  });

  it("logs the wallet's real reason, which viem puts past the long transaction data", () => {
    const raw = Object.assign(new Error(`An internal error was received.\n\nRequest Arguments:\n  data: 0x${"ab".repeat(4000)}`), {
      shortMessage: "An internal error was received.",
      code: -32603,
      details: "Magic RPC Error: [-32603] Error forwarded from node: transaction underpriced",
    });
    const detail = errorDetail(Object.assign(new Error("Failed"), { cause: raw }));
    expect(detail).toContain("transaction underpriced");
    expect(detail).toContain("-32603");
    expect(detail.length).toBeLessThan(800);
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

describe("runDeploy behind a proxy (D33)", () => {
  const proxyAbi = [{ type: "constructor", stateMutability: "payable", inputs: [{ name: "_logic", type: "address" }, { name: "initialOwner", type: "address" }, { name: "_data", type: "bytes" }] }] as const;
  const initAbi = [{ type: "function", name: "initialize", stateMutability: "nonpayable", inputs: [{ name: "cap_", type: "uint256" }], outputs: [] }] as const;
  const CODE: Address = "0x00000000000000000000000000000000000c0de0";
  const PROXY: Address = "0x0000000000000000000000000000000000000abc";
  const ADMIN: Address = "0x0000000000000000000000000000000000000adc";
  const ME: Address = "0x7a3000000000000000000000000000000000e41c";
  const hash = (n: number) => `0x${String(n).padStart(64, "0")}` as Hex;

  function harness(fail: { sendAt?: number; recordOnce?: boolean } = {}) {
    const sends: Array<{ data: Hex; to?: Address }> = [];
    const records: Array<{ tx: Hex; code?: Hex }> = [];
    const env = {
      account: ME,
      simulate: async () => ({ gas: BigInt(1) }),
      send: async (data: Hex, _gas: bigint, to?: Address) => {
        if (sends.length + 1 === fail.sendAt) {
          fail.sendAt = undefined;
          throw Object.assign(new Error("User rejected the request"), { code: 4001 });
        }
        sends.push({ data, to });
        return hash(sends.length);
      },
      waitForReceipt: async (h: Hex) => ({ status: "success" as const, contractAddress: h === hash(1) ? CODE : to(h) }),
      record: async (_s: unknown, tx: Hex, code?: Hex) => {
        if (fail.recordOnce) {
          fail.recordOnce = false;
          throw new Error("network");
        }
        records.push({ tx, code });
        return { address: PROXY };
      },
    };
    const to = (h: Hex) => (h === hash(2) ? PROXY : null);
    return { env, sends, records };
  }

  const firstPlan = {
    runId: "r",
    chainId: 11142220,
    compilerVersion: "x",
    openZeppelin: "5.6.1",
    gooddollar: null,
    alreadyDeployed: {},
    replaces: [],
    steps: [{ name: "Vault", abi: initAbi, bytecode: "0xc0de" as Hex, args: { cap_: "7" }, dependsOn: [], upgradeable: { kind: "first" as const, proxyAbi, proxyBytecode: "0xabcd" as Hex } }],
  } as unknown as Plan;
  const upgradePlan = { ...firstPlan, steps: [{ ...firstPlan.steps[0], upgradeable: { kind: "upgrade" as const, proxy: PROXY, admin: ADMIN } }] } as unknown as Plan;

  it("sends the code, then a proxy that runs initialize with the wallet as owner", async () => {
    const { env, sends, records } = harness();
    await expect(runDeploy(firstPlan, env)).resolves.toEqual({ Vault: PROXY });
    expect(sends[0]).toEqual({ data: "0xc0de", to: undefined });
    expect(sends[1].to).toBeUndefined();
    expect(sends[1].data.startsWith("0xabcd")).toBe(true);
    expect(sends[1].data.toLowerCase()).toContain(CODE.slice(2));
    expect(sends[1].data.toLowerCase()).toContain(ME.slice(2));
    expect(records).toEqual([{ tx: hash(2), code: hash(1) }]);
  });

  it("an upgrade goes to the ProxyAdmin", async () => {
    const { env, sends, records } = harness();
    await runDeploy(upgradePlan, env);
    expect(sends[1].to).toBe(ADMIN);
    expect(sends[1].data).toBe(encodeUpgrade(PROXY, CODE));
    expect(records).toEqual([{ tx: hash(2), code: hash(1) }]);
  });

  it("cancelling the second confirmation doesn't send the code again on retry", async () => {
    const { env, sends, records } = harness({ sendAt: 2 });
    const progress = { deployed: {}, sent: {} };
    await expect(runDeploy(upgradePlan, env, undefined, progress)).rejects.toBeInstanceOf(StepFailure);
    expect(sends).toHaveLength(1);
    await runDeploy(upgradePlan, env, undefined, progress);
    expect(sends).toHaveLength(2);
    expect(sends.filter((x) => x.data === "0xc0de")).toHaveLength(1);
    expect(records).toEqual([{ tx: hash(2), code: hash(1) }]);
    expect(progress.sent).toEqual({});
  });

  it("a record the chain can't confirm yet is retried, and never shows Failed once both transactions mined", async () => {
    // A load-balanced RPC answers from a node that hasn't seen the new block (the Celo Sepolia live test, 6 Nov 2026).
    const behind = Object.assign(new Error("The network says that proxy uses different code."), { code: "chain_read_failed" });
    const { env, sends, records } = harness();
    let lagging = 2;
    const record = env.record;
    const naps: number[] = [];
    const events: DeployEvent[] = [];
    const out = await runDeploy(firstPlan, { ...env, sleep: async (ms: number) => void naps.push(ms), record: async (s: unknown, tx: Hex, code?: Hex) => (lagging-- > 0 ? Promise.reject(behind) : record(s, tx, code)) }, (e) => events.push(e));
    expect(out).toEqual({ Vault: PROXY });
    expect(sends).toHaveLength(2);
    expect(records).toHaveLength(1);
    expect(naps).toHaveLength(2);
    expect(events.some((e) => e.type === "phase" && e.phase === "failed")).toBe(false);
  });

  it("when the chain still hasn't caught up, says both went through, and Try again only records", async () => {
    const behind = Object.assign(new Error("We couldn't read the new proxy from the network."), { code: "chain_read_failed" });
    const { env, sends, records } = harness();
    const progress = { deployed: {}, sent: {} };
    const events: DeployEvent[] = [];
    const stuck = { ...env, sleep: async () => undefined, record: async () => Promise.reject(behind) };
    const err = (await runDeploy(firstPlan, stuck, (e) => events.push(e), progress).catch((x) => x)) as StepFailure;
    expect(err).toBeInstanceOf(StepFailure);
    expect(err.error.kind).toBe("not_saved");
    expect(err.error.message).toMatch(/Both transactions went through/);
    expect(err.error.message).not.toMatch(/\u2014/);
    const phases = events.filter((e) => e.type === "phase").map((e) => (e as { phase: string }).phase);
    expect(phases).not.toContain("failed");
    expect(phases.at(-1)).toBe("unsaved");

    await runDeploy(firstPlan, env, undefined, progress);
    expect(sends).toHaveLength(2); // nothing signed twice
    expect(records).toHaveLength(1);
  });

  it("a record the server refuses still fails, with the server's reason", async () => {
    const refused = Object.assign(new Error("That proxy gives the right to change it to another wallet, so GoodBuild won't use it."), { code: "wrong_upgrade" });
    const { env } = harness();
    const naps: number[] = [];
    const err = (await runDeploy(firstPlan, { ...env, sleep: async (ms: number) => void naps.push(ms), record: async () => Promise.reject(refused) }).catch((x) => x)) as StepFailure;
    expect(err.error.kind).toBe("unknown");
    expect(err.error.message).toBe(refused.message);
    expect(naps).toHaveLength(0);
  });

  it("a failed record retries without signing anything", async () => {
    const { env, sends, records } = harness({ recordOnce: true });
    const progress = { deployed: {}, sent: {} };
    await expect(runDeploy(firstPlan, env, undefined, progress)).rejects.toBeInstanceOf(StepFailure);
    await runDeploy(firstPlan, env, undefined, progress);
    expect(sends).toHaveLength(2);
    expect(records).toHaveLength(1);
  });
});
