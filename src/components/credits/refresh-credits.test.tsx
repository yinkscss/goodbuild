import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
const { refresh, retry } = vi.hoisted(() => ({ refresh: vi.fn(), retry: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./pending-payments", () => ({ retryPending: retry }));
import { RefreshCredits } from "./refresh-credits";
beforeEach(() => { vi.clearAllMocks(); });
it("checks saved payments before refreshing balance and history", async () => {
  let finish!: (n: number) => void;
  retry.mockImplementation(() => new Promise<number>((resolve) => { finish = resolve; }));
  render(<RefreshCredits />);
  const button = screen.getByRole("button", { name: "Refresh credits" });
  await userEvent.click(button);
  expect(button).toBeDisabled();
  expect(screen.getByRole("progressbar")).toHaveAccessibleName("Refreshing credits");
  expect(refresh).not.toHaveBeenCalled();
  finish(0); // scanner-first settlement still refreshes
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/Balance and recent top-ups refreshed/)).toBeVisible();
});
it("shows retry guidance if checking a payment fails, while refreshing the current balance", async () => {
  retry.mockRejectedValue(new Error("We couldn't check a pending payment. Try again."));
  render(<RefreshCredits />);
  await userEvent.click(screen.getByRole("button", { name: "Refresh credits" }));
  expect(await screen.findByText(/couldn't check a pending payment/)).toBeVisible();
  expect(refresh).toHaveBeenCalledOnce();
});
