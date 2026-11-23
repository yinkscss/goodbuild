import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const WALLET = "0x00000000000000000000000000000000000000aa";
const signMessage = vi.fn(async () => "0xsig");
const getWalletClient = vi.fn(async () => ({ getAddresses: async () => [WALLET], signMessage }));
vi.mock("@/lib/auth/context", () => ({ useAuth: () => ({ user: { wallet: WALLET }, getWalletClient }) }));
vi.mock("@/lib/goodid", () => ({ faceVerificationMessage: () => "msg", faceVerificationLink: () => "https://goodid.example/verify" }));

import { useGoodIdVerify } from "./use-goodid-verify";

beforeEach(() => {
  sessionStorage.clear();
  // The account endpoint trusts a saved verifiedAt, so it says verified even when the live Celo read doesn't.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ verified: true }), { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("starts the face check when the vote status disagrees with the saved verified flag", async () => {
  const onVerified = vi.fn();
  const { result } = renderHook(() => useGoodIdVerify(onVerified, undefined, async () => false));
  await act(async () => result.current.verify());
  expect(signMessage).toHaveBeenCalled();
  // It went on to GoodDollar: the attempt is remembered for the trip back.
  expect(sessionStorage.getItem("goodbuild:goodid-pending")).toContain(WALLET);
});

it("stops with a message, not a silent spin, when the live check can't reach Celo", async () => {
  const { result } = renderHook(() =>
    useGoodIdVerify(vi.fn(), undefined, async () => {
      throw new Error("We couldn’t reach Celo to check your verification. Press Verify to try again.");
    }),
  );
  await act(async () => result.current.verify());
  expect(result.current.busy).toBe(false);
  expect(result.current.note).toMatch(/couldn’t reach Celo/);
  expect(signMessage).not.toHaveBeenCalled();
});

it("finishes without a face check when both checks agree the wallet is verified", async () => {
  const { result } = renderHook(() => useGoodIdVerify(vi.fn(), undefined, async () => true));
  await act(async () => result.current.verify());
  expect(result.current.busy).toBe(false);
  expect(signMessage).not.toHaveBeenCalled();
});
