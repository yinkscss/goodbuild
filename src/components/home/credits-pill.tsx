import Link from "next/link";

import { creditState, formatGd, formatUsd } from "@/lib/home";
import { cn } from "@/lib/utils";

/**
 * Credits pill (DESIGN_SYSTEM §3, AUTH.md Flow 8): G$ balance plus a USD estimate.
 * ≤10 G$ turns warning-tinted with a top-up link; 0 G$ the same, and Send is disabled
 * elsewhere. `balanceGd: null` means the ledger isn't live yet (before M6): the pill
 * says so instead of showing an invented balance.
 */
export function CreditsPill({
  balanceGd,
  usdPerGd,
  topUpHref = "#credits",
  className,
}: {
  balanceGd: number | null;
  usdPerGd: number | null;
  topUpHref?: string;
  className?: string;
}) {
  const state = creditState(balanceGd);
  const glyph = (
    <span
      className={cn(
        "grid size-6 place-items-center rounded-full text-[10px] font-bold text-white",
        state === "low" || state === "empty" ? "bg-warning" : "bg-violet",
      )}
      aria-hidden
    >
      G$
    </span>
  );

  if (state === "preview") {
    return (
      <div
        className={cn("flex items-center gap-2 rounded-full bg-surface py-1.5 pr-4 pl-1.5 text-sm shadow-card", className)}
        title="G$ credits arrive with the credits milestone. Building is free during the testnet beta."
      >
        {glyph}
        <b className="font-semibold">Testnet beta</b>
        <span className="text-grey-400">· free</span>
      </div>
    );
  }

  const warn = state === "low" || state === "empty";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 text-sm shadow-card",
        warn ? "bg-warning/10" : "bg-surface",
        className,
      )}
      role={warn ? "status" : undefined}
    >
      {glyph}
      <b className={cn("font-semibold", warn && "text-warning")}>{formatGd(balanceGd!)}</b>
      {usdPerGd !== null && <span className="text-grey-400">{formatUsd(balanceGd! * usdPerGd)}</span>}
      {warn && (
        <Link href={topUpHref} className="font-medium text-warning underline-offset-2 hover:underline">
          Top up
        </Link>
      )}
    </div>
  );
}
