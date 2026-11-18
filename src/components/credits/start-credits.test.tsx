import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./add-credits", () => ({ AddCredits: () => <button type="button">Add credits</button> }));
vi.mock("./free-credits-card", () => ({ FreeCreditsCard: () => <p>Free credits card</p> }));

import { StartCredits } from "./start-credits";

afterEach(() => sessionStorage.clear());

it("offers Add credits and free credits once per session", async () => {
  const { unmount } = render(<StartCredits freeCredits />);
  expect(await screen.findByRole("dialog", { name: "Get credits to start building" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add credits" })).toBeInTheDocument();
  expect(screen.getByText("Free credits card")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  unmount();
  render(<StartCredits freeCredits />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("leaves the free option out when free credits are off", async () => {
  render(<StartCredits freeCredits={false} />);
  await screen.findByRole("dialog");
  expect(screen.queryByText("Free credits card")).not.toBeInTheDocument();
});
