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
  auth.user.wallet = WALLET;
  window.sessionStorage.clear();
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
    expect(fetcher).toHaveBeenCalledWith("/api/account/goodid", { method: "POST", signal: expect.any(AbortSignal) });
  });

  it("still confirms on return when the address lost its ?isVerified", async () => {
    vi.stubGlobal("fetch", respond(true));
    window.sessionStorage.setItem("goodbuild:goodid-pending", JSON.stringify({ wallet: WALLET.toLowerCase(), at: Date.now(), path: "/p/1" }));
    const onVerified = vi.fn();
    render(<VerifyCard onVerified={onVerified} />);
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(window.sessionStorage.getItem("goodbuild:goodid-pending")).toBeNull();
  });
  it("ignores old, unscoped, and other-wallet verification attempts", async () => {
    const fetcher = respond(false);
    vi.stubGlobal("fetch", fetcher);
    for (const attempt of ["1", JSON.stringify({ wallet: WALLET.toLowerCase(), at: Date.now() - 60 * 60 * 1000, path: "/p/1" }), JSON.stringify({ wallet: "0xother", at: Date.now(), path: "/p/1" })]) {
      window.sessionStorage.setItem("goodbuild:goodid-pending", attempt);
      const view = render(<VerifyCard onVerified={vi.fn()} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetcher).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
      view.unmount();
    }
  });

  it("shares one return check across mounted verification components", async () => {
    const fetcher = respond(true);
    vi.stubGlobal("fetch", fetcher);
    window.history.replaceState(null, "", "/p/1?isVerified=true");
    const first = vi.fn();
    const second = vi.fn();
    render(<><VerifyCard onVerified={first} /><VerifyCard onVerified={second} /></>);
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    expect(second).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports a connection failure instead of claiming verification was unfinished", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "We couldn't reach Celo to check that." }, { status: 503 })));
    window.history.replaceState(null, "", "/p/1?isVerified=true");
    render(<VerifyCard onVerified={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach Celo");
    expect(screen.getByRole("alert")).not.toHaveTextContent("finished verification");
  });

  it("cancels a previous wallet's return without clearing the new wallet's attempt", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    window.history.replaceState(null, "", "/p/1?isVerified=true");
    const notified = vi.fn();
    const view = render(<VerifyCard onVerified={notified} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const signal = (fetcher.mock.calls[0] as unknown as [string, { signal: AbortSignal }])[1].signal;
    auth.user.wallet = "0x0000000000000000000000000000000000000002";
    view.rerender(<VerifyCard onVerified={notified} />);
    await waitFor(() => expect(signal.aborted).toBe(true));
    const next = JSON.stringify({ wallet: auth.user.wallet, at: Date.now(), path: "/p/1" });
    window.sessionStorage.setItem("goodbuild:goodid-pending", next);
    finish(Response.json({ verified: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notified).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("goodbuild:goodid-pending")).toBe(next);
  });

  it("clears obsolete notices in sibling components after verification succeeds", async () => {
    vi.stubGlobal("fetch", respond(true));
    window.history.replaceState(null, "", "/p/1?isVerified=false");
    const first = vi.fn();
    const second = vi.fn();
    render(<><VerifyCard onVerified={first} /><VerifyCard onVerified={second} /></>);
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    await userEvent.click(screen.getAllByRole("button", { name: /verify with gooddollar/i })[0]);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

});
