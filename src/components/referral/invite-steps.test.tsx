import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import { InviteSteps } from "./invite-steps";

const openConnect = vi.fn();
vi.mock("@/components/auth/send-gate", () => ({ useSendGate: () => ({ openConnect }) }));
vi.mock("@/components/auth/use-goodid-verify", () => ({ useGoodIdVerify: () => ({ verify: vi.fn(), busy: false, note: null, showLinkGuide: false }) }));
vi.mock("@/components/hackathon/flowstate-vote", () => ({
  FlowstateVote: ({ onConfirmed, verifyHref }: { onConfirmed: () => void; verifyHref: string }) => (
    <button data-verify={verifyHref} onClick={onConfirmed}>Tap to vote</button>
  ),
}));

const wallet = "0x1111111111111111111111111111111111111111";
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
const renderSteps = (user: { verified: boolean } | null) =>
  render(
    <AuthContextProvider value={{ ...unconfiguredAuth, ready: true, user: user ? { id: "u", wallet, walletKind: "embedded", ...user } : null }}>
      <InviteSteps code="ABCD2345" />
    </AuthContextProvider>,
  );

it("signed out: asks to sign in and doesn't call the server yet", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  renderSteps(null);
  await userEvent.click(screen.getByRole("button", { name: "Sign in to start" }));
  expect(openConnect).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Tap to vote" })).not.toBeInTheDocument();
  expect(f).not.toHaveBeenCalled();
});

it("signed in: tells the server whose link it was once, then offers verify first", async () => {
  const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ recorded: true })));
  vi.stubGlobal("fetch", f);
  renderSteps({ verified: false });
  await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(vi.mocked(f).mock.calls[0][1]?.body))).toEqual({ code: "ABCD2345" });
  expect(screen.getByRole("button", { name: "Verify with GoodDollar" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Tap to vote" })).not.toBeInTheDocument();
});

it("verified: the one-tap vote opens, and a confirmed vote shows the thank-you and a way in", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ recorded: false }))));
  renderSteps({ verified: true });
  const vote = await screen.findByRole("button", { name: "Tap to vote" });
  expect(vote).toHaveAttribute("data-verify", "/r/ABCD2345");
  await userEvent.click(vote);
  expect(await screen.findByRole("link", { name: /Start building/ })).toHaveAttribute("href", "/home");
});
