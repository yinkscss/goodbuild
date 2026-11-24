import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import { VoteList } from "./vote-list";

vi.mock("next/navigation", () => ({ usePathname: () => "/hackathon/projects" }));
vi.mock("@/components/auth/send-gate", () => ({ useSendGate: () => ({ openConnect: vi.fn() }) }));
vi.mock("@/components/auth/use-goodid-verify", () => ({ useGoodIdVerify: () => ({ verify: vi.fn(), busy: false, note: null, showLinkGuide: false }) }));
vi.mock("./flowstate-vote", () => ({ FlowstateVote: () => <button>Support</button> }));

const id = "11111111-1111-4111-8111-111111111111";
const entries = [
  { id, alias: "Ada", title: "Pay Pals", pitch: "Split bills with friends.", liveUrl: "https://pay.example", sourceUrl: "", approvals: 2 },
  { id: "22222222-2222-4222-8222-222222222222", alias: "Bo", title: "Other App", pitch: "Something else.", liveUrl: "https://o.example", sourceUrl: "", approvals: 0 },
];
const status = { max: 3, used: 0, entryIds: [], signedIn: false, verified: false, voted: false };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("votes") ? status : entries))));
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
const renderList = () =>
  render(
    <AuthContextProvider value={{ ...unconfiguredAuth, ready: true, user: null }}>
      <VoteList />
    </AuthContextProvider>,
  );

it("a shared project link shows that project and the three steps on the page, not the whole list", async () => {
  window.history.replaceState(null, "", `/hackathon/projects?vote=${id}`);
  renderList();
  expect(await screen.findByRole("heading", { name: "Pay Pals" })).toBeInTheDocument();
  expect(screen.getByText("Split bills with friends.")).toBeInTheDocument();
  expect(screen.getByText("Verify with GoodDollar")).toBeInTheDocument();
  expect(screen.getByText("Support us")).toBeInTheDocument();
  expect(screen.queryByText("Other App")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /See all projects/ })).toHaveAttribute("href", "/hackathon/projects");
});

it("without a shared link, the whole list shows", async () => {
  renderList();
  expect(await screen.findByText("Other App")).toBeInTheDocument();
  expect(screen.getByText("Pay Pals")).toBeInTheDocument();
});
