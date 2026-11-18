import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/credits/top-up-pill", () => ({ TopUpPill: () => <p>Pay with G$ pill</p> }));
vi.mock("@/components/credits/free-credits-card", () => ({ FreeCreditsCard: () => <p>Free credits card</p> }));
let balanceMicro = 0;
vi.mock("@/components/credits/use-buy-credits", () => ({ useCreditsInfo: () => ({ info: null, pricing: { balanceMicro }, reload: vi.fn() }) }));

import { OutOfCredits } from "./out-of-credits";

afterEach(() => {
  balanceMicro = 0;
});

it("opens by itself with both ways to get credits, and offers Continue only once a build is covered", async () => {
  const onContinue = vi.fn();
  const { rerender } = render(<OutOfCredits open freeCredits onContinue={onContinue} onRefresh={vi.fn()} />);
  expect(screen.getByRole("dialog", { name: "You're out of credits" })).toBeInTheDocument();
  expect(screen.getByText("Pay with G$ pill")).toBeInTheDocument();
  expect(screen.getByText("Free credits card")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue building" })).not.toBeInTheDocument();
  balanceMicro = 400_000;
  rerender(<OutOfCredits open freeCredits onContinue={onContinue} onRefresh={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Continue building" }));
  expect(onContinue).toHaveBeenCalledOnce();
});

it("leaves the free option out when free credits are off, and closing it leaves one inline pill", async () => {
  render(<OutOfCredits open freeCredits={false} onContinue={vi.fn()} onRefresh={vi.fn()} />);
  expect(screen.queryByText("Free credits card")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getAllByText("Pay with G$ pill")).toHaveLength(1);
});
