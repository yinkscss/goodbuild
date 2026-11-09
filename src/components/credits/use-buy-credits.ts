"use client";

import * as React from "react";
import { encodeAbiParameters } from "viem";
import { celo, celoSepolia } from "viem/chains";

import { useAuth } from "@/lib/auth/context";

const GD_ABI = [{ type: "function", name: "transferAndCall", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "data", type: "bytes" }], outputs: [{ type: "bool" }] }] as const;
const QUOTE_TUPLE = [
  { type: "tuple", components: [{ name: "buyer", type: "address" }, { name: "gdAmount", type: "uint256" }, { name: "credits", type: "uint256" }, { name: "bonus", type: "uint256" }, { name: "ref", type: "bytes32" }, { name: "deadline", type: "uint256" }] },
  { type: "bytes" },
] as const;

export interface ChainInfo {
  chainId: number;
  live: boolean;
  contract?: `0x${string}`;
  goodDollar?: `0x${string}`;
}
export interface PackInfo {
  pack: number;
  gdWei: string;
  bonusMicro: number;
  bonusIfVerifiedMicro: number;
}
export interface Pricing {
  gdUsd: number;
  verified: boolean;
  packs: PackInfo[];
  /** G$ in wei for $1 of credit including the buffer; multiply by dollars to price any amount. */
  gdWeiPerDollar: string;
  minMicro: number;
  maxMicro: number;
  balanceMicro: number | null;
}

export type BuyPhase = { name: "idle" } | { name: "signing" } | { name: "crediting"; hash: string } | { name: "done"; addedMicro: number; balanceMicro: number } | { name: "error"; message: string; needsGd?: boolean };

export const UNITS = 1_000_000;

/** G$ in wei to a short whole-number string with thousands separators, e.g. "88,500". */
export const formatGd = (wei: string | bigint) => Number(BigInt(wei) / BigInt(10) ** BigInt(18)).toLocaleString("en-US");

/** G$ to pay for `amountMicro` of credit, estimated from the one-dollar price (the signed quote has the exact figure). */
export function estimateGdWei(pricing: Pricing, amountMicro: number): bigint {
  const wei = (BigInt(pricing.gdWeiPerDollar) * BigInt(Math.round(amountMicro))) / BigInt(UNITS);
  const whole = BigInt(10) ** BigInt(18);
  return ((wei + whole - BigInt(1)) / whole) * whole;
}

/** Chain, price and balance for the purchase screens. Loads only while `enabled`. */
export function useCreditsInfo(enabled: boolean) {
  const auth = useAuth();
  const [info, setInfo] = React.useState<ChainInfo | null | undefined>(undefined);
  const [pricing, setPricing] = React.useState<Pricing | null | undefined>(undefined);
  const preferred = auth.wallet?.chainId === celoSepolia.id ? celoSepolia.id : celo.id;

  const load = React.useCallback(() => {
    let live = true;
    fetch("/api/credits/onchain", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { chains?: ChainInfo[] } | null) => live && setInfo(d?.chains?.find((c) => c.chainId === preferred && c.live) ?? d?.chains?.find((c) => c.chainId === celo.id && c.live) ?? null))
      .catch(() => live && setInfo(null));
    fetch("/api/credits/quote", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Pricing | null) => live && setPricing(d))
      .catch(() => live && setPricing(null));
    return () => {
      live = false;
    };
  }, [preferred]);

  React.useEffect(() => (enabled ? load() : undefined), [enabled, load]);
  return { info, pricing, reload: load };
}

/**
 * Buy `amountMicro` of credit with G$ in one signature (D56): ask the server for a signed quote, send that exact G$ to the
 * credits contract with `transferAndCall`, then ask the server to read the transaction and credit the ledger.
 */
export function useBuyCredits(info: ChainInfo | null | undefined) {
  const auth = useAuth();
  const [phase, setPhase] = React.useState<BuyPhase>({ name: "idle" });
  const wallet = auth.wallet?.address ?? auth.user?.wallet ?? null;

  const buy = React.useCallback(
    async (amountMicro: number) => {
      if (!info?.contract || !info.goodDollar || !wallet) return false;
      setPhase({ name: "signing" });
      try {
        const res = await fetch("/api/credits/quote", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId: info.chainId, amountMicro }) });
        const signed = (await res.json()) as { quote?: Record<string, string>; signature?: `0x${string}`; message?: string };
        if (!res.ok || !signed.quote || !signed.signature) throw new Error(signed.message ?? "We couldn't price that. Try again in a minute.");
        const q = signed.quote;
        if (auth.wallet?.chainId !== info.chainId) await auth.switchChain(info.chainId);
        const client = await auth.getWalletClient();
        const chain = info.chainId === celoSepolia.id ? celoSepolia : celo;
        const data = encodeAbiParameters(QUOTE_TUPLE, [{ buyer: q.buyer as `0x${string}`, gdAmount: BigInt(q.gdAmount), credits: BigInt(q.credits), bonus: BigInt(q.bonus), ref: q.ref as `0x${string}`, deadline: BigInt(q.deadline) }, signed.signature]);
        const hash = await client.writeContract({ account: wallet as `0x${string}`, chain, address: info.goodDollar, abi: GD_ABI, functionName: "transferAndCall", args: [info.contract, BigInt(q.gdAmount), data] });
        setPhase({ name: "crediting", hash });
        for (let i = 0; i < 40; i++) {
          const r = await fetch("/api/credits/redeem", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId: info.chainId, txHash: hash }) });
          if (r.status === 202) {
            await new Promise((t) => setTimeout(t, 3000));
            continue;
          }
          const out = (await r.json()) as { creditedMicro?: number; balanceMicro?: number; message?: string };
          if (!r.ok) throw new Error(out.message ?? "We couldn't confirm that yet. Your payment is safe: reopen this in a minute and it will be credited.");
          setPhase({ name: "done", addedMicro: out.creditedMicro ?? 0, balanceMicro: out.balanceMicro ?? 0 });
          return true;
        }
        throw new Error("The network is slow. Your payment went through, and the credit lands as soon as it's confirmed.");
      } catch (error) {
        const text = (error as Error).message ?? "";
        const noGd = /transfer amount exceeds balance|insufficient|exceeds the balance/i.test(text);
        const refused = /user rejected|denied|rejected the request/i.test(text);
        const noGas = /gas required exceeds|insufficient funds for gas/i.test(text);
        setPhase({ name: "error", needsGd: noGd && !noGas, message: noGas ? "You need a little CELO for the network fee." : noGd ? "You don't have enough G$ for that." : refused ? "You cancelled it in your wallet. Nothing was charged." : text.slice(0, 200) || "Something went wrong. Nothing was charged." });
        return false;
      }
    },
    [auth, info, wallet],
  );

  return { phase, setPhase, buy, wallet };
}
