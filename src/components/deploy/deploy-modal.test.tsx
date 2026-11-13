import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import type { Plan } from "@/lib/deploy/run";
import { DeployModal, keepsLine, stageIndex } from "./deploy-modal";
import type { DeployState, StepView } from "./use-deploy";

const wallet = "0x7a3000000000000000000000000000000000e41c" as const;
const auth = {
  ...unconfiguredAuth,
  configured: true,
  user: { id: "u", wallet, walletKind: "external" as const, verified: false },
  wallet: { address: wallet, chainId: 11142220, kind: "external" as const, label: "MetaMask" },
};
const plan = { runId: "r", chainId: 11142220, compilerVersion: "0.8.28+commit.abc", openZeppelin: "5.6.1", gooddollar: null, alreadyDeployed: {}, replaces: [], steps: [] } as Plan;
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
  it("marks sign and broadcast done when the transactions mined but aren't saved yet", () => {
    expect(at("unsaved")).toEqual({ active: -1, done: 2 });
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

  it("when Celo is slow to confirm, says both went through and offers Try again, never Failed", async () => {
    const error = { kind: "not_saved" as const, message: "Both transactions went through, but GoodBuild couldn't save the result yet, usually because Celo's network is still catching up. Try again in a moment. Nothing new will be sent.", at: "Vault", logs: [], opcodes: [] };
    const api = renderModal(state({ stage: "error", steps: [{ name: "Vault", phase: "unsaved", txHash: "0x01", part: "proxy" }], error }));
    expect(screen.getByText("Vault isn't saved yet")).toBeInTheDocument();
    expect(screen.getByText(/Both transactions went through/)).toBeInTheDocument();
    expect(screen.getByText("Sent, not saved yet")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.retry).toHaveBeenCalled();
  });

  it("when the check on Celo times out, says nothing was sent and offers Try again", async () => {
    const error = { kind: "timeout" as const, message: "Celo didn't answer in time, so nothing was sent and nothing was spent. Try again.", at: "Vault", logs: [], opcodes: [] };
    const api = renderModal(state({ stage: "error", steps: [{ name: "Vault", phase: "failed" }], error }));
    expect(screen.getByText("Celo didn't answer")).toBeInTheDocument();
    expect(screen.getByText(/nothing was sent/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.retry).toHaveBeenCalled();
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

  it("warns before replacing a live contract, saying what stays behind", () => {
    const address = "0x3333333333333333333333333333333333333333" as const;
    renderModal(state({ plan: { ...plan, replaces: [{ name: "Tip", address, gdBalance: "1200500000000000000000" }] } }));
    expect(screen.getByText(/This creates a new contract/)).toBeInTheDocument();
    expect(screen.getByText(/keeps its 1,200.5 G\$ and its history/)).toBeInTheDocument();
    expect(screen.getByText(/stays on the old one until you publish again/)).toBeInTheDocument();
  });

  it("says nothing on a first deploy", () => {
    renderModal(state({}));
    expect(screen.queryByText(/This creates a new contract/)).not.toBeInTheDocument();
  });

  it("describes the old contract's balance honestly", () => {
    expect(keepsLine(null)).toBe("keeps any funds it holds and its history");
    expect(keepsLine("0")).toBe("keeps its history and holds no G$");
  });
});

describe("DeployModal, upgradeable trial (D33)", () => {
  const proxy = "0x00000000000000000000000000000000000000aa" as const;
  const info = { address: proxy, admin: proxy, implementation: proxy, authority: "you" as const };
  const upgradePlan = { ...plan, upgradeable: true, upgrades: [{ name: "Tip", address: proxy }], proxies: { Tip: info } } as Plan;

  it("says the address stays, and shows no new-contract warning, for an upgrade", () => {
    renderModal(state({ plan: upgradePlan }));
    expect(screen.getByText("Upgrade on Celo")).toBeInTheDocument();
    expect(screen.getByText(/The address stays the same/)).toBeInTheDocument();
    expect(screen.getByText(/keeps its funds and data/)).toBeInTheDocument();
    expect(screen.queryByText(/creates a new contract/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign & upgrade" })).toBeInTheDocument();
  });

  it("says each confirmation's job while signing", () => {
    renderModal(state({ plan: upgradePlan, stage: "running", steps: [{ name: "Tip", phase: "signing", part: "code" }] }));
    expect(screen.getByText(/Step 1 of 2, putting the new code on Celo/)).toBeInTheDocument();
  });

  it("a refused upgrade offers a normal new deploy and the builder, not Try again", async () => {
    const user = userEvent.setup();
    const onFix = vi.fn();
    const api = renderModal(state({ stage: "error", plan: null, steps: [], error: { kind: "unknown", message: "This change would scramble the data Tip has stored.", at: "prepare", logs: ["Deleted `a`"], opcodes: [], code: "upgrade_refused" } }), {}, onFix);
    expect(screen.getByText("We can't upgrade this safely")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Deploy as a new contract" }));
    expect(api.prepare).toHaveBeenCalledWith("cancun", { fresh: true });
    await user.click(screen.getByRole("button", { name: "Ask the builder to keep the data" }));
    expect(onFix.mock.calls[0][0]).toMatch(/keep the same name, type and order/);
  });

  it("asks the owner to review a money-holding contract before mainnet, and continues only once they confirm (GB-02)", async () => {
    const user = userEvent.setup();
    const api = renderModal(state({ stage: "error", plan: null, steps: [], error: { kind: "unknown", message: "This contract takes in other people's money in a way GoodBuild's vault and DAO tests weren't written for.", at: "prepare", logs: ["GoodPool.joinPool pulls tokens in with transferFrom (contracts/GoodPool.sol:28)"], opcodes: [], code: "needs_owner_review" } }));
    expect(screen.getByText("Review this contract before it goes to Celo")).toBeInTheDocument();
    expect(screen.getByText(/GoodPool\.joinPool pulls tokens in/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    const go = screen.getByRole("button", { name: "Continue" });
    expect(go).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(go);
    expect(api.prepare).toHaveBeenCalledWith("cancun", { ownerReviewed: true });
  });

  it("sends failing exploit tests back to the builder", async () => {
    const user = userEvent.setup();
    const onFix = vi.fn();
    renderModal(state({ stage: "error", plan: null, steps: [], error: { kind: "unknown", message: "This contract holds other people's money, and its exploit tests don't all pass yet.", at: "prepare", logs: ["contracts/test/: Add testExploitReentrancy"], opcodes: [], code: "exploit_tests_failed" } }), {}, onFix);
    await user.click(screen.getByRole("button", { name: "Ask the builder to fix them" }));
    expect(onFix.mock.calls[0][0]).toMatch(/testExploitReentrancy/);
  });

  it("offers the option on testnet only", async () => {
    const user = userEvent.setup();
    const setUpgradeable = vi.fn();
    renderModal(state({}), { setUpgradeable });
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    expect(setUpgradeable).toHaveBeenCalledWith(true);
  });

  it("hides the option on mainnet", () => {
    renderModal(state({ plan: { ...plan, chainId: 42220 } as Plan }));
    expect(screen.queryByRole("button", { name: "Turn on" })).not.toBeInTheDocument();
  });

  it("labels a live contract and asks twice before locking it", async () => {
    const user = userEvent.setup();
    const lockContract = vi.fn().mockResolvedValue(undefined);
    renderModal(state({ plan: upgradePlan, stage: "done", steps: [{ name: "Tip", phase: "done", address: proxy, verify: "verified" }] }), { lockContract });
    expect(screen.getByText(/This contract can be changed, by your wallet only/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Lock it so it can never change/ }));
    expect(lockContract).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/can't be undone/);
    await user.click(screen.getByRole("button", { name: "Lock it for good" }));
    expect(lockContract).toHaveBeenCalledWith("Tip");
  });
});
