import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import type { AuthApi } from "@/lib/auth/types";
import { PENDING_PROMPT_KEY } from "@/lib/pending-prompt";
import { SendGateProvider, useSendGate } from "./send-gate";
import { WalletButton } from "./wallet-button";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function makeAuth(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    ...unconfiguredAuth,
    configured: true,
    ready: true,
    sendEmailCode: vi.fn(async () => {}),
    verifyEmailCode: vi.fn(async () => {}),
    connectWallet: vi.fn(async () => {}),
    signInWithConnectedWallet: vi.fn(async () => {}),
    reset: vi.fn(),
    signOut: vi.fn(async () => {}),
    switchChain: vi.fn(async () => {}),
    ...overrides,
  };
}

function SendButton() {
  const { send } = useSendGate();
  return (
    <button onClick={() => send({ prompt: "A tip jar", templateId: "tip-jar", network: "celo-sepolia", attachment: null })}>
      send
    </button>
  );
}

function Harness({ auth }: { auth: AuthApi }) {
  return (
    <AuthContextProvider value={auth}>
      <SendGateProvider>
        <SendButton />
        <WalletButton />
      </SendGateProvider>
    </AuthContextProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  push.mockReset();
  vi.unstubAllGlobals();
});

describe("prompt gating", () => {
  it("shows the prompt at once while sending, and a repeat Send doesn't create a second project", async () => {
    let finish: (r: Response) => void = () => undefined;
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() => new Promise((r) => (finish = r)));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness auth={makeAuth({ user: { id: "u1", wallet: "0xabc", walletKind: "external" } as never })} />);
    await userEvent.click(screen.getByText("send"));
    expect(await screen.findByText(/Getting started/)).toBeInTheDocument();
    expect(screen.getByText("A tip jar")).toBeInTheDocument();
    await userEvent.click(screen.getByText("send"));
    expect(fetchMock.mock.calls.filter(([u]) => String(u) === "/api/projects")).toHaveLength(1);
    finish(new Response(JSON.stringify({ id: "p1", name: "Tip" }), { status: 201 }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/p/p1"));
    await vi.waitFor(() => expect(screen.queryByText(/Getting started/)).not.toBeInTheDocument());
  });

  it("logged-out Send saves the prompt and opens the connect modal", async () => {
    render(<Harness auth={makeAuth()} />);
    await userEvent.click(screen.getByText("send"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/your prompt is saved/i)).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(PENDING_PROMPT_KEY)!).prompt).toBe("A tip jar");
  });

  it("after sign-in it creates the project with the saved prompt and routes to it", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "p-123", name: "Community tip jar" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<Harness auth={makeAuth()} />);
    await userEvent.click(screen.getByText("send"));

    const signedIn = makeAuth({
      user: { id: "u1", wallet: "0x7a30000000000000000000000000000000e41c", walletKind: "embedded", verified: false },
      wallet: { address: "0x7a30000000000000000000000000000000e41c", chainId: 11142220, kind: "embedded", label: "Email wallet" },
    });
    rerender(<Harness auth={signedIn} />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/p/p-123"));
    // The wallet menu also asks /api/mainnet whether the switch is open for this viewer; that isn't the call under test.
    const created = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).find(([u]) => String(u) === "/api/projects")!;
    const init = created[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ prompt: "A tip jar", templateId: "tip-jar" });
    expect(sessionStorage.getItem(PENDING_PROMPT_KEY)).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("signed-in Send goes straight through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "p-9", name: "x" }, { status: 201 })));
    render(
      <Harness
        auth={makeAuth({
          user: { id: "u1", wallet: "0xabc", walletKind: "external", verified: false },
          wallet: { address: "0xabc0000000000000000000000000000000000001", chainId: 11142220, kind: "external", label: "MetaMask" },
        })}
      />,
    );
    await userEvent.click(screen.getByText("send"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/p/p-9"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("connect modal", () => {
  async function openModal(auth: AuthApi) {
    render(<Harness auth={auth} />);
    await userEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    return screen.findByRole("dialog");
  }

  it("requires the 18+ / not-US attestation before connecting a wallet", async () => {
    const auth = makeAuth({ detected: { metamask: true } });
    await openModal(auth);
    expect(screen.getByText("Detected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /metamask/i }));
    expect(auth.connectWallet).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/18 or older/);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /metamask/i }));
    expect(auth.connectWallet).toHaveBeenCalledWith("metamask", { ageOk: true, notUsPerson: true });
  });

  it("offers OKX Wallet, marks it detected, and connects it with the attestation (D92)", async () => {
    const auth = makeAuth({ detected: { okx: true } });
    await openModal(auth);
    const okx = screen.getByRole("button", { name: /okx wallet/i });
    expect(okx).toHaveTextContent("Extension or OKX app browser");
    expect(okx).toHaveTextContent("Detected");
    // Only OKX is detected here, so the other rows show no chip.
    expect(screen.getAllByText("Detected")).toHaveLength(1);
    await userEvent.click(okx);
    expect(auth.connectWallet).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/18 or older/);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /okx wallet/i }));
    expect(auth.connectWallet).toHaveBeenCalledWith("okx", { ageOk: true, notUsPerson: true });
  });

  it("validates the email and sends the code", async () => {
    const auth = makeAuth();
    await openModal(auth);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText(/email address/i), "ada@lagos");
    await userEvent.click(screen.getByRole("button", { name: /continue with email/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid email/);
    await userEvent.type(screen.getByLabelText(/email address/i), "builders.xyz");
    await userEvent.click(screen.getByRole("button", { name: /continue with email/i }));
    expect(auth.sendEmailCode).toHaveBeenCalledWith("ada@lagosbuilders.xyz");
  });

  it("verifies a 6-digit code with the attestation", async () => {
    const auth = makeAuth({ phase: "awaiting-code" });
    await openModal(auth);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText(/6-digit code/i), "12a3456");
    await userEvent.click(screen.getByRole("button", { name: /verify code/i }));
    expect(auth.verifyEmailCode).toHaveBeenCalledWith("123456", { ageOk: true, notUsPerson: true });
  });

  it("explains when sign-in isn't configured", async () => {
    await openModal({ ...unconfiguredAuth });
    expect(screen.getByText(/isn't set up on this deployment/i)).toBeInTheDocument();
  });
});

