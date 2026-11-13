"use client";

import * as React from "react";
import { createPublicClient, custom, encodeAbiParameters } from "viem";
import { celo, celoSepolia } from "viem/chains";

import { useAuth } from "@/lib/auth/context";
import { forgetPending, redeemTx, retryPending, savePending } from "./pending-payments";

const GD_ABI = [{ type: "function", name: "transferAndCall", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "data", type: "bytes" }], outputs: [{ type: "bool" }] }] as const;
const BALANCE_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
/** G$ is a Superfluid token: a short balance reverts with SF_TOKEN_MOVE_INSUFFICIENT_BALANCE (0x2f4cb941), which wallets show as "unknown custom error". */
export const NO_GD_PATTERN = /transfer amount exceeds balance|insufficient|exceeds the balance|0x2f4cb941|SF_TOKEN_MOVE_INSUFFICIENT_BALANCE/i;
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

/** `paid`: the G$ was sent but the credit isn't confirmed yet; it still lands (saved hash, background scan, or "Missing a payment?"). */
export type BuyPhase = { name: "idle" } | { name: "signing" } | { name: "crediting"; hash: string } | { name: "paid"; hash: string } | { name: "done"; addedMicro: number; balanceMicro: number } | { name: "error"; message: string; needsGd?: boolean; needsCelo?: boolean };

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
        const have = await createPublicClient({ chain, transport: custom(client.transport) }).readContract({ address: info.goodDollar, abi: BALANCE_ABI, functionName: "balanceOf", args: [wallet as `0x${string}`] }).catch(() => null);
        if (have !== null && have < BigInt(q.gdAmount)) {
          setPhase({ name: "error", needsGd: true, message: `You have ${formatGd(have)} G$ in this wallet and need ${formatGd(BigInt(q.gdAmount))} G$. Nothing was charged.` });
          return false;
        }
        const data = encodeAbiParameters(QUOTE_TUPLE, [{ buyer: q.buyer as `0x${string}`, gdAmount: BigInt(q.gdAmount), credits: BigInt(q.credits), bonus: BigInt(q.bonus), ref: q.ref as `0x${string}`, deadline: BigInt(q.deadline) }, signed.signature]);
        const hash = await client.writeContract({ account: wallet as `0x${string}`, chain, address: info.goodDollar, abi: GD_ABI, functionName: "transferAndCall", args: [info.contract, BigInt(q.gdAmount), data] });
        // Saved before anything else, so a closed tab can't lose it (GB-01): the next page load sends it again.
        savePending(info.chainId, hash);
        setPhase({ name: "crediting", hash });
        for (let i = 0; i < 40; i++) {
          const out = await redeemTx(info.chainId, hash);
          if (out.kind === "pending") {
            await new Promise((t) => setTimeout(t, 3000));
            continue;
          }
          if (out.kind === "credited") {
            forgetPending(hash);
            setPhase({ name: "done", addedMicro: out.addedMicro, balanceMicro: out.balanceMicro });
            return true;
          }
          if (out.kind === "not_credits") {
            forgetPending(hash);
            setPhase({ name: "error", message: "That payment didn't go through on-chain, so nothing was charged. Try again." });
            return false;
          }
          break;
        }
        // The G$ has moved; only the credit is still on its way. Never say "nothing was charged" from here.
        setPhase({ name: "paid", hash });
        return false;
      } catch (error) {
        const text = (error as Error).message ?? "";
        const noGd = NO_GD_PATTERN.test(text);
        const refused = /user rejected|denied|rejected the request/i.test(text);
        const noGas = /gas required exceeds|insufficient funds for gas/i.test(text);
        setPhase({ name: "error", needsGd: noGd && !noGas, needsCelo: noGas, message: noGas ? "You need a little CELO for the network fee." : noGd ? "You don't have enough G$ for that." : refused ? "You cancelled it in your wallet. Nothing was charged." : text.slice(0, 200) || "Something went wrong. Nothing was charged." });
        return false;
      }
    },
    [auth, info, wallet],
  );

  // A payment whose tab closed before it was credited: send its saved hash again on the next page load.
  const [recoveredMicro, setRecoveredMicro] = React.useState(0);
  const signedIn = Boolean(auth.user);
  React.useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void retryPending().then((added) => live && added > 0 && setRecoveredMicro((m) => m + added));
    return () => {
      live = false;
    };
  }, [signedIn]);

  return { phase, setPhase, buy, wallet, recoveredMicro };
}
