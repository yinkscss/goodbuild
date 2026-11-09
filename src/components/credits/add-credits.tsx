"use client";

import * as React from "react";
import { encodeAbiParameters } from "viem";
import { celo, celoSepolia } from "viem/chains";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/context";
import { UNITS_PER_DOLLAR } from "@/lib/credits-math";

const GD_ABI = [{ type: "function", name: "transferAndCall", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "data", type: "bytes" }], outputs: [{ type: "bool" }] }] as const;
const QUOTE_TUPLE = [
  { type: "tuple", components: [{ name: "buyer", type: "address" }, { name: "gdAmount", type: "uint256" }, { name: "credits", type: "uint256" }, { name: "bonus", type: "uint256" }, { name: "ref", type: "bytes32" }, { name: "deadline", type: "uint256" }] },
  { type: "bytes" },
] as const;

interface ChainInfo {
  chainId: number;
  live: boolean;
  contract?: `0x${string}`;
  goodDollar?: `0x${string}`;
}
interface PackInfo {
  pack: number;
  gdWei: string;
  bonusMicro: number;
  bonusIfVerifiedMicro: number;
}
interface Pricing {
  gdUsd: number;
  verified: boolean;
  packs: PackInfo[];
}

type Phase = { name: "idle" } | { name: "signing" } | { name: "crediting"; hash: string } | { name: "done"; addedMicro: number; balanceMicro: number } | { name: "error"; message: string; needsGd?: boolean };

/** G$ in wei to a short whole-number string with thousands separators, e.g. "88,500". */
export const formatGd = (wei: string) => Number(BigInt(wei) / BigInt(10) ** BigInt(18)).toLocaleString("en-US");

/**
 * "Add credits" (D56): buy AI credits with G$ in one signature. The server prices the pack in G$ and signs a
 * quote; the wallet sends that exact G$ to the credits contract with `transferAndCall`; the contract burns
 * the credits out of its fixed supply and emits the event the server turns into ledger credit. People
 * verified with GoodDollar get 10% more credits on a pack. The screen never decides the balance: it asks
 * the server to read the transaction and shows what comes back.
 */
