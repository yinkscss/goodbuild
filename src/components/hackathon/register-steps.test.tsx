import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
const nav = vi.hoisted(() => ({ path: "/hackathon" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
import { RegisterSteps } from "./register-steps";
const run = vi.fn();
vi.mock("./flowstate-vote", () => ({
  FlowstateVote: ({ onConfirmed }: { onConfirmed: () => void }) => (
    <button onClick={onConfirmed}>Confirm test FlowState vote</button>
  ),
}));
vi.mock("@/components/auth/send-gate", () => ({
  useSendGate: () => ({ openConnect: vi.fn() }),
}));
vi.mock("./use-hackathon-claim", () => ({
  START_CREDITS: 20,
  DEPLOY_CREDITS: 30,
  useHackathonClaim: () => ({
    status: { registered: false },
    run,
    busy: false,
  }),
}));
vi.mock("@/components/auth/use-goodid-verify", () => ({
  useGoodIdVerify: () => ({ verify: vi.fn(), busy: false }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  run.mockClear();
  nav.path = "/hackathon";
});
it("requires a confirmed in-page vote before the explicit credit claim", async () => {
  const f = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          email: "builder@example.com",
          flowstate: init?.body ? "skipped" : "pending",
        }),
      ),
  );
  vi.stubGlobal("fetch", f);
  render(
    <AuthContextProvider
      value={{
        ...unconfiguredAuth,
        ready: true,
        configured: true,
        user: {
          id: "u",
          wallet: "0x123",
          walletKind: "embedded",
          email: "builder@example.com",
          verified: true,
        },
      }}
    >
      <RegisterSteps />
    </AuthContextProvider>,
  );
  const claim = await screen.findByRole("button", {
    name: "Claim 20 free credits",
  });
  await waitFor(() =>
    expect(screen.getByText(/Email saved/)).toBeInTheDocument(),
  );
  expect(claim).toBeDisabled();
  expect(run).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: /skip/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /FlowState/i }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm test FlowState vote" }),
  );
  await waitFor(() => expect(claim).toBeEnabled());
  expect(run).not.toHaveBeenCalled();
  await userEvent.click(claim);
  expect(run).toHaveBeenCalledOnce();
});
it("waits for auth hydration before mounting the verification flow", () => {
  render(
    <AuthContextProvider value={{ ...unconfiguredAuth, ready: false }}>
      <RegisterSteps />
    </AuthContextProvider>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Loading your signup");
  expect(screen.queryByText("Verify with GoodDollar")).not.toBeInTheDocument();
});

it("joins FUTMinna only when the email is saved there, and offers a retry if that fails (D161)", async () => {
  nav.path = "/hackathon/futminna";
  let joinOk = false;
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("join=1")) return joinOk ? new Response(JSON.stringify({ hackathon: "futminna-2026" })) : new Response("{}", { status: 500 });
    if (init?.method === "POST") return new Response(JSON.stringify({ email: "student@example.com", flowstate: "pending" }));
    return new Response("null");
  });
  vi.stubGlobal("fetch", f);
  render(
    <AuthContextProvider
      value={{ ...unconfiguredAuth, ready: true, configured: true, user: { id: "u", wallet: "0x123", walletKind: "external", verified: false } }}
    >
      <RegisterSteps />
    </AuthContextProvider>,
  );
  const joins = () => f.mock.calls.filter(([url]) => String(url).includes("join=1")).length;
  await userEvent.type(await screen.findByLabelText(/email/i), "student@example.com");
  // Opening the page joined nobody.
  expect(joins()).toBe(0);
  await userEvent.click(screen.getByRole("button", { name: "Save email & continue" }));
  await screen.findByText(/couldn’t add you to the FUTMinna hackathon/);
  expect(joins()).toBe(1);
  joinOk = true;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByText(/couldn’t add you to the FUTMinna hackathon/)).not.toBeInTheDocument());
  expect(joins()).toBe(2);
});
