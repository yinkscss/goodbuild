import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WALLET = "0x7a3000000000000000000000000000000000e41c";
const auth = {
  user: { wallet: WALLET },
  wallet: { address: WALLET, chainId: 11142220, kind: "external" } as { address: string; chainId: number; kind: string } | null,
  switchChain: vi.fn(),
  getWalletClient: vi.fn(async () => ({})),
};
vi.mock("@/lib/auth/context", () => ({ useAuth: () => auth }));
const runExit = vi.fn();
vi.mock("@/lib/deploy/withdraw", async (original) => ({ ...(await original<typeof import("@/lib/deploy/withdraw")>()), runExit: (...a: unknown[]) => runExit(...a) }));

import { OldFundsCard } from "./old-funds-card";

const ADDRESS = "0x3333333333333333333333333333333333333333";
const WITHDRAW = { name: "withdraw", input: "none", abi: { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [], outputs: [] } };
const old = (exits: unknown[]) => ({ name: "TipJar", address: ADDRESS, gdBalance: "1200500000000000000000", exits });
const serve = (...lists: unknown[][]) => {
  const fetcher = vi.fn();
  for (const contracts of lists) fetcher.mockResolvedValueOnce(Response.json({ contracts }));
  vi.stubGlobal("fetch", fetcher);
};
const card = (onAsk = vi.fn()) => render(<OldFundsCard projectId="p1" chainId={11142220} refreshKey={1} busy={false} onAsk={onAsk} />);

beforeEach(() => {
  runExit.mockReset();
  auth.wallet = { address: WALLET, chainId: 11142220, kind: "external" };
});
afterEach(() => vi.unstubAllGlobals());

describe("OldFundsCard", () => {
  it("stays out of the way when no old contract holds funds", async () => {
    serve([]);
    const { container } = card();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("is calm and clear, and moves funds with the contract's own function", async () => {
    serve([old([WITHDRAW])], []);
    runExit.mockResolvedValue("0xhash");
    card();
    expect(await screen.findByText(/still holds funds/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is lost/)).toBeInTheDocument();
    expect(screen.getByText(/1,200.5 G\$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Move funds out" }));
    expect(await screen.findByRole("link", { name: "See the transaction" })).toBeInTheDocument();
    expect(runExit).toHaveBeenCalledWith(expect.objectContaining({ contract: ADDRESS, account: WALLET }));
    await waitFor(() => expect(screen.queryByText(/still holds funds/)).not.toBeInTheDocument());
  });

  it("says plainly when a refusal moved nothing", async () => {
    serve([old([WITHDRAW])]);
    runExit.mockRejectedValue(new Error("execution reverted"));
    card();
    await userEvent.click(await screen.findByRole("button", { name: "Move funds out" }));
    expect(await screen.findByText(/nothing moved/)).toBeInTheDocument();
  });

  it("is honest when there's no way out, and offers to fix the next version", async () => {
    serve([old([])]);
    const onAsk = vi.fn();
    card(onAsk);
    expect(await screen.findByText(/neither you nor GoodBuild can move these funds/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move funds out" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /next version has a way out/ }));
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("withdraw"));
  });

  it("asks for a wallet instead of failing", async () => {
    serve([old([WITHDRAW])]);
    auth.wallet = null;
    card();
    await userEvent.click(await screen.findByRole("button", { name: "Move funds out" }));
    expect(await screen.findByText(/Connect your wallet/)).toBeInTheDocument();
    expect(runExit).not.toHaveBeenCalled();
  });
});