export function AddCredits({ className }: { className?: string }) {
  const auth = useAuth();
  const [open, setOpen] = React.useState(false);
  const [info, setInfo] = React.useState<ChainInfo | null | undefined>(undefined);
  const [pricing, setPricing] = React.useState<Pricing | null | undefined>(undefined);
  const [pack, setPack] = React.useState(10);
  const [phase, setPhase] = React.useState<Phase>({ name: "idle" });
  const projectChain = auth.wallet?.chainId === celoSepolia.id ? celoSepolia : celo;

  React.useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/credits/onchain", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { chains?: ChainInfo[] } | null) => live && setInfo(d?.chains?.find((c) => c.chainId === projectChain.id && c.live) ?? d?.chains?.find((c) => c.chainId === celo.id && c.live) ?? null))
      .catch(() => live && setInfo(null));
    fetch("/api/credits/quote", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Pricing | null) => live && setPricing(d))
      .catch(() => live && setPricing(null));
    return () => {
      live = false;
    };
  }, [open, projectChain.id]);

  const wallet = auth.wallet?.address ?? auth.user?.wallet ?? null;
  const selected = pricing?.packs.find((p) => p.pack === pack);
  const chain = info?.chainId === celoSepolia.id ? celoSepolia : celo;

  async function buy() {
    if (!info?.contract || !info.goodDollar || !selected || !wallet) return;
    setPhase({ name: "signing" });
    try {
      const res = await fetch("/api/credits/quote", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId: info.chainId, pack }) });
      const signed = (await res.json()) as { quote?: Record<string, string>; signature?: `0x${string}`; message?: string };
      if (!res.ok || !signed.quote || !signed.signature) throw new Error(signed.message ?? "We couldn't price that. Try again in a minute.");
      const q = signed.quote;
      if (auth.wallet?.chainId !== info.chainId) await auth.switchChain(info.chainId);
      const client = await auth.getWalletClient();
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
        return;
      }
      throw new Error("The network is slow. Your payment went through, and the credit lands as soon as it's confirmed.");
    } catch (error) {
      const text = (error as Error).message ?? "";
      const noGd = /transfer amount exceeds balance|insufficient|exceeds the balance/i.test(text);
      const refused = /user rejected|denied|rejected the request/i.test(text);
      const noGas = /gas required exceeds|insufficient funds for gas/i.test(text);
      setPhase({ name: "error", needsGd: noGd && !noGas, message: noGas ? "You need a little CELO for the network fee." : noGd ? "You don't have enough G$ for that pack." : refused ? "You cancelled it in your wallet. Nothing was charged." : text.slice(0, 200) || "Something went wrong. Nothing was charged." });
    }
  }

  const busy = phase.name === "signing" || phase.name === "crediting";
  const bonus = selected ? (pricing?.verified ? selected.bonusMicro : 0) : 0;
  return (
    <>
      <Button variant="secondary" className={className} onClick={() => { setPhase({ name: "idle" }); setOpen(true); }}>
        Add credits
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogTitle className="display text-xl font-bold">Add AI credits</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-grey-600">
            Pay with G$. One credit is $1 of AI builds. Credits pay for AI, not for network fees, and they are not a token you can trade.
          </DialogDescription>
          {(info === undefined || pricing === undefined) && <p className="mt-5 text-sm text-grey-600">Checking…</p>}
          {info === null && <p className="mt-5 text-sm text-grey-600">Credits aren&apos;t switched on yet. Your free AI still works.</p>}
          {info && pricing === null && <p className="mt-5 text-sm text-grey-600">We can&apos;t price G$ right now. Try again in a minute.</p>}
          {info && pricing && (
            <div className="mt-5 space-y-4">
              <div role="radiogroup" aria-label="Credit pack" className="grid grid-cols-3 gap-2">
                {pricing.packs.map((p) => (
                  <button key={p.pack} type="button" role="radio" aria-checked={pack === p.pack} disabled={busy} onClick={() => setPack(p.pack)} className={`rounded-2xl px-3 py-3 text-center ${pack === p.pack ? "bg-violet text-white" : "bg-tint text-ink"}`}>
                    <span className="block text-lg font-bold">{p.pack}</span>
                    <span className="block text-xs">credits</span>
                    <span className="mt-1 block text-xs font-medium">{formatGd(p.gdWei)} G$</span>
                  </button>
                ))}
              </div>
              {selected && (
                <p className="text-sm">
                  You pay <b>{formatGd(selected.gdWei)} G$</b> (about ${pack}) and get <b>{pack}</b> credits{bonus > 0 && <>, plus <b>{bonus / UNITS_PER_DOLLAR}</b> bonus for being verified</>}.
                </p>
              )}
              {!pricing.verified && selected && (
                <p className="rounded-xl bg-tint px-3 py-2 text-xs text-grey-600">
                  Verify with GoodDollar for <b>+{selected.bonusIfVerifiedMicro / UNITS_PER_DOLLAR} free credits</b> on this pack, once per person each month.{" "}
                  <a className="underline" href="https://goodid.gooddollar.org" target="_blank" rel="noopener noreferrer">Verify</a>
                </p>
              )}
              {phase.name === "error" && (
                <p role="alert" className="text-sm text-warning">
                  {phase.message}{" "}
                  {phase.needsGd && (
                    <a className="underline" href="https://www.gooddollar.org" target="_blank" rel="noopener noreferrer">
                      Get G$
                    </a>
                  )}
                </p>
              )}
              {phase.name === "crediting" && <p role="status" className="text-sm text-grey-600">Payment sent. Adding your credit…</p>}
              {phase.name === "done" && (
                <p role="status" className="text-sm text-success">
                  Added ${(phase.addedMicro / UNITS_PER_DOLLAR).toFixed(2)}. Your balance is ${(phase.balanceMicro / UNITS_PER_DOLLAR).toFixed(2)}.
                </p>
              )}
              <Button variant="primary" className="w-full" disabled={busy || !selected || !wallet || phase.name === "done"} onClick={buy}>
                {phase.name === "signing" ? "Confirm in your wallet…" : phase.name === "crediting" ? "Adding credit…" : "Pay with G$"}
              </Button>
              <p className="text-center text-xs text-grey-600">Price follows the live G$ market price, quoted for 10 minutes.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
