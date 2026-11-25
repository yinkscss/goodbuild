import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import type { TurnRecord } from "@/lib/turn-types";

import { TurnView } from "./turn-view";

// The first-message ideas reply (D173): an answered turn with no job, three ready ideas as chips.
it("shows the three ideas as chips that send the idea, with no build chrome", async () => {
  const ideas = ["A G$ savings circle for friends", "A G$ tip jar for my page", "Event tickets paid in G$"];
  const record: TurnRecord = { kind: "turn", mode: "build", steps: [], log: [], changes: [], chargedMicro: 0, status: "answered", suggestions: ideas };
  const onSuggest = vi.fn();
  render(<TurnView text="Here are three apps I can build for you right away." record={record} chainId={11142220} live={false} onFix={() => undefined} fixDisabled={false} onSuggest={onSuggest} />);
  for (const idea of ideas) expect(screen.getByRole("button", { name: new RegExp(idea.replace("$", "\\$")) })).toBeInTheDocument();
  expect(screen.queryByText(/Ready to try/i)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /tip jar/ }));
  expect(onSuggest).toHaveBeenCalledWith(ideas[1]);
});
