import { encodeDeployData, type Abi, type Address, type Hex } from "viem";

import { classifyDeployError, type ClassifiedError } from "./errors";
import { referencesIn, resolveArgs, type ArgValue } from "./manifest";
import { UnsupportedOpcodeError } from "./simulate";
import { encodeProxyDeploy, encodeUpgrade, initializerData, type ProxyInfo, type UpgradeableStep } from "./upgradeable";

/** The plan the server returns from /deploy/prepare (src/server/deploy/service.ts). */
export interface PlanStep {
  name: string;
  abi: Abi;
  bytecode: Hex;
  /** Runtime bytecode, for the opcode scan. */
  deployedBytecode?: Hex;
  args: Record<string, ArgValue>;
  dependsOn: string[];
  /** Behind a proxy (D33): this step takes two transactions, the new code and then the proxy. */
  upgradeable?: UpgradeableStep;
}
export interface Plan {
  runId: string;
  chainId: number;
  compilerVersion: string;
  openZeppelin: string;
  gooddollar: Address | null;
  steps: PlanStep[];
  alreadyDeployed: Record<string, Address>;
  /** Live contracts this deploy leaves behind, which keep their funds and history. */
  replaces: Array<{ name: string; address: Address; gdBalance: string | null }>;
  /** This project opted in to upgradeable contracts (D33). */
  upgradeable?: boolean;
  /** Live proxies that get new code at the same address in this deploy. */
  upgrades?: Array<{ name: string; address: Address }>;
  /** Live proxies by contract name, with who can still change each one. */
  proxies?: Record<string, ProxyInfo>;
}

/** Everything that touches the wallet or the network, injected so the order logic is testable. */
export interface DeployEnv {
  account: Address;
  /** Throws on a rejected bytecode or a reverting constructor. */
  simulate(args: { data: Hex; runtimeBytecode?: Hex; to?: Address }): Promise<{ gas: bigint }>;
  /** Asks the wallet to sign and broadcast the transaction; returns its hash. `gas` is the simulation's estimate. `to` is unset for a creation. */
  send(data: Hex, gas: bigint, to?: Address): Promise<Hex>;
  /** Waits until the transaction is mined. */
  waitForReceipt(hash: Hex): Promise<{ status: "success" | "reverted"; contractAddress?: Address | null }>;
  /** Server-side: reads the chain, verifies the transaction, stores it, returns the deployed address. `implementationTx` is set behind a proxy. */
  record(step: PlanStep, txHash: Hex, implementationTx?: Hex): Promise<{ address: Address }>;
}

export type StepPhase = "waiting" | "reused" | "simulating" | "signing" | "broadcasting" | "recording" | "done" | "failed";

/** Which of the two transactions an upgradeable step is on (D33). */
export type StepPart = "code" | "proxy" | "switch";

export type DeployEvent =
  | { type: "phase"; step: string; phase: StepPhase; txHash?: Hex; address?: Address; part?: StepPart }
  | { type: "sent"; step: string; txHash: Hex };

/**
 * What this deploy has done so far. The caller keeps it between attempts and runDeploy updates it in
 * place, so "Try again" never signs for a contract that is finished or a transaction already sent.
 */
export interface DeployProgress {
  deployed: Record<string, Address>;
  /** Sent but not yet recorded. A retry picks these up again instead of sending a second transaction. */
  sent: Record<string, Hex>;
}

export class StepFailure extends Error {
  constructor(
    readonly step: string,
    readonly error: ClassifiedError,
    readonly opcodes: string[] = [],
    readonly raw?: unknown,
  ) {
    super(error.message);
    this.name = "StepFailure";
  }
}

/**
 * Deploy the plan's contracts in order, one wallet signature each. A contract already deployed from
 * the same source (alreadyDeployed, or `progress` from an earlier attempt) is reused, so a failure on
 * step 2 never redeploys step 1. Throws StepFailure; the contracts finished before it stay recorded.
 */
