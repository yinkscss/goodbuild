"use client";

import * as React from "react";

import { DeployModal } from "@/components/deploy/deploy-modal";
import type { DeployState } from "@/components/deploy/use-deploy";
import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import type { Plan } from "@/lib/deploy/run";

const wallet = "0x7a3c91d0b5e2f4a6c8e0d2b4f6a8c0e2d4b6e41c" as const;
const auth = {
  ...unconfiguredAuth,
  configured: true,
  ready: true,
  user: { id: "u1", wallet, walletKind: "embedded" as const, verified: false },
  wallet: { address: wallet, chainId: 11142220, kind: "embedded" as const, label: "Email wallet" },
};

const A = "0x2222222222222222222222222222222222222222";
const B = "0x3333333333333333333333333333333333333333";

const plan: Plan & { sourceHash: string } = {
  runId: "run-preview",
  chainId: 11142220,
  compilerVersion: "0.8.28+commit.7893614a",
  openZeppelin: "5.6.1",
  gooddollar: "0x00000000000000000000000000000000000000d1",
  alreadyDeployed: {},
  replaces: [],
  sourceHash: "0x",
  steps: [],
};
const tx = "0x" + "ab".repeat(32);

const base: DeployState = {
  stage: "ready",
  plan,
  steps: [
    { name: "RTXToken", phase: "waiting" },
    { name: "RTXPool", phase: "waiting" },
  ],
  feeCelo: "0.0042",
  error: null,
  evmVersion: "cancun",
  needsTestGd: true,
};

const STATES: Record<string, DeployState> = {
  ready: base,
  replace: { ...base, plan: { ...plan, replaces: [{ name: "RTXPool", address: B, gdBalance: "1200500000000000000000" }, { name: "RTXToken", address: A, gdBalance: null }] } },
  preparing: { ...base, stage: "preparing", plan: null, steps: [] },
  signing: { ...base, stage: "running", steps: [{ name: "RTXToken", phase: "signing" }, { name: "RTXPool", phase: "waiting" }] },
  broadcasting: { ...base, stage: "running", steps: [{ name: "RTXToken", phase: "broadcasting", txHash: tx as `0x${string}` }, { name: "RTXPool", phase: "waiting" }] },
  second: {
    ...base,
    stage: "running",
    steps: [{ name: "RTXToken", phase: "done", address: A, txHash: tx as `0x${string}`, verify: "pending" }, { name: "RTXPool", phase: "signing" }],
  },
  opcode: {
    ...base,
    stage: "error",
    steps: [{ name: "RTXToken", phase: "failed" }, { name: "RTXPool", phase: "waiting" }],
    error: { kind: "opcode", message: "Celo rejected this contract's bytecode because it uses an instruction the network doesn't support yet.", at: "RTXToken", logs: ["RTXToken: simulating", "RTXToken: failed invalid opcode: opcode 0x5e not defined"], opcodes: ["MCOPY"] },
  },
  failed: {
    ...base,
    stage: "error",
    steps: [{ name: "RTXToken", phase: "done", address: A, verify: "pending" }, { name: "RTXPool", phase: "failed" }],
    error: { kind: "user_rejected", message: "You cancelled the request in your wallet.", at: "RTXPool", logs: [], opcodes: [] },
  },
  manifest: {
    ...base,
    stage: "error",
    steps: [],
    error: { kind: "unknown", message: "This project has no deploy manifest (contracts/deploy.json) yet. Ask the builder to add one.", at: "prepare", logs: [], opcodes: [], code: "manifest_missing" },
  },
  done: {
    ...base,
    stage: "done",
    steps: [
      { name: "RTXToken", phase: "done", address: A, txHash: tx as `0x${string}`, verify: "verified" },
      { name: "RTXPool", phase: "done", address: B, txHash: tx as `0x${string}`, verify: "pending" },
    ],
  },
};

export function DeployPreview({ state }: { state: string }) {
  const s = STATES[state] ?? base;
  const deploy = {
    state: s,
    prepare: async () => {},
    start: async () => {},
    reset: () => {},
    retry: () => {},
    claimTestGd: async () => "0x",
  } as unknown as React.ComponentProps<typeof DeployModal>["deploy"];
  return (
    <AuthContextProvider value={auth}>
      <DeployModal open onOpenChange={() => {}} deploy={deploy} chainId={11142220} onFix={() => {}} />
    </AuthContextProvider>
  );
}
