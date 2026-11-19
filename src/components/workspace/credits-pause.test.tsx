import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TurnRecord } from "@/lib/turn-types";
import { Composer } from "./chat-panel";
import { TurnError } from "./turn-view";

/** D138: a build paused for credits says what Continue costs, and the composer warns before a build the balance can't cover. */
const paused: TurnRecord = {
  kind: "turn",
  mode: "build",
  steps: [],
  log: [],
  changes: [],
  chargedMicro: 0,
  status: "needs_fix",
  paused: "credits",
  error: "This build paused because your credits ran low.",
};

function composer(availableMicro: number | null, buildMicro = 740_000) {
  render(
    <Composer
      assets={[]}
      assetUrls={{}}
      onUpload={vi.fn()}
      onRemove={vi.fn()}
      onChangeKind={vi.fn()}
      uploading={false}
      running={false}
      estimate={{ buildMicro, planMicro: 0 }}
      availableMicro={availableMicro}
      onSend={vi.fn()}
      placeholder="Ask"
    />,
  );
}

describe("a build paused for credits (D138)", () => {
  it("offers Continue with its cost, and warns when the balance is short", () => {
    const onFix = vi.fn();
    render(<TurnError record={paused} onFix={onFix} disabled={false} continueCost={{ needMicro: 740_000, haveMicro: 220_000 }} />);
    expect(screen.getByText("Paused: your credits ran low")).toBeInTheDocument();
    expect(screen.getByText(/Continuing costs about 74 credits; you have 22 credits/)).toHaveClass("text-warning");
    fireEvent.click(screen.getByRole("button", { name: "Continue · ≈ 74" }));
    expect(onFix).toHaveBeenCalledOnce();
  });

  it("is plain Continue without a cost, and other errors keep their own buttons", () => {
    const { unmount } = render(<TurnError record={paused} onFix={vi.fn()} disabled={false} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    unmount();
    render(<TurnError record={{ ...paused, paused: undefined }} onFix={vi.fn()} disabled={false} continueCost={{ needMicro: 740_000, haveMicro: 0 }} />);
    expect(screen.getByRole("button", { name: "Try fix" })).toBeInTheDocument();
    expect(screen.queryByText(/Continuing costs/)).toBeNull();
  });

  it("the composer warns before a build bigger than the balance, and stays quiet otherwise", () => {
    composer(330_000);
    expect(screen.getByRole("status")).toHaveTextContent("≈ 74 credits · you have 33, it may pause");
  });

  it("says nothing extra when the balance covers it or is unknown", () => {
    composer(1_000_000);
    expect(screen.queryByText(/it may pause/)).toBeNull();
    composer(null);
    expect(screen.queryByText(/it may pause/)).toBeNull();
  });
});
