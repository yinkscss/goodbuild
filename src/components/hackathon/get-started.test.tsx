import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

it("shows a registered builder where they stand, with no redirect to a campus hackathon (D170)", async () => {
  show("/home/hackathon", mainRow);
  await screen.findByText("You’re in the hackathon.");
  expect(nav.replace).not.toHaveBeenCalled();
});
