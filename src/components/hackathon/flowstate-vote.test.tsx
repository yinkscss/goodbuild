import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import { FlowstateVote } from "./flowstate-vote";
import {
  FLOWSTATE_COUNCIL,
  GOODBUILDIT_RECIPIENT,
} from "@/lib/flowstate/config";
const wallet = "0x1111111111111111111111111111111111111111";
const hash = "0x" + "a".repeat(64);
const status = {
  verified: true,
  registered: true,
  votingPower: "10",
  allocated: "0",
  available: "10",
  support: "0",
  spreadFull: false,
};
const review = {
  ...status,
  additional: "10",
  after: "10",
  gas: "100000",
  maxFeePerGas: "2000000000",
  maxPriorityFeePerGas: "1000000000",
  feeCapWei: "200000000000000",
};
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
function setup() {
  const client = {
    getAddresses: vi.fn(async () => [wallet]),
    signMessage: vi.fn(),
    writeContract: vi.fn(async () => hash),
  };
  const onConfirmed = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      let data = status;
      if (body?.action === "prepare") data = review;
      if (body?.action === "confirm") data = { ...status, support: "10" };
      return new Response(JSON.stringify(data));
    }),
  );
  render(
    <AuthContextProvider
      value={{
        ...unconfiguredAuth,
        user: { id: "u", wallet, walletKind: "embedded", verified: true },
        switchChain: vi.fn(),
        getWalletClient: vi.fn(async () => client as never),
      }}
    >
      <FlowstateVote onConfirmed={onConfirmed} />
    </AuthContextProvider>,
  );
  return { client, onConfirmed };
}
it("votes with one tap: Celo first, then all available points priced by the server, then confirms", async () => {
  const { client, onConfirmed } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Vote here with your wallet" }));
  await screen.findByText("✓ Thank you for voting!");
  // No slider, no amounts to choose.
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  const prepares = vi.mocked(fetch).mock.calls
    .map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null))
    .filter((b) => b?.action === "prepare");
  expect(prepares).toEqual([{ action: "prepare", additional: "10" }]);
  expect(client.writeContract).toHaveBeenCalledWith(
    expect.objectContaining({
      address: FLOWSTATE_COUNCIL,
      functionName: "vote",
      args: [[{ recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(10) }]],
      gas: BigInt(100000),
    }),
  );
  expect(client.signMessage).not.toHaveBeenCalled();
  expect(onConfirmed).toHaveBeenCalledOnce();
});
it("recovers from a persisted reverted transaction without marking a vote confirmed", async () => {
  localStorage.setItem(`gb:flowstate:pending:${wallet}`, hash);
  const { client, onConfirmed } = setup();
  const fetcher = vi.fn(async (_url, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    return body?.action === "confirm"
      ? new Response(
          JSON.stringify({
            message: "The vote reverted. Refresh and try again.",
          }),
          { status: 410 },
        )
      : new Response(JSON.stringify(status));
  });
  vi.stubGlobal("fetch", fetcher);
  await userEvent.click(
    screen.getByRole("button", { name: "Vote here with your wallet" }),
  );
  await screen.findByText(/The vote reverted/);
  expect(localStorage.getItem(`gb:flowstate:pending:${wallet}`)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Check confirmation" }),
  ).not.toBeInTheDocument();
  expect(client.writeContract).not.toHaveBeenCalled();
  expect(onConfirmed).not.toHaveBeenCalled();
});
it("turns voting on and then votes, all from one tap", async () => {
  const client = {
    getAddresses: vi.fn(async () => [wallet]),
    signMessage: vi.fn(async () => "0x" + "a".repeat(130)),
    writeContract: vi.fn(async () => hash),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.action === "eligibility") return new Response(JSON.stringify(status));
      if (body?.action === "prepare") return new Response(JSON.stringify(review));
      if (body?.action === "confirm") return new Response(JSON.stringify({ ...status, support: "10" }));
      return new Response(JSON.stringify({ ...status, registered: false, votingPower: "0", available: "0" }));
    }),
  );
  render(
    <AuthContextProvider
      value={{
        ...unconfiguredAuth,
        user: { id: "u", wallet, walletKind: "embedded", verified: true },
        switchChain: vi.fn(),
        getWalletClient: vi.fn(async () => client as never),
      }}
    >
      <FlowstateVote />
    </AuthContextProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Vote here with your wallet" }));
  await screen.findByText("✓ Thank you for voting!");
  expect(client.signMessage).toHaveBeenCalledOnce();
  expect(client.writeContract).toHaveBeenCalledOnce();
});
it("sends someone who isn't verified to the verify step, without touching the wallet", async () => {
  const client = { getAddresses: vi.fn(async () => [wallet]), signMessage: vi.fn(), writeContract: vi.fn() };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...status, verified: false, registered: false, available: "0" }))));
  render(
    <AuthContextProvider
      value={{ ...unconfiguredAuth, user: { id: "u", wallet, walletKind: "embedded", verified: false }, switchChain: vi.fn(), getWalletClient: vi.fn(async () => client as never) }}
    >
      <FlowstateVote verifyHref="/r/ABCD2345" />
    </AuthContextProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Vote here with your wallet" }));
  const link = await screen.findByRole("link", { name: "Verify with GoodDollar first" });
  expect(link).toHaveAttribute("href", "/r/ABCD2345");
  expect(client.signMessage).not.toHaveBeenCalled();
  expect(client.writeContract).not.toHaveBeenCalled();
});
it("never asks someone who already voted to vote again: it confirms the vote on opening", async () => {
  const client = { getAddresses: vi.fn(async () => [wallet]), signMessage: vi.fn(), writeContract: vi.fn() };
  const fetcher = vi.fn(async (_url, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(JSON.stringify(body?.action === "existing" ? { ...status, support: "10", hash: null } : { ...status, support: "10" }));
  });
  vi.stubGlobal("fetch", fetcher);
  const onConfirmed = vi.fn();
  render(
    <AuthContextProvider
      value={{
        ...unconfiguredAuth,
        user: { id: "u", wallet, walletKind: "embedded", verified: true },
        switchChain: vi.fn(),
        getWalletClient: vi.fn(async () => client as never),
      }}
    >
      <FlowstateVote onConfirmed={onConfirmed} />
    </AuthContextProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Vote here with your wallet" }));
  await screen.findByText("✓ Thank you for voting!");
  expect(client.writeContract).not.toHaveBeenCalled();
  expect(onConfirmed).toHaveBeenCalledOnce();
});

it("lets a voter give the remaining points with one more tap after an earlier partial vote", async () => {
  const { client } = setup();
  const remaining = { ...status, allocated: "1", available: "9", support: "1" };
  vi.stubGlobal("fetch", vi.fn(async (_url, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body?.action === "existing") return new Response(JSON.stringify(remaining));
    if (body?.action === "prepare") return new Response(JSON.stringify({ ...review, ...remaining, additional: body.additional, after: "10" }));
    if (body?.action === "confirm") return new Response(JSON.stringify({ ...remaining, available: "0", support: "10" }));
    return new Response(JSON.stringify(remaining));
  }));
  await userEvent.click(screen.getByRole("button", { name: "Vote here with your wallet" }));
  await userEvent.click(await screen.findByRole("button", { name: "Vote my remaining points" }));
  await waitFor(() => expect(client.writeContract).toHaveBeenCalledTimes(1));
  expect(client.writeContract).toHaveBeenLastCalledWith(expect.objectContaining({
    args: [[{ recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(10) }]],
  }));
  await screen.findByText("You have no votes left right now.");
});

it("hides the ballot until existing support has finished checking", async () => {
  setup();
  let resolveExisting!: (value: Response) => void;
  const existing = new Promise<Response>((resolve) => { resolveExisting = resolve; });
  const fetcher = vi.fn(async (_url, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body?.action === "existing") return existing;
    return new Response(JSON.stringify({ ...status, available: "9", support: "1" }));
  });
  vi.stubGlobal("fetch", fetcher);
  await userEvent.click(screen.getByRole("button", { name: "Vote here with your wallet" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("button", { name: "Vote my remaining points" })).not.toBeInTheDocument();
  resolveExisting(new Response(JSON.stringify({ ...status, available: "9", support: "1" })));
  await screen.findByText("✓ Thank you for voting!");
});
