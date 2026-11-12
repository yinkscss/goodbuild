"use client";

import * as React from "react";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * A number that counts up to `value`. The server renders the final number, so the page reads
 * correctly before scripts run and under reduced motion. `onView` waits until it scrolls in.
 */
export function CountUp({ value, duration = 1600, onView = false, className }: { value: number; duration?: number; onView?: boolean; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const run = () => {
      let t0: number | null = null;
      const step = (t: number) => {
        t0 ??= t;
        const p = Math.min(1, (t - t0) / duration);
        el.textContent = fmt(value * (1 - Math.pow(1 - p, 4)));
        if (p < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    if (!onView) {
      run();
      return () => cancelAnimationFrame(frame);
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        run();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, duration, onView]);

  return (
    <span ref={ref} className={className}>
      {fmt(value)}
    </span>
  );
}
