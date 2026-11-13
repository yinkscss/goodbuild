import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PALETTES } from "@/lib/palettes";
import type { PlanIntake, TurnRecord } from "@/lib/turn-types";

import { planBuildPrompt } from "@/lib/plan";

import { PlanCard, PlanDraftCard } from "./plan-card";
import { TurnView } from "./turn-view";

vi.mock("@/components/deploy/deploy-trigger", () => ({
  DeployButton: () => null,
  useDeployAction: () => ({ deployed: [] }),
}));

const intake = (answers: PlanIntake["answers"] = {}): PlanIntake => ({
  summary: "A tip jar for the club.",
  answers,
  questions: [
    { id: "q1", kind: "choice", label: "People can", question: "What should people be able to do?", multiple: true, options: [{ id: "o1", label: "Send money", recommended: true }, { id: "o2", label: "Withdraw" }] },
    { id: "q2", kind: "choice", label: "Who", question: "Who can take the money out?", multiple: false, options: [{ id: "o1", label: "Only me", recommended: true }, { id: "o2", label: "Everyone votes" }] },
    { id: "palette", kind: "palette", label: "Colours", question: "Which colours feel right?", multiple: false, options: PALETTES.map((p, i) => ({ id: p.id, label: p.name, ...(i === 0 ? { recommended: true } : {}) })) },
  ],
});

const actions = () => ({ answer: vi.fn(), start: vi.fn(), skip: vi.fn() });

