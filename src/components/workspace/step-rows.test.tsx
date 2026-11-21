import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StepRows } from "./turn-view";

describe("StepRows", () => {
  it("shows a fix attempt's steps under it, and says which one it is on while it runs", () => {
    render(
      <StepRows
        live
        steps={[
          { id: "a", label: "Opening the app", status: "error", detail: "1 problem" },
          { id: "fix:1", label: "Fixing errors (attempt 1 of 5)", status: "running", detail: "1 error to fix" },
          { id: "b", label: "Writing WalletCard.tsx", status: "done", parent: "fix:1" },
          { id: "c", label: "Checking the app", status: "running", parent: "fix:1" },
        ]}
      />,
    );
    const group = screen.getByRole("list", { name: "Fixing a small thing it found: steps" });
    // D163: plain words, with the file name kept faintly beside them.
    expect(within(group).getByText("Building the wallet card")).toBeInTheDocument();
    expect(within(group).getByText("WalletCard.tsx")).toBeInTheDocument();
    expect(within(group).getByText("Checking the app")).toBeInTheDocument();
    expect(screen.getByText("Working on it: Checking the app")).toBeInTheDocument();
    // The parent's own "to fix" note gives way to what it is doing now.
    expect(screen.queryByText("1 error to fix")).not.toBeInTheDocument();
  });

  it("shows the attempt's result once it is done", () => {
    render(
      <StepRows
        steps={[
          { id: "fix:1", label: "Fixing errors (attempt 1 of 5)", status: "done", detail: "all checks pass" },
          { id: "b", label: "Writing App.tsx", status: "done", parent: "fix:1" },
        ]}
      />,
    );
    expect(screen.getByText("all checks pass")).toBeInTheDocument();
    expect(screen.getByText("Building the main screen")).toBeInTheDocument();
  });
});
