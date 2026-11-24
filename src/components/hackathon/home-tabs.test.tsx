import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ path: "/home/hackathon/project" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
import { HackathonTabs } from "./home-tabs";

it("keeps the main hackathon chosen when a builder goes back to its Get started (D161)", () => {
  nav.path = "/home/hackathon/project";
  render(<HackathonTabs />);
  expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/home/hackathon?stay=1");
  expect(screen.getByRole("link", { name: "Main hackathon" })).toHaveAttribute("href", "/home/hackathon?stay=1");
  expect(screen.getByRole("link", { name: "My project" })).toHaveAttribute("aria-current", "page");
});

it("leaves the FUTMinna tabs as plain links", () => {
  nav.path = "/home/hackathon/futminna";
  render(<HackathonTabs />);
  expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/home/hackathon/futminna");
  expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("aria-current", "page");
});

it("offers Kadpoly on the switch and keeps its tabs under its own path (D167)", () => {
  nav.path = "/home/hackathon/kadpoly/leaderboard";
  render(<HackathonTabs />);
  expect(screen.getByRole("link", { name: "Kadpoly" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute("href", "/home/hackathon/kadpoly/leaderboard");
  expect(screen.getByRole("link", { name: "FUTMinna" })).toHaveAttribute("href", "/home/hackathon/futminna");
});
