"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Wait-state kit (picked from the wait-state gallery, 10 Nov 2026). Calm, violet, honest:
 * every wait can show how long it has run and say something different when it runs long.
 * Motion stops under prefers-reduced-motion through the global rule in globals.css.
 */

/** Whole seconds since `active` last turned true; resets when `resetKey` changes. 0 while inactive. */
export function useElapsed(active: boolean, resetKey?: unknown): number {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 500);
    return () => {
      window.clearInterval(id);
      setSeconds(0);
    };
  }, [active, resetKey]);
  return active ? seconds : 0;
}

/** 83 becomes "1:23". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Three violet dots in a slow wave. Decorative; the label next to it carries the meaning. */
export function WaveDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-3.5 items-center gap-[3px]", className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <i key={i} className="size-1 rounded-full bg-violet animate-wave" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}

/** A short inline note. `tone="warn"` gets a warning dot, `tone="calm"` a violet one. */
export function WaitNote({ children, tone = "warn", className }: { children: React.ReactNode; tone?: "warn" | "calm"; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-block bg-surface px-3 py-2 text-xs text-grey-600", className)} role="status">
      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", tone === "warn" ? "bg-warning" : "bg-violet")} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** The four brand tiles, landing one by one. `lit` is how many are on (0 to 4); `hold` breathes the lit ones. */
export function BrandTiles({ lit, hold, className }: { lit: number; hold?: boolean; className?: string }) {
  const tone = ["bg-white shadow-card", "bg-[#D9C4EE]", "bg-[#D9C4EE]", "bg-pink"];
  return (
    <div className={cn("grid grid-cols-2 gap-1.5", className)} aria-hidden>
      {tone.map((t, i) => (
        <i
          key={i}
          className={cn(
            "size-[52px] rounded-[14px] transition-[opacity,transform,background-color] duration-500 ease-gb",
            i < lit ? cn("scale-100 opacity-100", t, hold && "animate-breath") : "scale-90 bg-tint opacity-50",
          )}
        />
      ))}
    </div>
  );
}

/** A skeleton block sized by classes. Same shimmer as the global `skeleton` utility. */
export function Shimmer({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-block motion-reduce:animate-none", className)} aria-hidden />;
}

/** How long a list or page may load before it says it is still going. */
export const SLOW_LOAD_SECONDS = 12;

/** Shows nothing until a load has run for SLOW_LOAD_SECONDS, then says it is still going. */
export function SlowLoadNote({ what, className }: { what: string; className?: string }) {
  const seconds = useElapsed(true);
  if (seconds < SLOW_LOAD_SECONDS) return null;
  return <WaitNote tone="calm" className={className}>Still loading {what}. If nothing shows soon, refresh the page.</WaitNote>;
}

/** Rows shaped like a table body or list, for pages that wait on data (wait-state pick F1). */
export function RowsSkeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div className="grid gap-2" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid grid-cols-[1.4fr_1fr_.6fr] items-center gap-4 rounded-block bg-surface px-4 py-3.5 shadow-card">
          <Shimmer className="h-3.5 w-3/4 rounded-full" />
          <Shimmer className="h-3 w-1/2 rounded-full" />
          <Shimmer className="h-3 w-2/3 justify-self-end rounded-full" />
        </div>
      ))}
    </div>
  );
}
