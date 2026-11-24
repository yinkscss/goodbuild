import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import { InviteSteps } from "./invite-steps";

const openConnect = vi.fn();
vi.mock("@/components/auth/send-gate", () => ({ useSendGate: () => ({ openConnect }) }));
vi.mock("@/components/auth/use-goodid-verify", () => ({ useGoodIdVerify: () => ({ verify: vi.fn(), busy: false, note: null, showLinkGuide: false }) }));

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
const reply = (body: unknown) => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => new Response(JSON.stringify(String(url).includes("referral") ? { recorded: true } : body)));

it("signed out: asks to sign up and doesn't call the server yet", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  renderSteps(null);
  await userEvent.click(screen.getByRole("button", { name: "Sign up to start" }));
  expect(openConnect).toHaveBeenCalled();
  expect(f).not.toHaveBeenCalled();
});

it("signed in: tells the server whose link it was once, then offers verify; there is no vote step", async () => {
  const f = reply({});
  vi.stubGlobal("fetch", f);
  renderSteps({ verified: false });
  await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ code: "ABCD2345" });
  expect(screen.getByRole("button", { name: "Verify with GoodDollar" })).toBeInTheDocument();
  expect(screen.queryByText(/Tap to vote/)).not.toBeInTheDocument();
});

it("verified and credits added: shows the way in", async () => {
  vi.stubGlobal("fetch", reply({ verified: true, welcomeMicro: 40_000_000 }));
  renderSteps({ verified: true });
  expect(await screen.findByRole("link", { name: /Start building/ })).toHaveAttribute("href", "/home");
});

it("verified but not voted yet: points to the vote page", async () => {
  vi.stubGlobal("fetch", reply({ verified: true, needsVote: true }));
  renderSteps({ verified: true });
  expect(await screen.findByRole("link", { name: "Vote to unlock credits" })).toHaveAttribute("href", "/vote");
});
