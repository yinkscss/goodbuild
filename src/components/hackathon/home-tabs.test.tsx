import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ path: "/home/hackathon/project" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
import { HackathonTabs } from "./home-tabs";

it("shows the four sections of the one hackathon, with no hackathon switch (D170)", () => {
  nav.path = "/home/hackathon/project";
  render(<HackathonTabs />);
  expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/home/hackathon");
  expect(screen.getByRole("link", { name: "My project" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute("href", "/home/hackathon/leaderboard");
  expect(screen.queryByRole("navigation", { name: "Hackathons" })).toBeNull();
  expect(screen.queryByRole("link", { name: /FUTMinna|Kadpoly/ })).toBeNull();
});
