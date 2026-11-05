"use client";

import * as React from "react";
import { createPublicClient, formatEther, http, type Address, type Hex } from "viem";

import { useAuth } from "@/lib/auth/context";
import { celoChainFor } from "@/lib/auth/wallet-client";
import { classifyDeployError, type ClassifiedError } from "@/lib/deploy/errors";
import { loadSent, pendingKey, saveSent } from "@/lib/deploy/pending";
import { runDeploy, StepFailure, usesGoodDollar, type DeployEvent, type DeployProgress, type Plan, type PlanStep, type StepPhase } from "@/lib/deploy/run";
import { simulateCreation } from "@/lib/deploy/simulate";

export type DeployStage = "idle" | "preparing" | "ready" | "running" | "done" | "error";

export interface StepView {
  name: string;
  phase: StepPhase;
  txHash?: Hex;
  address?: Address;
  verify?: "pending" | "verified" | "failed" | "unsupported";
}

export interface DeployErrorView extends ClassifiedError {
  /** Where it happened: "prepare" or a contract name. */
  at: string;
  /** Raw detail for the expandable log. */
  logs: string[];
  /** Opcodes the chain rejected (kind "opcode"). */
  opcodes: string[];
  /** Server error code from prepare, e.g. manifest_missing. */
  code?: string;
}

export interface DeployState {
  stage: DeployStage;
  plan: Plan | null;
  steps: StepView[];
  /** Estimated total network fee in CELO, from the simulation of the first contract. */
  feeCelo: string | null;
  error: DeployErrorView | null;
  evmVersion: "cancun" | "paris";
  /** True when the plan uses GoodBuild's test G$, so the modal offers its faucet (Celo Sepolia). */
  needsTestGd: boolean;
}

const initial: DeployState = { stage: "idle", plan: null, steps: [], feeCelo: null, error: null, evmVersion: "cancun", needsTestGd: false };

type SetState = React.Dispatch<React.SetStateAction<DeployState>>;

interface ServerPlan extends Plan {
  steps: Array<PlanStep & { file: string; bytecodeBytes: number }>;
  sourceHash: Hex;
  evmVersion: "cancun" | "paris";
  isTestGooddollar: boolean;
}

/**
 * Drives the deploy modal (D23): prepare on the server, simulate, then one wallet signature per
 * contract in manifest order. Everything chain-facing is injected into `runDeploy`, which has the
 * unit tests; this hook only wires the real wallet (the same viem client for Magic and external
 * wallets) and the API.
 */
