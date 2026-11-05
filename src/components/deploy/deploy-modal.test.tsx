import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import type { Plan } from "@/lib/deploy/run";
import { DeployModal, stageIndex } from "./deploy-modal";
import type { DeployState, StepView } from "./use-deploy";

const wallet = "0x7a3000000000000000000000000000000000e41c" as const;
const auth = {
  ...unconfiguredAuth,
  configured: true,
  user: { id: "u", wallet, walletKind: "external" as const, verified: false },
  wallet: { address: wallet, chainId: 11142220, kind: "external" as const, label: "MetaMask" },
};
const plan = { runId: "r", chainId: 11142220, compilerVersion: "0.8.28+commit.abc", openZeppelin: "5.6.1", gooddollar: null, alreadyDeployed: {}, steps: [] } as Plan;
const state = (over: Partial<DeployState>): DeployState => ({ stage: "ready", plan, steps: [{ name: "Tip", phase: "waiting" }], feeCelo: null, error: null, evmVersion: "cancun", needsTestGd: false, ...over });

function renderModal(s: DeployState, deploy: Partial<Record<string, unknown>> = {}, onFix = vi.fn()) {
  const api = { state: s, prepare: vi.fn(), start: vi.fn(), reset: vi.fn(), retry: vi.fn(), claimTestGd: vi.fn(), ...deploy };
  render(
    <AuthContextProvider value={auth}>
      <DeployModal open onOpenChange={() => {}} deploy={api as never} chainId={11142220} onFix={onFix} />
    </AuthContextProvider>,
  );
  return api;
}

describe("stageIndex", () => {
  const at = (phase: StepView["phase"], verify?: StepView["verify"]) => stageIndex({ name: "X", phase, verify });
  it("walks Sign → Broadcast → Verified", () => {
    expect(at("signing")).toEqual({ active: 0, done: 0 });
    expect(at("broadcasting")).toEqual({ active: 1, done: 1 });
    expect(at("done", "pending")).toEqual({ active: 2, done: 2 });
    expect(at("done", "verified")).toEqual({ active: 3, done: 3 });
  });
  it("puts a failure on Broadcast once a transaction exists", () => {
    expect(at("failed")).toEqual({ active: 0, done: 0 });
    expect(stageIndex({ name: "X", phase: "failed", txHash: "0x01" })).toEqual({ active: 1, done: 1 });
  });
});

describe("DeployModal", () => {
  it("shows the summary and a primary Sign & deploy button", async () => {
    const api = renderModal(state({ feeCelo: "0.0042" }));
    expect(screen.getByText("Deploy to Celo")).toBeInTheDocument();
    expect(screen.getByText("Tip")).toBeInTheDocument();
    expect(screen.getByText(/0\.0042 CELO/)).toBeInTheDocument();
    expect(screen.getByText("Unaudited")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign & deploy" }));
    expect(api.start).toHaveBeenCalled();
  });

  it("counts the contracts still to sign", () => {
    renderModal(state({ steps: [{ name: "A", phase: "done", address: "0x1" as never }, { name: "B", phase: "waiting" }, { name: "C", phase: "waiting" }] }));
    expect(screen.getByRole("button", { name: "Sign & deploy 2 contracts" })).toBeInTheDocument();
  });

  it("offers the paris rebuild only for an opcode failure on cancun (D17)", async () => {
    const error = { kind: "opcode" as const, message: "Celo rejected this contract's bytecode.", at: "Tip", logs: ["x"], opcodes: ["MCOPY"] };
    const api = renderModal(state({ stage: "error", error, steps: [{ name: "Tip", phase: "failed" }] }));
    expect(screen.getByText(/It uses MCOPY/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rebuild for older Celo" }));
    expect(api.prepare).toHaveBeenCalledWith("paris");
  });

  it("does not offer a paris rebuild once already on paris", () => {
    const error = { kind: "opcode" as const, message: "no", at: "Tip", logs: [], opcodes: [] };
    renderModal(state({ stage: "error", evmVersion: "paris", error }));
    expect(screen.queryByRole("button", { name: "Rebuild for older Celo" })).toBeNull();
  });

  it("sends manifest problems back to the builder", async () => {
    const onFix = vi.fn();
    const error = { kind: "unknown" as const, message: "No deploy manifest.", at: "prepare", logs: [], opcodes: [], code: "manifest_missing" };
    renderModal(state({ stage: "error", plan: null, steps: [], error }), {}, onFix);
    await userEvent.click(screen.getByRole("button", { name: "Try fix" }));
    expect(onFix).toHaveBeenCalledWith(expect.stringContaining("contracts/deploy.json"));
  });

  it("says deployed contracts stay deployed after a later failure", () => {
    const error = { kind: "user_rejected" as const, message: "You cancelled the request in your wallet.", at: "Pool", logs: [], opcodes: [] };
    renderModal(state({ stage: "error", error, steps: [{ name: "Token", phase: "done", address: "0x1" as never }, { name: "Pool", phase: "failed" }] }));
    expect(screen.getByText(/already deployed stay deployed/i)).toBeInTheDocument();
  });

  it("shows addresses with copy and explorer links on success", () => {
    const address = "0x3333333333333333333333333333333333333333" as const;
    renderModal(state({ stage: "done", steps: [{ name: "Tip", phase: "done", address, txHash: ("0x" + "ab".repeat(32)) as never, verify: "verified" }] }));
    expect(screen.getByText("Live on Celo")).toBeInTheDocument();
    expect(screen.getByText(address)).toBeInTheDocument();
    expect(screen.getByText("Verified on Sourcify")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View Tip on the explorer/ })).toHaveAttribute("href", `https://celo-sepolia.blockscout.com/address/${address}`);
  });
});
