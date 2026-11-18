import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { describe, expect, it, vi } from "vitest";

import { BASE_USDC, RELAY_APPROVAL_CONTRACTS, canHostSign, checkTopUpPermit, makeTopUpSigner, widgetAtLeast } from "./host-signing";

const NOW = 1_763_400_000;
// A throwaway key, only for these tests.
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const WALLET = account.address;

/** What GoodCash's widget sends (fields as widget.js 0.4.0 passes them: strings, EIP712Domain included). */
function request(over: { domain?: object; message?: object; types?: object; primaryType?: string } = {}) {
  return {
    domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: BASE_USDC, ...over.domain },
    types: over.types ?? {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: over.primaryType ?? "ReceiveWithAuthorization",
    message: {
      from: WALLET.toLowerCase(),
      to: RELAY_APPROVAL_CONTRACTS[0],
      value: "3551428",
      validAfter: "0",
      validBefore: String(NOW + 30 * 60),
      nonce: `0x${"ab".repeat(32)}`,
      ...over.message,
    },
  };
}
const ctx = (over: object = {}) => ({ orderId: "tu_0123456789abcdef01234567", maxUsdc: "3551428", wallet: WALLET, ...over });
const check = (typedData: unknown, context: unknown = ctx(), signer: string = WALLET) => checkTopUpPermit({ typedData, context, wallet: WALLET, signer, now: NOW });
const reason = (r: ReturnType<typeof check>) => (r.ok ? null : r.reason);

