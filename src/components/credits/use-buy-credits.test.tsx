import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), redeem: vi.fn(), save: vi.fn(), forget: vi.fn(), write: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const router = { refresh: mocks.refresh };
vi.mock("viem", () => ({ createPublicClient: () => ({ readContract: async () => BigInt(1000) }), custom: vi.fn(), encodeAbiParameters: () => "0xdata" }));
vi.mock("./pending-payments", () => ({ redeemTx: mocks.redeem, savePending: mocks.save, forgetPending: mocks.forget, retryPending: async () => 0 }));
const wallet = "0x0000000000000000000000000000000000000001";
const auth = { user: { wallet }, wallet: { address: wallet, chainId: 42220 }, getWalletClient: async () => ({ transport: {}, writeContract: mocks.write }) };
vi.mock("@/lib/auth/context", () => ({ useAuth: () => auth }));
import { useBuyCredits } from "./use-buy-credits";
const info = { chainId: 42220, live: true, contract: wallet as `0x${string}`, goodDollar: wallet as `0x${string}` };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.write.mockResolvedValue("0xhash");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ quote: { buyer: wallet, gdAmount: "100", credits: "1000000", bonus: "100000", ref: "0xref", deadline: "123" }, signature: "0xsig" })));
});
afterEach(() => vi.unstubAllGlobals());
it("shows the settled bonus-inclusive payment and refreshes even if another reader credited first", async () => {
  mocks.redeem.mockResolvedValue({ kind: "credited", addedMicro: 1_100_000, balanceMicro: 1_750_000 });
  const { result } = renderHook(() => useBuyCredits(info));
  let ok: unknown;
  await act(async () => { ok = await result.current.buy(1_000_000); });
  expect(ok).toBe(true);
  expect(result.current.phase).toEqual({ name: "done", addedMicro: 1_100_000, balanceMicro: 1_750_000 });
  expect(mocks.save).toHaveBeenCalledWith(42220, "0xhash");
  expect(mocks.forget).toHaveBeenCalledWith("0xhash");
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
it("keeps a sent payment recoverable when checking fails", async () => {
  mocks.redeem.mockResolvedValue({ kind: "failed" });
  const { result } = renderHook(() => useBuyCredits(info));
  await act(async () => { await result.current.buy(1_000_000); });
  expect(result.current.phase).toEqual({ name: "paid", hash: "0xhash" });
  expect(mocks.forget).not.toHaveBeenCalled();
});
it("does not claim nothing was charged if an unexpected error follows submission", async () => {
  mocks.redeem.mockRejectedValue(new Error("unexpected"));
  const { result } = renderHook(() => useBuyCredits(info));
  await act(async () => { await result.current.buy(1_000_000); });
  expect(result.current.phase).toEqual({ name: "paid", hash: "0xhash" });
});
