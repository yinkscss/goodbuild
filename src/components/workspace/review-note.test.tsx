import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TurnRecord } from "@/lib/turn-types";

import { ReviewNote } from "./turn-view";

const record = (review: TurnRecord["review"]): TurnRecord => ({ kind: "turn", mode: "build", steps: [], log: [], changes: [], chargedMicro: 0, status: "ready", review });

describe("ReviewNote (D87)", () => {
  it("shows nothing for a build that wasn't looked at", () => {
    const { container } = render(<ReviewNote record={record(undefined)} disabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is one quiet line when the page looked right", () => {
    render(<ReviewNote record={record({ ok: true, issues: [], fixed: false })} disabled={false} />);
    expect(screen.getByText(/Checked on a phone and a computer: looks right/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says how many things it fixed, with what they were behind the line", () => {
    render(<ReviewNote record={record({ ok: false, issues: ["phone: the headline was cut off", "computer: two cards overlapped"], fixed: true })} disabled={false} />);
    expect(screen.getByText(/fixed 2 things/)).toBeInTheDocument();
    expect(screen.getByText("phone: the headline was cut off")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fix it for me/ })).toBeNull();
  });

  it("offers Fix it for me, with what it saw, when it left the page as it was", async () => {
    const onFix = vi.fn();
    render(<ReviewNote record={record({ ok: false, issues: ["phone: the headline is cut off"], fixed: false })} onFix={onFix} disabled={false} />);
    expect(screen.getByText(/one thing still looks off/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Fix it for me/ }));
    expect(onFix).toHaveBeenCalledWith("Fix these problems you saw when you looked at the page:\n- phone: the headline is cut off", "repair");
  });
});
