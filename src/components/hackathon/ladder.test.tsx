import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";

const path = vi.hoisted(() => ({ current: "/hackathon/futminna" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
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

function show(at: string) {
  path.current = at;
  const fetcher = vi.fn(async () => new Response(JSON.stringify(entries)));
  vi.stubGlobal("fetch", fetcher);
  render(
    <AuthContextProvider value={{ ...unconfiguredAuth }}>
      <Ladder mode="web" />
    </AuthContextProvider>,
  );
  return fetcher;
}

it("shows the FUTMinna leaderboard: its own entries, a top-5 shortlist and no G$ estimates (D160)", async () => {
  const fetcher = show("/hackathon/futminna");
  await screen.findByText("Project 0");
  expect(fetcher).toHaveBeenCalledWith("/api/hackathon/projects?event=futminna", expect.anything());
  expect(screen.getAllByText("Shortlist")).toHaveLength(5);
  expect(screen.queryByText(/G\$/)).not.toBeInTheDocument();
  expect(screen.getByText(/judges pick the winner/)).toBeInTheDocument();
});

it("leaves the main leaderboard as it was", async () => {
  const fetcher = show("/hackathon");
  await screen.findByText("Project 0");
  expect(fetcher).toHaveBeenCalledWith("/api/hackathon/projects", expect.anything());
  expect(screen.queryByText("Shortlist")).not.toBeInTheDocument();
  expect(screen.getAllByText(/est\. .* G\$/).length).toBeGreaterThan(0);
});
