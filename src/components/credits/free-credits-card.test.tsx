import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/context", () => ({ useAuth: () => ({ user: { wallet: "0x7a3000000000000000000000000000000000e41c" }, getWalletClient: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const claimUbi = vi.fn(async () => undefined);
// The vote dialog has its own tests; here a button stands in that reports a confirmed vote.
vi.mock("@/components/hackathon/flowstate-vote", () => ({
  FlowstateVote: ({ onConfirmed }: { onConfirmed?: () => void }) => (
    <button type="button" onClick={() => onConfirmed?.()}>
      Vote here with your wallet
    </button>
  ),
}));
vi.mock("./use-claim-ubi", () => ({ useClaimUbi: () => claimUbi, UbiClaimError: class extends Error {} }));

import { FreeCreditsCard, type FreeStatusJson } from "./free-credits-card";

const base: FreeStatusJson = { policy: "verified", verified: false, welcomeDone: false, welcomeCredits: 40, refillCredits: 10, refill: null, budgetFull: false, refillNeedsUbi: false, ubiClaimedToday: null, refillBlocked: null, refillBelowCredits: 10 };
const today = new Date(Date.now() - 12 * 3_600_000).toISOString().slice(0, 10);

/** Answers each API the card calls, and records the calls. */
function api(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (url: string) => (routes[url] ?? (() => new Response(null, { status: 404 })))());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("FreeCreditsCard", () => {
  it("asks an unverified person to verify for 40 credits, after checking quietly that they aren't already", async () => {
    const calls = api({ "/api/credits/free": () => Response.json(base), "/api/account/goodid": () => Response.json({ verified: false, welcomeMicro: 0 }) });
    render(<FreeCreditsCard />);
    expect(await screen.findByText("Get 40 free credits")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /verify with gooddollar/i })).toBeEnabled();
    await waitFor(() => expect(calls).toHaveBeenCalledWith("/api/account/goodid", expect.objectContaining({ method: "POST" })));
  });

  it("finds a wallet that was already verified and says the credits were added", async () => {
    let verified = false;
    api({
      "/api/credits/free": () => Response.json(verified ? { ...base, verified: true, welcomeDone: true, refill: { state: "available", leftThisWeek: 5, leftThisMonth: 5, nextAt: null, claimedDays: [] } } : base),
      "/api/account/goodid": () => {
        verified = true;
        return Response.json({ verified: true, welcomeMicro: 400_000 });
      },
    });
    const onChange = vi.fn();
    render(<FreeCreditsCard onChange={onChange} />);
    expect(await screen.findByText(/already verified with GoodDollar\. 40 free credits added/)).toBeInTheDocument();
    expect(screen.getByText("Daily refill")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });

  it("asks a verified person who hasn't voted to vote here, then adds the welcome credits (D125)", async () => {
    let voted = false;
    let welcomed = false;
    api({
      "/api/credits/free": () => Response.json({ ...base, verified: true, welcomeDone: welcomed, welcomeNeedsVote: true, refill: { state: "available", leftThisWeek: 5, leftThisMonth: 5, nextAt: null, claimedDays: [] } }),
      "/api/account/goodid": () => {
        // Before the vote the quiet check finds none; after it, the welcome is posted.
        if (!voted) return Response.json({ verified: true, welcomeMicro: 0, needsVote: true, welcomeError: "Vote first." });
        welcomed = true;
        return Response.json({ verified: true, welcomeMicro: 400_000 });
      },
    });
    render(<FreeCreditsCard compact />);
    expect(await screen.findByText("Unlock 40 free credits")).toBeInTheDocument();
    voted = true;
    await userEvent.click(screen.getByRole("button", { name: /vote here/i }));
    expect(await screen.findByText(/Thank you for voting! 40 free credits added/)).toBeInTheDocument();
  });

  it("claims a refill and shows it in the month meter", async () => {
    let claimed = false;
    const status = () => ({ ...base, verified: true, welcomeDone: true, refill: claimed ? { state: "claimed_today", leftThisWeek: 4, leftThisMonth: 4, nextAt: null, claimedDays: [today] } : { state: "available", leftThisWeek: 5, leftThisMonth: 5, nextAt: null, claimedDays: [] } });
    api({
      "/api/credits/free": () => Response.json(status()),
      "/api/credits/free/refill": () => {
        claimed = true;
        return Response.json({ grantedMicro: 100_000 });
      },
    });
    render(<FreeCreditsCard />);
    await userEvent.click(await screen.findByRole("button", { name: "Claim 10 credits" }));
    expect(await screen.findByText("Added 10 credits.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claimed today" })).toBeDisabled();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByLabelText("Refills claimed this month: 1 of 5")).toBeInTheDocument();
  });

  it("claims today's G$ UBI in the wallet first when the refill needs it, then the credits", async () => {
    claimUbi.mockClear();
    let claimed = false;
    const calls = api({
      "/api/credits/free": () => Response.json({ ...base, verified: true, welcomeDone: true, refillNeedsUbi: true, ubiClaimedToday: claimed, refill: { state: claimed ? "claimed_today" : "available", leftThisWeek: 5, leftThisMonth: 5, nextAt: null, claimedDays: claimed ? [today] : [] } }),
      "/api/credits/free/refill": () => {
        claimed = true;
        return Response.json({ grantedMicro: 100_000 });
      },
    });
    render(<FreeCreditsCard />);
    expect(await screen.findByText(/Claim today's G\$ UBI from GoodDollar to unlock it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Claim G$ + 10 credits" }));
    expect(await screen.findByText("Added 10 credits.")).toBeInTheDocument();
    expect(claimUbi).toHaveBeenCalledTimes(1);
    expect(calls).toHaveBeenCalledWith("/api/credits/free/refill", expect.objectContaining({ method: "POST" }));
  });

  it("doesn't ask the wallet again when today's G$ is already claimed", async () => {
    claimUbi.mockClear();
    api({
      "/api/credits/free": () => Response.json({ ...base, verified: true, welcomeDone: true, refillNeedsUbi: true, ubiClaimedToday: true, refill: { state: "available", leftThisWeek: 5, leftThisMonth: 5, nextAt: null, claimedDays: [] } }),
      "/api/credits/free/refill": () => Response.json({ grantedMicro: 100_000 }),
    });
    render(<FreeCreditsCard />);
    await userEvent.click(await screen.findByRole("button", { name: "Claim 10 credits" }));
    expect(await screen.findByText("Added 10 credits.")).toBeInTheDocument();
    expect(claimUbi).not.toHaveBeenCalled();
  });

  it("says why a refill is blocked, and never asks the wallet", async () => {
    claimUbi.mockClear();
    api({ "/api/credits/free": () => Response.json({ ...base, verified: true, welcomeDone: true, refillNeedsUbi: true, ubiClaimedToday: null, refillBlocked: "not_low", refill: { state: "available", leftThisWeek: 5, leftThisMonth: 5, nextAt: null, claimedDays: [] } }) });
    render(<FreeCreditsCard />);
    expect(await screen.findByText(/once you have under 10 credits/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not yet" })).toBeDisabled();
    expect(claimUbi).not.toHaveBeenCalled();
  });

  it("explains a refused claim", async () => {
    api({
      "/api/credits/free": () => Response.json({ ...base, verified: true, welcomeDone: true, refill: { state: "available", leftThisWeek: 5, leftThisMonth: 5, nextAt: null, claimedDays: [] } }),
      "/api/credits/free/refill": () => Response.json({ error: "expired", message: "Your GoodDollar verification has expired. Verify again to keep getting refills." }, { status: 403 }),
    });
    render(<FreeCreditsCard />);
    await userEvent.click(await screen.findByRole("button", { name: "Claim 10 credits" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/);
  });

  it("stays out of the workspace when there's nothing to claim, and under the old rules", async () => {
    api({ "/api/credits/free": () => Response.json({ ...base, verified: true, welcomeDone: true, refill: { state: "month_full", leftThisWeek: 0, leftThisMonth: 0, nextAt: "2026-12-01T00:00:00.000Z", claimedDays: [] } }) });
    const { container, unmount } = render(<FreeCreditsCard compact />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();
    api({ "/api/credits/free": () => Response.json({ ...base, policy: "legacy" }) });
    const legacy = render(<FreeCreditsCard />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(legacy.container).toBeEmptyDOMElement();
  });
});

describe("FreeCreditsCard, someone who already voted elsewhere", () => {
  it("checks the vote quietly on opening and adds the 40 without asking them to vote", async () => {
    let welcomed = false;
    const calls = api({
      "/api/credits/free": () => Response.json({ ...base, verified: true, welcomeDone: welcomed, welcomeNeedsVote: true, refill: { state: "available", leftThisWeek: 5, leftThisMonth: 5, nextAt: null, claimedDays: [] } }),
      "/api/account/goodid": () => {
        welcomed = true;
        return Response.json({ verified: true, welcomeMicro: 400_000 });
      },
    });
    render(<FreeCreditsCard />);
    expect(await screen.findByText(/Thank you for voting! 40 free credits added/)).toBeInTheDocument();
    expect(calls).toHaveBeenCalledWith("/api/account/goodid", expect.objectContaining({ method: "POST" }));
  });
});