describe("top-up permit check (D120)", () => {
  it("accepts the permit GoodCash sends, for both Relay contracts and up to the order's maximum", () => {
    expect(check(request()).ok).toBe(true);
    expect(check(request({ message: { to: RELAY_APPROVAL_CONTRACTS[1].toUpperCase().replace("0X", "0x") } })).ok).toBe(true);
    expect(check(request({ message: { value: "1" } })).ok).toBe(true);
    expect(check(request(), ctx({ maxUsdc: 3551428 })).ok).toBe(true);
  });

  it("refuses an amount above the order's maximum, and a request with no maximum or order", () => {
    expect(reason(check(request({ message: { value: "3551429" } })))).toMatch(/above/);
    expect(reason(check(request(), ctx({ maxUsdc: undefined })))).toMatch(/limit is missing/);
    expect(reason(check(request(), ctx({ maxUsdc: "0" })))).toMatch(/limit is missing/);
    expect(reason(check(request(), ctx({ maxUsdc: "1e6" })))).toMatch(/limit is missing/);
    expect(reason(check(request(), ctx({ orderId: "" })))).toMatch(/order is missing/);
    expect(reason(check(request({ message: { value: "0" } })))).toMatch(/not readable/);
    expect(reason(check(request({ message: { value: "-1" } })))).toMatch(/not readable/);
  });

  it("refuses a permit to anyone but Relay's two contracts", () => {
    expect(reason(check(request({ message: { to: "0x000000000000000000000000000000000000dEaD" } })))).toMatch(/contract we know/);
  });

  it("refuses a permit from another wallet, or when the connected wallet isn't the session wallet", () => {
    expect(reason(check(request({ message: { from: "0x000000000000000000000000000000000000dEaD" } })))).toMatch(/not from your wallet/);
    expect(reason(check(request(), ctx({ wallet: "0x000000000000000000000000000000000000dEaD" })))).toMatch(/not for your wallet/);
    expect(reason(check(request(), ctx(), "0x000000000000000000000000000000000000dEaD"))).toMatch(/isn't the one connected/);
  });

  it("refuses anything that isn't exactly a USDC ReceiveWithAuthorization on Base", () => {
    expect(reason(check(request({ domain: { chainId: 42220 } })))).toMatch(/USDC permit on Base/);
    expect(reason(check(request({ domain: { verifyingContract: "0x000000000000000000000000000000000000dEaD" } })))).toMatch(/USDC permit on Base/);
    expect(reason(check(request({ domain: { name: "USDC" } })))).toMatch(/USDC permit on Base/);
    expect(reason(check(request({ primaryType: "TransferWithAuthorization" })))).toMatch(/not the top-up permit/);
    expect(reason(check(request({ primaryType: "Permit" })))).toMatch(/not the top-up permit/);
    const extra = request();
    (extra.types as Record<string, unknown>).Other = [{ name: "x", type: "uint256" }];
    expect(reason(check(extra))).toMatch(/not the top-up permit/);
    const swapped = request();
    const fields = (swapped.types as { ReceiveWithAuthorization: Array<{ name: string; type: string }> }).ReceiveWithAuthorization;
    [fields[0], fields[1]] = [fields[1], fields[0]];
    expect(reason(check(swapped))).toMatch(/not the top-up permit/);
    expect(reason(check(null))).toMatch(/not the top-up permit/);
  });

  it("refuses an expired permit, one valid for too long, and one that only starts later", () => {
    expect(reason(check(request({ message: { validBefore: String(NOW) } })))).toMatch(/time limit/);
    expect(reason(check(request({ message: { validBefore: String(NOW + 41 * 60) } })))).toMatch(/time limit/);
    expect(reason(check(request({ message: { validAfter: String(NOW + 10 * 60) } })))).toMatch(/time limit/);
    expect(reason(check(request({ message: { nonce: "0x12" } })))).toMatch(/not readable/);
  });

  it("rebuilds the permit from the checked fields, and the signature recovers to the wallet", async () => {
    const r = check(request());
    if (!r.ok) throw new Error(r.reason);
    expect(r.permit.message.value).toBe(BigInt(3551428));
    expect(r.permit.types).not.toHaveProperty("EIP712Domain");
    const signature = await account.signTypedData(r.permit);
    expect(await recoverTypedDataAddress({ ...r.permit, signature })).toBe(WALLET);
  });
});

describe("the signer our page hands the widget", () => {
  it("signs only after the check passes, and returns the signature", async () => {
    const sign = vi.fn((permit: Parameters<typeof account.signTypedData>[0]) => account.signTypedData(permit));
    const signer = makeTopUpSigner({ wallet: WALLET, signer: () => WALLET, sign, now: () => NOW });
    await expect(signer(request(), ctx())).resolves.toMatch(/^0x[0-9a-f]{130}$/);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("never asks the wallet when the check fails", async () => {
    const sign = vi.fn();
    const signer = makeTopUpSigner({ wallet: WALLET, signer: () => WALLET, sign, now: () => NOW });
    await expect(signer(request({ message: { value: "9999999" } }), ctx())).rejects.toThrow(/above/);
    expect(sign).not.toHaveBeenCalled();
  });

  it("catches an account switched in the wallet after the panel opened", async () => {
    const sign = vi.fn();
    const signer = makeTopUpSigner({ wallet: WALLET, signer: () => "0x000000000000000000000000000000000000dEaD", sign, now: () => NOW });
    await expect(signer(request(), ctx())).rejects.toThrow(/isn't the one connected/);
    expect(sign).not.toHaveBeenCalled();
  });

  it("refuses an answer that isn't a 65-byte signature", async () => {
    const signer = makeTopUpSigner({ wallet: WALLET, signer: () => WALLET, sign: async () => "0x1234", now: () => NOW });
    await expect(signer(request(), ctx())).rejects.toThrow(/didn't return a signature/);
  });
});

describe("when our page signs", () => {
  const on = { enabled: true, widgetVersion: "0.4.0", sessionWallet: WALLET.toLowerCase(), connectedWallet: WALLET };
  it("only with the switch on, widget 0.4.0 or newer, and the connected wallet being the session wallet", () => {
    expect(canHostSign(on)).toBe(true);
    expect(canHostSign({ ...on, widgetVersion: "0.10.1" })).toBe(true);
    expect(canHostSign({ ...on, enabled: false })).toBe(false);
    expect(canHostSign({ ...on, enabled: undefined })).toBe(false);
    expect(canHostSign({ ...on, widgetVersion: "0.3.9" })).toBe(false);
    expect(canHostSign({ ...on, widgetVersion: undefined })).toBe(false);
    expect(canHostSign({ ...on, connectedWallet: null })).toBe(false);
    expect(canHostSign({ ...on, connectedWallet: "0x000000000000000000000000000000000000dEaD" })).toBe(false);
  });
  it("reads widget versions", () => {
    expect([widgetAtLeast("0.4.0"), widgetAtLeast("1.0.0"), widgetAtLeast("0.3.99"), widgetAtLeast("0.4"), widgetAtLeast(4)]).toEqual([true, true, false, false, false]);
  });
});
