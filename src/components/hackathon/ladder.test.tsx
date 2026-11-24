import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";

import { Ladder } from "./ladder";

afterEach(() => vi.unstubAllGlobals());

const entries = Array.from({ length: 6 }, (_, i) => ({
  id: `e${i}`,
  alias: `Builder ${i}`,
  title: `Project ${i}`,
  pitch: "",
  liveUrl: "https://x.example",
  sourceUrl: "",
  approvals: 10 - i,
}));

function show() {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(entries)));
  vi.stubGlobal("fetch", fetcher);
  render(
    <AuthContextProvider value={{ ...unconfiguredAuth }}>
      <Ladder mode="web" />
    </AuthContextProvider>,
  );
  return fetcher;
}

it("shows one leaderboard with G$ estimates and no campus badges (D170)", async () => {
  const fetcher = show();
  await screen.findByText("Project 0");
  expect(fetcher).toHaveBeenCalledWith("/api/hackathon/projects", expect.anything());
  expect(screen.queryByText(/Shortlist|Waitlist/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/est\. .* G\$/).length).toBeGreaterThan(0);
});

it("shows a builder ranked inside the top 20 once, not again below the list", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("mine") ? { id: "e5" } : entries))),
  );
  render(
    <AuthContextProvider value={{ ...unconfiguredAuth, user: { id: "u", wallet: "0x1", walletKind: "embedded", verified: true } }}>
      <Ladder mode="app" />
    </AuthContextProvider>,
  );
  await screen.findByText(/You are #6/);
  expect(screen.getAllByText("Project 5")).toHaveLength(1);
  expect(screen.getAllByText("You")).toHaveLength(1);
});

it("lists every project: past the top 20, and ideas not live yet (D170)", async () => {
  const many = [
    ...Array.from({ length: 23 }, (_, i) => ({ id: `p${i}`, alias: `B${i}`, title: `Live ${i}`, pitch: "", liveUrl: "https://x.example", sourceUrl: "", approvals: 30 - i })),
    { id: "idea", alias: "Ida", title: "Just an idea", pitch: "", liveUrl: "", sourceUrl: "", approvals: 0 },
  ];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(many))));
  render(
    <AuthContextProvider value={{ ...unconfiguredAuth }}>
      <Ladder mode="web" />
    </AuthContextProvider>,
  );
  await screen.findByText("Live 0");
  expect(screen.getByText("Live 22")).toBeInTheDocument();
  expect(screen.getByText("Prize zone ends at #20")).toBeInTheDocument();
  expect(screen.getByText("Just an idea")).toBeInTheDocument();
  expect(screen.getByText(/Not live yet: ranked once/)).toBeInTheDocument();
});