export function useDeploy({ projectId, chainId, onDeployed }: { projectId: string; chainId: number; onDeployed: () => void }) {
  const auth = useAuth();
  const [state, setState] = React.useState<DeployState>(initial);
  const planRef = React.useRef<ServerPlan | null>(null);
  const progressRef = React.useRef<DeployProgress>({ deployed: {}, sent: {} });
  const logsRef = React.useRef<string[]>([]);

  const log = React.useCallback((line: string) => {
    logsRef.current = [...logsRef.current.slice(-80), `${new Date().toISOString().slice(11, 19)} ${line}`];
  }, []);

  const prepare = React.useCallback(
    async (evmVersion: "cancun" | "paris" = "cancun") => {
      setState({ ...initial, stage: "preparing", evmVersion });
      logsRef.current = [];
      try {
        const res = await fetch(`/api/projects/${projectId}/deploy/prepare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chainId, evmVersion }),
        });
        const body = (await res.json()) as { plan?: ServerPlan; error?: string; message?: string; details?: string[] };
        if (!res.ok || !body.plan) {
          const details = body.details ?? [];
          setState({
            ...initial,
            stage: "error",
            evmVersion,
            error: { kind: "unknown", message: body.message ?? "We couldn't prepare the deploy.", at: "prepare", logs: details, opcodes: [], code: body.error },
          });
          return;
        }
        const plan = body.plan;
        planRef.current = plan;
        progressRef.current = { deployed: {}, sent: {} };
        log(`Plan: ${plan.steps.map((s) => s.name).join(" → ")} on chain ${plan.chainId} (${plan.evmVersion}, solc ${plan.compilerVersion}, OpenZeppelin ${plan.openZeppelin})`);
        const steps: StepView[] = plan.steps.map((s) => ({ name: s.name, phase: plan.alreadyDeployed[s.name] ? "reused" : "waiting", address: plan.alreadyDeployed[s.name] }));
        // Nothing left to sign: this exact source and manifest is already live, so show its addresses.
        const live = plan.steps.every((s) => plan.alreadyDeployed[s.name]);
        setState({ ...initial, stage: live ? "done" : "ready", plan, steps, evmVersion: plan.evmVersion, needsTestGd: plan.isTestGooddollar && usesGoodDollar(plan) });
        if (live) void pollVerification(projectId, plan, plan.alreadyDeployed, setState, 0);
      } catch (e) {
        setState({ ...initial, stage: "error", evmVersion, error: { ...classifyDeployError(e), at: "prepare", logs: [String(e)], opcodes: [] } });
      }
    },
    [projectId, chainId, log],
  );

  // Wallets restore after the page loads, so estimate once both the plan and the wallet are here.
  const account = auth.wallet?.address;
  const estimating = state.stage === "ready" && !state.feeCelo ? (state.plan as ServerPlan | null) : null;
  React.useEffect(() => {
    if (estimating && account) void estimate(estimating, account, setState, logsRef.current);
  }, [estimating, account]);

  const start = React.useCallback(async () => {
    const plan = planRef.current;
    if (!plan) return;
    const wallet = auth.wallet;
    if (!auth.user || !wallet) {
      setState((s) => ({ ...s, stage: "error", error: { kind: "unknown", message: "Connect your wallet first.", at: "wallet", logs: [], opcodes: [] } }));
      return;
    }
    if (wallet.address.toLowerCase() !== auth.user.wallet.toLowerCase()) {
      setState((s) => ({ ...s, stage: "error", error: { kind: "wrong_chain", message: "The connected wallet isn't the one you signed in with. Switch accounts in your wallet.", at: "wallet", logs: [], opcodes: [] } }));
      return;
    }
    setState((s) => ({ ...s, stage: "running", error: null }));
    try {
      if (wallet.chainId !== plan.chainId) await auth.switchChain(plan.chainId);
      const walletClient = await auth.getWalletClient();
      const publicClient = publicClientFor(plan.chainId);
      const account = wallet.address;
      const pending = pendingKey(projectId, plan.chainId, plan.sourceHash, account);
      progressRef.current.sent = { ...loadSent(pending), ...progressRef.current.sent };

      const deployed = await runDeploy(
        plan,
        {
          account,
          simulate: ({ data, runtimeBytecode }) => simulateCreation(publicClient, { account, data, runtimeBytecode }),
          send: (data) => walletClient.sendTransaction({ account, chain: celoChainFor(plan.chainId), data, to: undefined }),
          waitForReceipt: (hash) => publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 }),
          record: async (step, txHash) => {
            const res = await fetch(`/api/projects/${projectId}/deployments`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ runId: plan.runId, chainId: plan.chainId, contractName: step.name, txHash, sourceHash: plan.sourceHash, evmVersion: plan.evmVersion }),
            });
            const body = (await res.json()) as { deployment?: { address: Address; verifyStatus: StepView["verify"] }; message?: string };
            if (!res.ok || !body.deployment) throw new Error(body.message ?? "We couldn't save the deployment.");
            return { address: body.deployment.address };
          },
        },
        (event: DeployEvent) => {
          saveSent(pending, progressRef.current.sent);
          if (event.type === "phase") {
            log(`${event.step}: ${event.phase}${event.txHash ? ` ${event.txHash}` : ""}`);
            setState((s) => ({ ...s, steps: s.steps.map((x) => (x.name === event.step ? { ...x, phase: event.phase, txHash: event.txHash ?? x.txHash, address: event.address ?? x.address } : x)) }));
          }
        },
        progressRef.current,
      );
      setState((s) => ({ ...s, stage: "done" }));
      onDeployed();
      void pollVerification(projectId, plan, deployed, setState);
    } catch (e) {
      // Finished contracts are saved and their addresses are in the project files, so refresh those.
      if (Object.keys(progressRef.current.deployed).length) onDeployed();
      if (e instanceof StepFailure) {
        log(`${e.step}: ${e.error.kind} ${String((e.raw as Error | undefined)?.message ?? e.message).slice(0, 300)}`);
        setState((s) => ({ ...s, stage: "error", error: { ...e.error, at: e.step, logs: logsRef.current, opcodes: e.opcodes } }));
      } else {
        const err = classifyDeployError(e);
        setState((s) => ({ ...s, stage: "error", error: { ...err, at: "wallet", logs: [...logsRef.current, String(e)], opcodes: [] } }));
      }
    }
  }, [auth, projectId, log, onDeployed]);

  const reset = React.useCallback(() => {
    planRef.current = null;
    progressRef.current = { deployed: {}, sent: {} };
    setState(initial);
  }, []);

  /** After an error: go back to the summary. Contracts already deployed stay deployed. */
  const retry = React.useCallback(() => {
    setState((s) => ({ ...s, stage: "ready", error: null, steps: s.steps.map((x) => (x.phase === "failed" ? { ...x, phase: "waiting" } : x)) }));
  }, []);

  /** Claim 1,000 test G$ from the Celo Sepolia faucet (D23), once a day per wallet. */
  const claimTestGd = React.useCallback(async (): Promise<string> => {
    const plan = planRef.current;
    if (!plan?.gooddollar || !auth.wallet) throw new Error("Connect your wallet first.");
    if (auth.wallet.chainId !== plan.chainId) await auth.switchChain(plan.chainId);
    const client = await auth.getWalletClient();
    const hash = await client.writeContract({
      address: plan.gooddollar,
      abi: [{ type: "function", name: "faucet", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const,
      functionName: "faucet",
      account: auth.wallet.address,
      chain: celoChainFor(plan.chainId),
    });
    await publicClientFor(plan.chainId).waitForTransactionReceipt({ hash });
    return hash;
  }, [auth]);

  return { state, prepare, start, reset, retry, claimTestGd };
}

function firstName(plan: ServerPlan) {
  return plan.steps.find((s) => !plan.alreadyDeployed[s.name])?.name ?? "prepare";
}

function publicClientFor(chainId: number) {
  return createPublicClient({ chain: celoChainFor(chainId), transport: http() });
}

/** Simulate the first new contract now, so a rejected bytecode shows before anyone signs. */
async function estimate(plan: ServerPlan, account: Address, setState: SetState, logs: string[]) {
  try {
    const client = publicClientFor(plan.chainId);
    // Only a contract with no constructor arguments can be simulated before its inputs exist.
    const probe = plan.steps.find((s) => !plan.alreadyDeployed[s.name] && Object.keys(s.args).length === 0);
    if (!probe) return;
    const { gas } = await simulateCreation(client, { account, data: probe.bytecode, runtimeBytecode: probe.deployedBytecode });
    const price = await client.getGasPrice();
    const perByte = Number(gas) / Math.max(probe.bytecodeBytes, 1);
    const total = plan.steps.filter((s) => !plan.alreadyDeployed[s.name]).reduce((n, s) => n + perByte * s.bytecodeBytes, 0);
    setState((s) => (s.plan === plan && s.stage === "ready" ? { ...s, feeCelo: Number(formatEther(BigInt(Math.ceil(total)) * price)).toPrecision(2) } : s));
  } catch (e) {
    const err = classifyDeployError(e);
    if (err.kind === "opcode") {
      setState((s) => (s.plan === plan && s.stage === "ready" ? { ...s, stage: "error", error: { ...err, at: firstName(plan), logs, opcodes: (e as { opcodes?: string[] }).opcodes ?? [] } } : s));
    }
  }
}

/** Sourcify can take a few seconds; poll the server until each contract has a verdict. */
async function pollVerification(projectId: string, plan: ServerPlan, deployed: Record<string, Address>, setState: SetState, firstDelay = 2500) {
  // By address, not run: a contract reused from an earlier run has that run's id.
  const addresses = new Set(Object.values(deployed).map((a) => a.toLowerCase()));
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? firstDelay : 5000));
    try {
      const res = await fetch(`/api/projects/${projectId}/deployments`, { cache: "no-store" });
      if (!res.ok) continue;
      const { deployments } = (await res.json()) as { deployments: Array<{ id: string; chainId: number; address: string; contractName: string; verifyStatus: StepView["verify"] }> };
      const ours = deployments.filter((d) => d.chainId === plan.chainId && addresses.has(d.address.toLowerCase()));
      for (const d of ours.filter((x) => x.verifyStatus === "pending")) {
        await fetch(`/api/projects/${projectId}/deployments/${d.id}/verify`, { method: "POST" }).catch(() => undefined);
      }
      setState((s) => ({ ...s, steps: s.steps.map((x) => ({ ...x, verify: ours.find((d) => d.contractName === x.name)?.verifyStatus ?? x.verify })) }));
      if (ours.length && ours.every((d) => d.verifyStatus !== "pending")) return;
    } catch {
      /* try again */
    }
  }
  // Out of attempts: stop the spinner. The chip then says "Not verified yet", which is true.
  setState((s) => ({ ...s, steps: s.steps.map((x) => (x.verify === "pending" || !x.verify ? { ...x, verify: "failed" } : x)) }));
}
