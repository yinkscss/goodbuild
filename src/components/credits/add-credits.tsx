"use client";

import * as React from "react";
import { bytesToHex } from "viem";
import { celo } from "viem/chains";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/context";
import { UNITS_PER_DOLLAR, formatCelo, weiForDollars } from "@/lib/credits-math";
import { onrampUrl } from "@/lib/onramp";

const PRESETS = [1, 5, 10];
const PURCHASE_ABI = [{ type: "function", name: "purchaseAndRedeem", stateMutability: "payable", inputs: [{ name: "ref", type: "bytes32" }], outputs: [] }] as const;

interface ChainInfo {
  chainId: number;
  live: boolean;
  contract?: `0x${string}`;
  creditsPerCelo?: string;
  maxPerMint?: string;
}

type Phase = { name: "idle" } | { name: "signing" } | { name: "crediting"; hash: string } | { name: "done"; addedMicro: number; balanceMicro: number } | { name: "error"; message: string; needsCelo?: boolean };

/**
 * "Add credits" (D51, D52): buy AI credits with CELO on Celo mainnet in one signature. The contract
 * sends the CELO to GoodBuild's treasury and emits the event the server turns into ledger credit.
 * The screen never decides the balance: it asks the server to read the transaction and shows what comes back.
 */
export function AddCredits({ className }: { className?: string }) {
  const auth = useAuth();
  const [open, setOpen] = React.useState(false);
  const [info, setInfo] = React.useState<ChainInfo | null | undefined>(undefined);
  const [dollars, setDollars] = React.useState(5);
  const [phase, setPhase] = React.useState<Phase>({ name: "idle" });

  React.useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/credits/onchain", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { chains?: ChainInfo[] } | null) => live && setInfo(d?.chains?.find((c) => c.chainId === celo.id && c.live) ?? null))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [open]);

  const rate = info?.creditsPerCelo ? BigInt(info.creditsPerCelo) : null;
  const wei = rate ? weiForDollars(dollars, rate) : null;
  const overCap = Boolean(info?.maxPerMint && BigInt(dollars * UNITS_PER_DOLLAR) > BigInt(info.maxPerMint));
  const wallet = auth.wallet?.address ?? auth.user?.wallet ?? null;
  const buyCelo = onrampUrl(wallet);

  async function buy() {
    if (!info?.contract || !wei || !wallet) return;
    setPhase({ name: "signing" });
    try {
      if (auth.wallet?.chainId !== celo.id) await auth.switchChain(celo.id);
      const client = await auth.getWalletClient();
      const ref = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const hash = await client.writeContract({ account: wallet as `0x${string}`, chain: celo, address: info.contract, abi: PURCHASE_ABI, functionName: "purchaseAndRedeem", args: [ref], value: wei });
      setPhase({ name: "crediting", hash });
      for (let i = 0; i < 40; i++) {
        const res = await fetch("/api/credits/redeem", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId: celo.id, txHash: hash }) });
        if (res.status === 202) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        const data = (await res.json()) as { creditedMicro?: number; balanceMicro?: number; message?: string };
        if (!res.ok) throw new Error(data.message ?? "We couldn't confirm that yet. Your payment is safe: reopen this in a minute and it will be credited.");
        setPhase({ name: "done", addedMicro: data.creditedMicro ?? 0, balanceMicro: data.balanceMicro ?? 0 });
        return;
      }
      throw new Error("The network is slow. Your payment went through, and the credit lands as soon as it's confirmed.");
    } catch (error) {
      const text = (error as Error).message ?? "";
      const broke = /insufficient funds|exceeds the balance|gas required exceeds/i.test(text);
      const refused = /user rejected|denied|rejected the request/i.test(text);
      setPhase({ name: "error", needsCelo: broke, message: broke ? "You don't have enough CELO for that." : refused ? "You cancelled it in your wallet. Nothing was charged." : text.slice(0, 200) || "Something went wrong. Nothing was charged." });
    }
  }

  const busy = phase.name === "signing" || phase.name === "crediting";
  return (
    <>
      <Button variant="secondary" className={className} onClick={() => { setPhase({ name: "idle" }); setOpen(true); }}>
        Add credits
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogTitle className="display text-xl font-bold">Add AI credits</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-grey-600">
            Pay with CELO on Celo mainnet. $1 of credit is $1 of AI builds. Credits pay for AI, not for network fees, and they are not a token you can trade.
          </DialogDescription>
          {info === undefined && <p className="mt-5 text-sm text-grey-600">Checking…</p>}
          {info === null && <p className="mt-5 text-sm text-grey-600">Credits on Celo mainnet aren&apos;t switched on yet. Your free AI still works.</p>}
          {info && (
            <div className="mt-5 space-y-4">
              <div role="radiogroup" aria-label="Amount" className="flex gap-2">
                {PRESETS.map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={dollars === p} disabled={busy} onClick={() => setDollars(p)} className={`flex-1 rounded-full px-3 py-2 text-sm font-medium ${dollars === p ? "bg-violet text-white" : "bg-tint text-ink"}`}>
                    ${p}
                  </button>
                ))}
              </div>
              <p className="text-sm">
                {wei ? <>You pay about <b>{formatCelo(wei)} CELO</b> and get <b>${dollars}</b> of credit.</> : "Pick an amount."}
                {overCap && <span className="block text-warning">That&apos;s over the limit for one purchase.</span>}
              </p>
              {phase.name === "error" && (
                <p role="alert" className="text-sm text-warning">
                  {phase.message}{" "}
                  {phase.needsCelo && buyCelo && (
                    <a className="underline" href={buyCelo} target="_blank" rel="noopener noreferrer">
                      Get CELO
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
              <Button variant="primary" className="w-full" disabled={busy || !wei || overCap || !wallet || phase.name === "done"} onClick={buy}>
                {phase.name === "signing" ? "Confirm in your wallet…" : phase.name === "crediting" ? "Adding credit…" : "Pay with CELO"}
              </Button>
              {buyCelo && phase.name !== "error" && (
                <p className="text-center text-xs text-grey-600">
                  Need CELO?{" "}
                  <a className="underline" href={buyCelo} target="_blank" rel="noopener noreferrer">
                    Buy it with a card
                  </a>
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