describe("PlanCard", () => {
  it("shows the first unanswered question, so a reload resumes there", () => {
    render(<PlanCard intake={intake({ q1: { picks: ["o1"] } })} actions={actions()} />);
    expect(screen.getByRole("heading", { name: "Who can take the money out?" })).toBeTruthy();
    expect(screen.getByText("Question 2 of 3")).toBeTruthy();
  });

  it("one choice answers at a click, several wait for Continue", () => {
    const a = actions();
    const { rerender } = render(<PlanCard intake={intake()} actions={a} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Withdraw/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Send money/ }));
    expect(a.answer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(a.answer).toHaveBeenCalledWith("q1", { picks: ["o2", "o1"] });

    rerender(<PlanCard intake={intake({ q1: { picks: ["o1"] } })} actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: /Only me/ }));
    expect(a.answer).toHaveBeenLastCalledWith("q2", { picks: ["o1"] });
  });

  it("always offers Other, in free text", () => {
    const a = actions();
    render(<PlanCard intake={intake({ q1: { picks: ["o1"] } })} actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: /Other/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your own answer" }), { target: { value: "My treasurer" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(a.answer).toHaveBeenCalledWith("q2", { picks: [], other: "My treasurer" });
  });

  it("shows every palette as a swatch with its own colours", () => {
    const a = actions();
    const { container } = render(<PlanCard intake={intake({ q1: { picks: ["o1"] }, q2: { picks: ["o1"] } })} actions={a} />);
    for (const p of PALETTES) expect(screen.getByRole("button", { name: new RegExp(p.name) })).toBeTruthy();
    expect(container.innerHTML).toContain("background: rgb(245, 184, 61)"); // Midnight's gold
    fireEvent.click(screen.getByRole("button", { name: /Forest/ }));
    expect(a.answer).toHaveBeenCalledWith("palette", { picks: ["forest"] });
  });

  it("has a visible Skip on every question, and a summary with Start building at the end", () => {
    const a = actions();
    const { unmount } = render(<PlanCard intake={intake()} actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip, just build it" }));
    expect(a.skip).toHaveBeenCalledOnce();
    unmount();

    render(<PlanCard intake={intake({ q1: { picks: ["o1", "o2"] }, q2: { picks: [], other: "My treasurer" }, palette: { picks: ["ocean"] } })} actions={a} />);
    expect(screen.getByText("A tip jar for the club.")).toBeTruthy();
    expect(screen.getByText("Send money, Withdraw")).toBeTruthy();
    expect(screen.getByText("My treasurer")).toBeTruthy();
    expect(screen.getByText("Ocean")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Start building/ }));
    expect(a.start).toHaveBeenCalledOnce();
  });

  it("Change goes back to that question", () => {
    render(<PlanCard intake={intake({ q1: { picks: ["o1"] }, q2: { picks: ["o1"] }, palette: { picks: ["ocean"] } })} actions={actions()} />);
    fireEvent.click(screen.getByRole("button", { name: "Change Who" }));
    expect(screen.getByRole("heading", { name: "Who can take the money out?" })).toBeTruthy();
  });

  it("shows a game's pitch with the summary, and on the read-only plan (D93)", () => {
    const game: PlanIntake["game"] = { name: "Neon Drift", pitch: "Weave through night traffic.", loop: "dodge, collect, boost", lose: "you crash", harder: "traffic speeds up", extras: ["near-miss bonus", "daily missions"] };
    const done = { ...intake({ q1: { picks: ["o1"] }, q2: { picks: ["o1"] }, palette: { picks: ["ocean"] } }), game };
    const { unmount } = render(<PlanCard intake={done} actions={actions()} />);
    expect(screen.getByText("Neon Drift")).toBeTruthy();
    expect(screen.getByText("Weave through night traffic.")).toBeTruthy();
    expect(screen.getByText("near-miss bonus · daily missions")).toBeTruthy();
    unmount();
    render(<PlanCard intake={done} />);
    expect(screen.getByText("you crash")).toBeTruthy();
  });

  it("is read-only once the build has started", () => {
    render(<PlanCard intake={intake({ q1: { picks: ["o1"] } })} />);
    expect(screen.getByText("Send money")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("TurnView", () => {
  const record: TurnRecord = {
    kind: "turn",
    mode: "build",
    steps: [{ id: "a", label: "Writing App.tsx", status: "done" }],
    log: ["→ wrote src/App.tsx", "context: 4 of 20 files in full"],
    changes: [{ path: "src/App.tsx", op: "create", added: 10, removed: 0, diff: "+x" }],
    chargedMicro: 0,
    status: "answered",
  };
  const view = (r: TurnRecord, live = false, chainId = 11142220) => <TurnView text="Built it." record={r} chainId={chainId} live={live} onFix={() => undefined} fixDisabled={false} />;

  it("no longer shows the build log or the file chips, live or finished", () => {
    for (const live of [true, false]) {
      const { container, unmount } = render(view(record, live));
      expect(container.innerHTML).not.toContain("build log");
      expect(container.innerHTML).not.toContain("wrote src/App.tsx");
      expect(container.innerHTML).not.toContain("src/App.tsx");
      unmount();
    }
    expect(record.log).toHaveLength(2); // the record itself is untouched
  });

  it("keeps the step rows while running, and folds them away afterwards", () => {
    const { rerender, container } = render(view({ ...record }, true));
    expect(screen.getByText("Writing App.tsx")).toBeTruthy();
    expect(container.querySelector("details")).toBeNull();
    // A step that auto-fix recovered from doesn't keep the list open.
    rerender(view({ ...record, status: "ready", steps: [...record.steps, { id: "b", label: "Compiling", status: "error" }] }, false));
    expect(container.querySelector("details")).not.toBeNull();
    expect(screen.getByText("2 steps done")).toBeTruthy();
  });

  it("the error card keeps its expandable logs", () => {
    const { container } = render(view({ ...record, status: "error", error: "It broke" }));
    expect(screen.getByText("Writing App.tsx").closest("details")).toBeNull();
    expect(container.querySelector("ol")).not.toBeNull();
    expect(screen.getByText("Logs")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("wrote src/App.tsx");
  });

  it("labels deploy-ready contracts with the project's network", () => {
    const ready = { ...record, status: "ready" as const, contracts: [{ name: "Tip", file: "contracts/Tip.sol", bytecodeBytes: 1024 }] };
    render(view(ready, false, 42220));
    expect(screen.getByText(/Celo · 1\.0 kB/)).toBeTruthy();
  });
});

describe("PlanDraftCard", () => {
  const plan = { summary: "A weekly savings jar.", steps: ["Add a Jar contract", "Build the deposit page"] };

  it("lists the steps, builds in one tap and sends Change to the composer", () => {
    const a = { build: vi.fn(), change: vi.fn() };
    render(<PlanDraftCard plan={plan} actions={a} />);
    expect(screen.getByText("A weekly savings jar.")).toBeTruthy();
    expect(screen.getByText("Build the deposit page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Build this plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Build this plan" }));
    expect(a.build).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Change something" }));
    expect(a.change).toHaveBeenCalledOnce();
  });

  it("is read-only without actions, and shows only in Plan mode turns", () => {
    const { unmount } = render(<PlanDraftCard plan={plan} />);
    expect(screen.getByText("Add a Jar contract")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    const record: TurnRecord = { kind: "turn", mode: "build", plan, steps: [], log: [], changes: [], chargedMicro: 0, status: "ready" };
    const view = (r: TurnRecord) => <TurnView text="Done." record={r} chainId={11142220} live={false} onFix={() => undefined} fixDisabled={false} draft={{ build: vi.fn(), change: vi.fn() }} />;
    const built = render(view(record));
    expect(screen.queryByText("Build this plan")).toBeNull();
    built.unmount();
    render(view({ ...record, mode: "plan", status: "answered" }));
    expect(screen.getByRole("button", { name: "Build this plan" })).toBeTruthy();
  });

  it("the build message carries the whole plan", () => {
    expect(planBuildPrompt(plan)).toBe("Build this plan: A weekly savings jar.\n1. Add a Jar contract\n2. Build the deposit page");
  });
});

describe("PlanCard for Plan mode's questions (D103)", () => {
  it("ends on Draft the plan, and skips to the plan, not the build", () => {
    const a = actions();
    const { unmount } = render(<PlanCard intake={{ ...intake(), for: "plan" }} actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip, just plan it" }));
    expect(a.skip).toHaveBeenCalledOnce();
    unmount();
    render(<PlanCard intake={{ ...intake({ q1: { picks: ["o1"] }, q2: { picks: ["o1"] }, palette: { picks: ["ocean"] } }), for: "plan" }} actions={a} />);
    expect(screen.queryByRole("button", { name: /Start building/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Draft the plan" }));
    expect(a.start).toHaveBeenCalledOnce();
  });
});
