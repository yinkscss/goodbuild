import * as React from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/credits/top-up-pill", () => ({ TopUpPill: () => <p>Pay with G$ pill</p> }));
vi.mock("@/components/credits/free-credits-card", () => ({ FreeCreditsCard: () => <p>Free credits card</p> }));

import { OutOfCredits } from "./out-of-credits";

it("opens by itself with both ways to get credits, and Continue retries the build", async () => {
  const onContinue = vi.fn();
  render(<OutOfCredits open freeCredits onContinue={onContinue} onRefresh={vi.fn()} />);
  expect(screen.getByRole("dialog", { name: "You're out of credits" })).toBeInTheDocument();
  expect(screen.getByText("Pay with G$ pill")).toBeInTheDocument();
  expect(screen.getByText("Free credits card")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Continue building" }));
  expect(onContinue).toHaveBeenCalledOnce();
});

it("leaves the free option out when free credits are off, and stays closed once dismissed", async () => {
  render(<OutOfCredits open freeCredits={false} onContinue={vi.fn()} onRefresh={vi.fn()} />);
  expect(screen.queryByText("Free credits card")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
