import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/context", () => ({ useAuth: () => ({ user: { wallet: "0x7a3000000000000000000000000000000000e41c" }, getWalletClient: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { FreeCreditsCard, type FreeStatusJson } from "./free-credits-card";

const base: FreeStatusJson = { policy: "verified", verified: false, welcomeDone: false, welcomeCredits: 100, refillCredits: 10, refill: null, budgetFull: false };
const today = new Date().toISOString().slice(0, 10);

/** Answers each API the card calls, and records the calls. */
function api(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (url: string) => (routes[url] ?? (() => new Response(null, { status: 404 })))());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("FreeCreditsCard", () => {
  it("asks an unverified person to verify for 100 credits, after checking quietly that they aren't already", async () => {
    const calls = api({ "/api/credits/free": () => Response.json(base), "/api/account/goodid": () => Response.json({ verified: false, welcomeMicro: 0 }) });
    render(<FreeCreditsCard />);
    expect(await screen.findByText("Get 100 free credits")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /verify with gooddollar/i })).toBeEnabled();
    await waitFor(() => expect(calls).toHaveBeenCalledWith("/api/account/goodid", expect.objectContaining({ method: "POST" })));
  });

  it("finds a wallet that was already verified and says the credits were added", async () => {
    let verified = false;
    api({
      "/api/credits/free": () => Response.json(verified ? { ...base, verified: true, welcomeDone: true, refill: { state: "available", leftThisWeek: 5, leftThisMonth: 5, nextAt: null, claimedDays: [] } } : base),
      "/api/account/goodid": () => {
        verified = true;
        return Response.json({ verified: true, welcomeMicro: 1_000_000 });
      },
    });
    const onChange = vi.fn();
    render(<FreeCreditsCard onChange={onChange} />);
    expect(await screen.findByText(/already verified with GoodDollar\. 100 free credits added/)).toBeInTheDocument();
    expect(screen.getByText("Daily refill")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
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
