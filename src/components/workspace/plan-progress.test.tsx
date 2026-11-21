import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Step, TurnRecord } from "@/lib/turn-types";

import { TurnError, TurnView } from "./turn-view";

const plan = { summary: "A savings goals app.", steps: ["Lay out the savings goals screen", "/goals: add, edit and remove goals"] };
const record = (steps: Step[], over: Partial<TurnRecord> = {}): TurnRecord => ({ kind: "turn", mode: "build", plan, steps, log: ["→ wrote src/App.tsx"], changes: [], chargedMicro: 0, status: "ready", ...over });
const view = (r: TurnRecord, live: boolean, extra: Partial<Parameters<typeof TurnView>[0]> = {}) => (
  <TurnView text="" record={r} chainId={11142220} live={live} onFix={() => undefined} fixDisabled={false} {...extra} />
);

describe("the plan as a checklist (D164)", () => {
  const running = [
    { id: "a", label: "Writing App.tsx", status: "done", plan: 0 },
    { id: "b", label: "Writing GoalForm.tsx", status: "running", plan: 1 },
  ] satisfies Step[];

  it("shows the plan's steps plus checking it works, one working at a time, with one trail line under it", () => {
    render(view(record(running), true));
    const list = screen.getByRole("list", { name: "Build plan" });
    expect(within(list).getByText("Lay out the savings goals screen")).toBeInTheDocument();
    // The route is dropped from a spec step.
    expect(within(list).getByText("Add, edit and remove goals")).toBeInTheDocument();
    expect(within(list).getByText(/Checking it works on a phone and a computer/)).toBeInTheDocument();
    expect(within(list).getByText("Step 2 of 3")).toBeInTheDocument();
    expect(within(list).getAllByLabelText("Done")).toHaveLength(1);
    expect(within(list).getByLabelText("Running")).toBeInTheDocument();
    // One line, plain words, the file faint beside it. The earlier file isn't listed.
    expect(within(list).getByText("Building the goal form")).toBeInTheDocument();
    expect(within(list).getByText("GoalForm.tsx")).toBeInTheDocument();
    expect(within(list).queryByText("Building the main screen")).toBeNull();
    expect(screen.queryByText(/Writing/)).toBeNull();
  });

  it("fades the trail line out when that part is done", () => {
    const { container } = render(view(record([{ ...running[1], status: "done" }]), true));
    expect(container.querySelector(".gb-trail-out")).not.toBeNull();
    expect(container.querySelector(".gb-trail-in")).toBeNull();
  });

  it("folds into All steps done when the build worked", () => {
    render(view(record([...running.map((s) => ({ ...s, status: "done" as const })), { id: "autofix", label: "Auto-fix: fixed", detail: "Fixed 1 error on attempt 1 of 3", status: "done", plan: 2 }]), false));
    expect(screen.getByText("All 3 steps done")).toBeInTheDocument();
    expect(screen.getByText("Fixed 1 problem by itself")).toBeInTheDocument();
  });

  it("shows where it got to, and one problem card, when it didn't finish", () => {
    render(view(record(running.map((s) => ({ ...s, status: "done" as const })), { status: "needs_fix" }), false));
    expect(screen.getByText("Where it got to")).toBeInTheDocument();
    expect(screen.getByLabelText("Needs a fix")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Fix it for me/ })).toHaveLength(1);
  });

  it("keeps plain step rows for turns saved before D164", () => {
    render(view(record([{ id: "a", label: "Writing App.tsx", status: "done" }], { plan: undefined }), false));
    expect(screen.getByText("1 step done")).toBeInTheDocument();
  });

  it("shows a finished build as the mock: a headline, what works, one Next button and one quiet footer", async () => {
    const onSuggest = vi.fn();
    const onUndo = vi.fn();
    const done = record(running.map((s) => ({ ...s, status: "done" as const })), {
      outcome: { headline: "Your savings goals app works.", works: ["Add, edit and remove goals", "Goals are saved on this device"], later: "Putting real money aside comes next." },
      suggestions: ["Connect a wallet", "Change the colours"],
      review: { ok: true, issues: [], fixed: false },
      chargedMicro: 380_000,
      version: 4,
    });
    render(view(done, false, { onSuggest, onUndo }));
    expect(screen.getByText("Ready to try")).toBeInTheDocument();
    expect(screen.getByText("Your savings goals app works.")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "What works" });
    expect(within(list).getAllByLabelText("Works")).toHaveLength(2);
    expect(within(list).getByText("Putting real money aside comes next.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Next: connect a wallet/ }));
    expect(onSuggest).toHaveBeenCalledWith("Connect a wallet");
    expect(screen.getByRole("button", { name: /Change the colours/ })).toBeInTheDocument();
    expect(screen.getByText(/Checked on a phone and a computer/)).toBeInTheDocument();
    // The steps are folded behind the footer.
    expect(screen.queryByRole("list", { name: "Build plan" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "3 steps" }));
    expect(screen.getByRole("list", { name: "Build plan" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });
});

describe("undo this change (D164)", () => {
  it("asks in the page, then goes back", async () => {
    const onUndo = vi.fn();
    render(view(record([], { version: 4 }), false, { onUndo }));
    await userEvent.click(screen.getByRole("button", { name: "Undo this change" }));
    expect(screen.getByText(/goes back to how it was before this message/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onUndo).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Undo this change" }));
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });
});

describe("one problem card (D164)", () => {
  it("says the preview crash is fixed by the same button, and keeps the crash in the technical details", () => {
    render(<TurnError record={record([], { status: "error", error: "fetch failed" })} onFix={vi.fn()} disabled={false} previewError="TypeError: Cannot read properties of undefined (reading 'map')" />);
    const card = screen.getByRole("alert");
    expect(within(card).getAllByRole("button")).toHaveLength(1);
    expect(card.textContent).toContain("The preview crashed too, and this fixes that as well.");
    expect(within(card).getByText("Technical details (for support)")).toBeInTheDocument();
    expect(card.querySelector("pre")?.textContent).toContain("reading 'map'");
  });
});
