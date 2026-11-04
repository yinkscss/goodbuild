"use client";

import { WalletButton, expectedChainId } from "@/components/auth/wallet-button";
import { Logo } from "@/components/brand/logo";
import { CreditsPill } from "@/components/home/credits-pill";
import { useWallet } from "@/lib/auth/context";
import { chainName } from "@/lib/format";

/** Network badge: green dot and the chain the app builds and deploys on. */
export function NetworkBadge() {
  const { wallet } = useWallet();
  const expected = expectedChainId();
  const onExpected = !wallet || wallet.chainId === null || wallet.chainId === expected;
  if (!onExpected) return null; // the wallet pill shows "Switch to …" instead
  return (
    <div className="hidden items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-xs font-semibold shadow-card sm:flex">
      <span className="size-2 rounded-full bg-success" aria-hidden />
      {chainName(expected)}
    </div>
  );
}

/** Home top bar (mockup b): credits pill, network badge, account pill. */
export function HomeTopBar({ balanceGd, usdPerGd }: { balanceGd: number | null; usdPerGd: number | null }) {
  return (
    <div className="flex items-center justify-between gap-3 lg:justify-end">
      <div className="lg:hidden">
        <Logo href="/home" />
      </div>
      <div className="flex items-center gap-3">
        <CreditsPill balanceGd={balanceGd} usdPerGd={usdPerGd} className="hidden sm:flex" />
        <NetworkBadge />
        <WalletButton showNetwork={false} />
      </div>
    </div>
  );
}
