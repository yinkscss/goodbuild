import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WALLET = "0x7a3000000000000000000000000000000000e41c";
const signMessage = vi.fn(async () => "0xsig");
const auth = {
  user: { wallet: WALLET },
  getWalletClient: vi.fn(async () => ({ getAddresses: async () => [WALLET], signMessage })),
};
vi.mock("@/lib/auth/context", () => ({ useAuth: () => auth }));

import { VerifyCard } from "./verify-card";

const respond = (verified: boolean) => vi.fn(async () => Response.json({ verified }));

beforeEach(() => {
  signMessage.mockClear();
  window.history.replaceState(null, "", "/p/1");
});
afterEach(() => vi.unstubAllGlobals());

describe("VerifyCard", () => {
  it("skips signing for a wallet GoodDollar already knows", async () => {
    vi.stubGlobal("fetch", respond(true));
    const onVerified = vi.fn();
    render(<VerifyCard onVerified={onVerified} />);
    await userEvent.click(screen.getByRole("button", { name: /verify with gooddollar/i }));
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("won't sign from a different wallet than the signed-in one", async () => {
    vi.stubGlobal("fetch", respond(false));
    auth.getWalletClient.mockResolvedValueOnce({ getAddresses: async () => ["0x0000000000000000000000000000000000000001"], signMessage });
    render(<VerifyCard onVerified={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /verify with gooddollar/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/wallet you signed in with/i);
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("explains a failed check on return and clears it from the address", async () => {
    vi.stubGlobal("fetch", respond(false));
    window.history.replaceState(null, "", "/p/1?isVerified=false&reason=Twin");
    render(<VerifyCard onVerified={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Twin.*link this one/);
    expect(window.location.search).toBe("");
  });

  it("confirms a successful return on-chain instead of believing the address", async () => {
    const fetcher = respond(true);
    vi.stubGlobal("fetch", fetcher);
    window.history.replaceState(null, "", "/p/1?isVerified=true");
    const onVerified = vi.fn();
    render(<VerifyCard onVerified={onVerified} />);
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(fetcher).toHaveBeenCalledWith("/api/account/goodid", { method: "POST" });
  });
});
