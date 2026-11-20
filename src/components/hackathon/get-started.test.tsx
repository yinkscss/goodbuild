import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";

const nav = vi.hoisted(() => ({ path: "/home/hackathon", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
}));
vi.mock("./quests", () => ({ Quests: () => null }));
vi.mock("@/components/referral/invite-card", () => ({ InviteFriendsCard: () => null }));
vi.mock("./register-steps", () => ({ RegisterSteps: () => <p>Register steps</p> }));
import { GetStarted } from "./get-started";

const registered = { registered: true, startCredits: 20, deployCredits: 0, deployPending: true };
const mainRow = { hackathon: "million-2027", email: "a@example.com", flowstate: "voted" };
const futRow = { ...mainRow, hackathon: "futminna-2026" };

afterEach(() => {
  vi.unstubAllGlobals();
  nav.replace.mockClear();
  window.history.replaceState(null, "", "/");
});

function show(path: string, participant: unknown) {
  nav.path = path;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/hackathon/participants") && init?.method === "POST") return new Response("null");
    if (url.startsWith("/api/hackathon/participants")) return new Response(JSON.stringify(participant));
    if (url === "/api/hackathon") return new Response(JSON.stringify(registered));
    return new Response("null");
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <AuthContextProvider value={{ ...unconfiguredAuth, ready: true, user: { id: "u", wallet: "0x1", walletKind: "embedded", verified: true } }}>
      <GetStarted />
    </AuthContextProvider>,
  );
  return fetcher;
}

it("opens the FUTMinna tabs for someone who registered from the FUTMinna page (D161)", async () => {
  show("/home/hackathon", futRow);
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/home/hackathon/futminna"));
});

it("keeps a FUTMinna member on the main hackathon when they picked it with the switch", async () => {
  window.history.replaceState(null, "", "/home/hackathon?stay=1");
  show("/home/hackathon", futRow);
  await screen.findByText("You’re in the hackathon.");
  expect(nav.replace).not.toHaveBeenCalled();
});

it("leaves main hackathon builders where they are", async () => {
  show("/home/hackathon", mainRow);
  await screen.findByText("You’re in the hackathon.");
  expect(nav.replace).not.toHaveBeenCalled();
});

it("asks a main hackathon builder to join FUTMinna instead of joining them just for looking", async () => {
  let row: unknown = mainRow;
  const fetcher = show("/home/hackathon/futminna", mainRow);
  // After the join, the FUTMinna signup is what the server returns.
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/hackathon/participants") && init?.method === "POST") return new Response(JSON.stringify((row = futRow)));
    if (url.startsWith("/api/hackathon/participants")) return new Response(JSON.stringify(row));
    if (url === "/api/hackathon") return new Response(JSON.stringify(registered));
    return new Response("null");
  });
  const button = await screen.findByRole("button", { name: "Join the FUTMinna hackathon" });
  expect(fetcher.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  await userEvent.click(button);
  await screen.findByText("You’re in. Build to win the scholarship.");
  expect(fetcher).toHaveBeenCalledWith("/api/hackathon/participants?event=futminna&join=1", { method: "POST" });
});
