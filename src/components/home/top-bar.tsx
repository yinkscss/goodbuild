"use client";

import { DEFAULT_EXPECTED_CHAIN_ID, WalletButton } from "@/components/auth/wallet-button";
import { Logo } from "@/components/brand/logo";
import { AddCredits } from "@/components/credits/add-credits";
import { CreditsPill } from "@/components/home/credits-pill";
import { useAuth, useWallet } from "@/lib/auth/context";
import { chainName } from "@/lib/format";

/** Network badge: green dot and the open project's chain (Celo Sepolia where there is no project), never a global flag. */
export function NetworkBadge({ chainId: expected = DEFAULT_EXPECTED_CHAIN_ID }: { chainId?: number }) {
  const { wallet } = useWallet();
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
export function HomeTopBar({ balanceGd, usdPerGd, balanceMicro = null }: { balanceGd: number | null; usdPerGd: number | null; balanceMicro?: number | null }) {
  const signedIn = Boolean(useAuth().user);
  return (
    <div className="flex items-center justify-between gap-3 lg:justify-end">
      <div className="lg:hidden">
        <Logo href="/home" />
      </div>
      <div className="flex items-center gap-3">
        <CreditsPill balanceGd={balanceGd} usdPerGd={usdPerGd} balanceMicro={balanceMicro} className="hidden sm:flex" />
        {signedIn && <AddCredits className="hidden sm:inline-flex !px-4 !py-2" />}
        <NetworkBadge />
        <WalletButton showNetwork={false} />
      </div>
    </div>
  );
}
