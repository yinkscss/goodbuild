import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PALETTES } from "@/lib/palettes";
import type { PlanIntake, TurnRecord } from "@/lib/turn-types";

import { PlanCard } from "./plan-card";
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
  const view = (r: TurnRecord, live = false) => <TurnView text="Built it." record={r} live={live} onFix={() => undefined} fixDisabled={false} />;

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
    rerender(view({ ...record }, false));
    expect(container.querySelector("details")).not.toBeNull();
    expect(screen.getByText("1 step done")).toBeTruthy();
  });

  it("the error card keeps its expandable logs", () => {
    render(view({ ...record, status: "error", error: "It broke" }));
    expect(screen.getByText("Logs")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("wrote src/App.tsx");
  });
});
