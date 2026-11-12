import Link from "next/link";

import { formatCredits } from "@/lib/credits-math";
import { creditState, formatGd } from "@/lib/home";
import { cn } from "@/lib/utils";

/**
 * Credits pill (DESIGN_SYSTEM §3, AUTH.md Flow 8): G$ balance plus a credits estimate.
 * ≤10 G$ turns warning-tinted with a top-up link; 0 G$ the same, and Send is disabled
 * elsewhere. `balanceGd: null` means the ledger isn't live yet (before credits are live): the pill
 * says so instead of showing an invented balance.
 */
export function CreditsPill({
  balanceGd,
  usdPerGd,
  topUpHref = "/credits",
  balanceMicro = null,
  className,
}: {
  /** The real ledger balance in micro-USD (D46), when there is some. It shows instead of the free-AI note. */
  balanceMicro?: number | null;
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

  if (state === "preview" && balanceMicro !== null && balanceMicro > 0) {
    return (
      <div className={cn("flex items-center gap-2 rounded-full bg-surface py-1.5 pr-4 pl-1.5 text-sm shadow-card", className)} title="Your paid credit plus the free AI you have left. Free AI is used first.">
        <span className="grid size-6 place-items-center rounded-full bg-violet text-[10px] font-bold text-white" aria-hidden>C</span>
        <b className="font-semibold">{formatCredits(balanceMicro)}</b>
        <span className="text-grey-400">available</span>
      </div>
    );
  }

  if (state === "preview") {
    return (
      <div
        className={cn("flex items-center gap-2 rounded-full bg-surface py-1.5 pr-4 pl-1.5 text-sm shadow-card", className)}
        title="Each new account gets 20 credits of AI free. After that, add credits with G$."
      >
        {glyph}
        <b className="font-semibold">Free AI</b>
        <span className="text-grey-400">· 20 credits free</span>
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
      {usdPerGd !== null && <span className="text-grey-400">≈ {formatCredits(balanceGd! * usdPerGd * 1_000_000)}</span>}
      {warn && (
        <Link href={topUpHref} className="font-medium text-warning underline-offset-2 hover:underline">
          Top up
        </Link>
      )}
    </div>
  );
}
