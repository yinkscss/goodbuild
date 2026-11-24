import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import { VoteSteps } from "./vote-steps";

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
      <VoteSteps />
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

it("signed in, not verified: offers verify first and doesn't tell the server about any invite", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  renderSteps({ verified: false });
  expect(screen.getByRole("button", { name: "Verify with GoodDollar" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Tap to vote" })).not.toBeInTheDocument();
  expect(f).not.toHaveBeenCalled();
});

it("verified: the one-tap vote opens, and a confirmed vote shows the thank-you and a way in", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ recorded: false }))));
  renderSteps({ verified: true });
  const vote = await screen.findByRole("button", { name: "Tap to vote" });
  expect(vote).toHaveAttribute("data-verify", "/vote");
  await userEvent.click(vote);
  expect(await screen.findByText("Thank you for voting!")).toBeInTheDocument();
});