describe("wallet button", () => {
  const user = { id: "u1", wallet: "0x7a3", walletKind: "external" as const, verified: false };
  const wallet = { address: "0x7a30000000000000000000000000000000e41c" as const, kind: "external" as const, label: "MetaMask" };

  it("shows Check your wallet while connecting", () => {
    render(<Harness auth={makeAuth({ phase: "connecting" })} />);
    expect(screen.getByRole("button", { name: /check your wallet/i })).toBeDisabled();
  });

  it("shows the address and network when connected", () => {
    render(<Harness auth={makeAuth({ user, wallet: { ...wallet, chainId: 42220 } })} />);
    expect(screen.getByText("0x7a3…e41c")).toBeInTheDocument();
    expect(screen.getByText("Celo")).toBeInTheDocument();
  });

  it("still shows the signed-in account when the browser wallet is disconnected", () => {
    render(<Harness auth={makeAuth({ user: { ...user, wallet: wallet.address }, wallet: null })} />);
    expect(screen.getByText("0x7a3…e41c")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect wallet/i })).not.toBeInTheDocument();
  });

  it("shows Switch to Celo on the wrong network and switches", async () => {
    const auth = makeAuth({ user, wallet: { ...wallet, chainId: 1 } });
    render(<Harness auth={auth} />);
    await userEvent.click(screen.getByRole("button", { name: /switch to celo/i }));
    expect(auth.switchChain).toHaveBeenCalledWith(42220);
  });
});

void React;
