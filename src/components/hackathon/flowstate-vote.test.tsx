import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
it("votes with one button: Celo first, then the server's priced vote, then confirms it", async () => {
  const { client, onConfirmed } = setup();
  await userEvent.click(
    screen.getByRole("button", { name: "Vote here with your wallet" }),
  );
  const slider = await screen.findByRole("slider", {
    name: "Votes for GoodBuildIt",
  });
  expect(slider).toHaveValue("10");
  expect(client.writeContract).not.toHaveBeenCalled();
  // The fee table, explanations and contract details are gone.
  expect(screen.queryByText(/Network fee cap/)).not.toBeInTheDocument();
  expect(screen.queryByText("Voting details")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Vote 10 points" }));
  await screen.findByText("✓ Thank you for voting!");
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
it("sends what the slider says", async () => {
  const { client } = setup();
  await userEvent.click(
    screen.getByRole("button", { name: "Vote here with your wallet" }),
  );
  const slider = await screen.findByRole("slider", { name: "Votes for GoodBuildIt" });
  fireEvent.change(slider, { target: { value: "4" } });
  await userEvent.click(screen.getByRole("button", { name: "Vote 4 points" }));
  await screen.findByText("✓ Thank you for voting!");
  const prepares = vi.mocked(fetch).mock.calls
    .map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null))
    .filter((b) => b?.action === "prepare");
  expect(prepares).toEqual([{ action: "prepare", additional: "4" }]);
  expect(client.writeContract).toHaveBeenCalledOnce();
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
it("selects ten points after a verified wallet enables its community voting rights", async () => {
  const client = {
    getAddresses: vi.fn(async () => [wallet]),
    signMessage: vi.fn(async () => "0x" + "a".repeat(130)),
    writeContract: vi.fn(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.body
              ? status
              : {
                  ...status,
                  registered: false,
                  votingPower: "0",
                  available: "0",
                },
          ),
        ),
    ),
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
  await userEvent.click(
    screen.getByRole("button", { name: "Vote here with your wallet" }),
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Enable voting with this wallet",
    }),
  );
  expect(
    await screen.findByRole("slider", {
      name: "Votes for GoodBuildIt",
    }),
  ).toHaveValue("10");
  expect(client.signMessage).toHaveBeenCalledOnce();
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
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  expect(client.writeContract).not.toHaveBeenCalled();
  expect(onConfirmed).toHaveBeenCalledOnce();
});

it("lets a voter spend the remaining nine points after a one-point vote in the same dialog", async () => {
  const { client } = setup();
  const remaining = { ...status, allocated: "1", available: "9", support: "1" };
  let voted = false;
  vi.stubGlobal("fetch", vi.fn(async (_url, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const current = voted ? remaining : status;
    const data = body?.action === "prepare"
      ? { ...review, ...current, additional: body.additional, after: String(Number(current.support) + Number(body.additional)) }
      : body?.action === "confirm" ? remaining : current;
    if (body?.action === "confirm") voted = true;
    return new Response(JSON.stringify(data));
  }));
  await userEvent.click(screen.getByRole("button", { name: "Vote here with your wallet" }));
  fireEvent.change(await screen.findByRole("slider"), { target: { value: "1" } });
  await userEvent.click(screen.getByRole("button", { name: "Vote 1 point" }));
  await screen.findByText("✓ Thank you for voting!");
  await userEvent.click(screen.getByRole("button", { name: "Check for new eligibility to vote again" }));
  const slider = await screen.findByRole("slider");
  expect(slider).toHaveValue("9");
  expect(slider).toHaveAttribute("max", "9");
  await userEvent.click(screen.getByRole("button", { name: "Vote 9 points" }));
  await waitFor(() => expect(client.writeContract).toHaveBeenCalledTimes(2));
  expect(client.writeContract).toHaveBeenLastCalledWith(expect.objectContaining({
    args: [[{ recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(10) }]],
  }));
  await screen.findByText("✓ Thank you for voting!");
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
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Vote 9 points" })).not.toBeInTheDocument();
  resolveExisting(new Response(JSON.stringify({ ...status, available: "9", support: "1" })));
  await screen.findByText("✓ Thank you for voting!");
});
