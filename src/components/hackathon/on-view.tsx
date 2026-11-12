"use client";

import * as React from "react";

/** Adds `activeClassName` once the element scrolls into view, to replay an entrance (bars filling). */
export function OnView({ className, activeClassName, children }: { className?: string; activeClassName: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [seen, setSeen] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setSeen(true);
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={seen ? `${className ?? ""} ${activeClassName}` : className}>
      {children}
    </div>
  );
}

/** A card that lights up under the pointer, through the --mx / --my custom properties. */
export function SpotlightCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={className}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}
