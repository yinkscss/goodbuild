import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TurnRecord } from "@/lib/turn-types";
import { HeldNotice, TurnError } from "./turn-view";

/** D177: while GoodBuild's AI account is empty, a request waits and says it will start on its own. */
const empty: TurnRecord = {
  kind: "turn",
  mode: "build",
  steps: [],
  log: [],
  changes: [],
  chargedMicro: 0,
  status: "error",
  error: "The AI provider account is out of funds (DeepSeek, 402): Insufficient Balance",
};

describe("a request held while the AI account is empty (D177)", () => {
  it("says it is saved and will start on its own, with no button to tap again", () => {
    render(<TurnError record={empty} onFix={vi.fn()} disabled={false} held />);
    expect(screen.getByText(/paused on our side\. We've been alerted and are fixing it\. Your request is saved and will start on its own\./)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps D166's card when nothing is held", () => {
    render(<TurnError record={empty} onFix={vi.fn()} disabled={false} />);
    expect(screen.getByText(/try again a little later/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fix it for me/ })).toBeInTheDocument();
  });

  it("only changes the empty-account card", () => {
    render(<TurnError record={{ ...empty, error: "boom" }} onFix={vi.fn()} disabled={false} held />);
    expect(screen.getByRole("button", { name: /Fix it for me/ })).toBeInTheDocument();
  });

  it("shows a waiting card for a request that hasn't started", () => {
    render(<HeldNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting to start");
    expect(screen.getByRole("status")).toHaveTextContent("will start on its own");
  });
});