export async function runDeploy(
  plan: Plan,
  env: DeployEnv,
  onEvent: (e: DeployEvent) => void = () => undefined,
  progress: DeployProgress = { deployed: {}, sent: {} },
): Promise<Record<string, Address>> {
  const deployed: Record<string, Address> = { ...plan.alreadyDeployed, ...progress.deployed };
  for (const step of plan.steps) onEvent({ type: "phase", step: step.name, phase: deployed[step.name] ? "reused" : "waiting", address: deployed[step.name] });

  for (const step of plan.steps) {
    if (deployed[step.name]) {
      delete progress.sent[step.name];
      continue;
    }
    const phase = (p: StepPhase, extra: { txHash?: Hex; address?: Address; part?: StepPart } = {}) => onEvent({ type: "phase", step: step.name, phase: p, ...extra });
    try {
      if (step.upgradeable) {
        const { address, txHash } = await runProxiedStep(plan, step, step.upgradeable, env, deployed, progress, phase, onEvent);
        deployed[step.name] = address;
        progress.deployed[step.name] = address;
        phase("done", { txHash, address });
        continue;
      }
      const args = resolveArgs({ name: step.name, args: step.args, dependsOn: step.dependsOn }, step.abi, {
        deployed,
        gooddollar: plan.gooddollar,
        deployer: env.account,
      });
      const data = args.length || hasConstructor(step.abi) ? encodeDeployData({ abi: step.abi, bytecode: step.bytecode, args }) : step.bytecode;

      let txHash = progress.sent[step.name];
      if (!txHash) {
        phase("simulating");
        const { gas } = await env.simulate({ data, runtimeBytecode: step.deployedBytecode });

        phase("signing");
        txHash = await env.send(data, gas);
        progress.sent[step.name] = txHash;
        onEvent({ type: "sent", step: step.name, txHash });
      }

      phase("broadcasting", { txHash });
      const receipt = await env.waitForReceipt(txHash).catch((error: unknown) => {
        // Never mined in the time allowed: probably dropped, and keeping it would block every retry.
        if ((error as Error).name === "WaitForTransactionReceiptTimeoutError") delete progress.sent[step.name];
        throw error;
      });
      if (receipt.status !== "success") {
        delete progress.sent[step.name]; // dead on-chain, so a retry must send a new one
        throw Object.assign(new Error("execution reverted"), { code: "reverted" });
      }

      phase("recording", { txHash });
      const { address } = await env.record(step, txHash);
      deployed[step.name] = address;
      progress.deployed[step.name] = address;
      delete progress.sent[step.name];
      phase("done", { txHash, address });
    } catch (error) {
      onEvent({ type: "phase", step: step.name, phase: "failed" });
      if (error instanceof StepFailure) throw error;
      if (error instanceof UnsupportedOpcodeError) {
        throw new StepFailure(step.name, classifyDeployError(Object.assign(new Error("invalid opcode"), { cause: error })), error.opcodes, error);
      }
      throw new StepFailure(step.name, classifyDeployError(error), [], error);
    }
  }
  return deployed;
}

/** A sent transaction under its own key, so a retry picks up each one and never sends it twice. */
async function sendOnce(
  key: string,
  step: PlanStep,
  env: DeployEnv,
  progress: DeployProgress,
  phase: (p: StepPhase, extra?: { txHash?: Hex; part?: StepPart }) => void,
  onEvent: (e: DeployEvent) => void,
  part: StepPart,
  tx: { data: Hex; to?: Address; runtimeBytecode?: Hex },
) {
  let txHash = progress.sent[key];
  if (!txHash) {
    phase("simulating", { part });
    const { gas } = await env.simulate(tx);
    phase("signing", { part });
    txHash = await env.send(tx.data, gas, tx.to);
    progress.sent[key] = txHash;
    onEvent({ type: "sent", step: step.name, txHash });
  }
  phase("broadcasting", { txHash, part });
  const receipt = await env.waitForReceipt(txHash).catch((error: unknown) => {
    if ((error as Error).name === "WaitForTransactionReceiptTimeoutError") delete progress.sent[key];
    throw error;
  });
  if (receipt.status !== "success") {
    delete progress.sent[key];
    throw Object.assign(new Error("execution reverted"), { code: "reverted" });
  }
  return { txHash, contractAddress: receipt.contractAddress ?? null };
}

/**
 * A contract behind a proxy (D33), in two transactions. The first only puts the code on chain and
 * changes nothing anyone uses. The second creates the proxy, or points the live proxy at that code.
 */
async function runProxiedStep(
  plan: Plan,
  step: PlanStep,
  how: UpgradeableStep,
  env: DeployEnv,
  deployed: Record<string, Address>,
  progress: DeployProgress,
  phase: (p: StepPhase, extra?: { txHash?: Hex; part?: StepPart }) => void,
  onEvent: (e: DeployEvent) => void,
): Promise<{ address: Address; txHash: Hex }> {
  const codeKey = `${step.name}#code`;
  const code = await sendOnce(codeKey, step, env, progress, phase, onEvent, "code", { data: step.bytecode, runtimeBytecode: step.deployedBytecode });
  if (!code.contractAddress) throw new Error("The new code's transaction didn't create a contract.");

  let second: { data: Hex; to?: Address };
  if (how.kind === "first") {
    const args = resolveArgs({ name: step.name, args: step.args, dependsOn: step.dependsOn }, step.abi, { deployed, gooddollar: plan.gooddollar, deployer: env.account }, { upgradeable: true });
    second = { data: encodeProxyDeploy(how, code.contractAddress, env.account, initializerData(step.abi, args)) };
  } else {
    second = { data: encodeUpgrade(how.proxy, code.contractAddress), to: how.admin };
  }
  const part: StepPart = how.kind === "first" ? "proxy" : "switch";
  const { txHash } = await sendOnce(step.name, step, env, progress, phase, onEvent, part, second);

  phase("recording", { txHash, part });
  const { address } = await env.record(step, txHash, code.txHash);
  delete progress.sent[codeKey];
  delete progress.sent[step.name];
  return { address, txHash };
}

/** True when a constructor argument references ${GOODDOLLAR}. */
export function usesGoodDollar(plan: Pick<Plan, "steps">) {
  return plan.steps.some((s) => Object.values(s.args).some((v) => referencesIn(v).some((r) => r.ref?.kind === "gooddollar")));
}

function hasConstructor(abi: Abi) {
  return abi.some((i) => i.type === "constructor");
}
