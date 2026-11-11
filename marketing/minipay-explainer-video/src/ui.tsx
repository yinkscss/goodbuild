import React from "react";
import { C, F } from "./theme";

/** A purple disc with a white tick. (No green anywhere in this brand video.) */
export const Tick: React.FC<{ size?: number; color?: string }> = ({ size = 40, color = C.purple }) => (
  <span style={{ width: size, height: size, borderRadius: 99, background: color, display: "inline-grid", placeItems: "center", flexShrink: 0 }}>
    <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  </span>
);

export const Pill: React.FC<{ children: React.ReactNode; bg?: string; fg?: string; size?: number; style?: React.CSSProperties }> = ({ children, bg = C.tint, fg = C.purple, size = 26, style }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: `${size * 0.35}px ${size * 0.85}px`, borderRadius: 99, background: bg, color: fg, fontFamily: F.ui, fontWeight: 700, fontSize: size, whiteSpace: "nowrap", ...style }}>{children}</span>
);

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.purple }) => (
  <div style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 24, letterSpacing: "0.18em", textTransform: "uppercase", color }}>{children}</div>
);

export const Row: React.FC<{ label: string; children: React.ReactNode; h?: number; hl?: number }> = ({ label, children, h = 88, hl = 0 }) => (
  <div style={{ height: h, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, borderTop: "2px solid rgba(17,17,17,.05)", background: `rgba(255,133,217,${0.16 * hl})`, margin: "0 -44px", padding: "0 44px", transition: "none" }}>
    <span style={{ fontFamily: F.ui, fontWeight: 500, fontSize: 28, color: "rgba(17,17,17,.55)" }}>{label}</span>
    <span style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 30, color: C.ink, display: "flex", alignItems: "center", gap: 12 }}>{children}</span>
  </div>
);

/** Soft blurred blobs for light backgrounds. */
export const Blobs: React.FC<{ t: number; colors: string[]; seed?: number }> = ({ t, colors, seed = 0 }) => (
  <>
    {colors.map((c, i) => {
      const a = (i + seed) * 2.1;
      return <div key={i} style={{ position: "absolute", left: 540 + Math.cos(a + t / 3) * 380 - 600, top: 960 + Math.sin(a * 1.3 + t / 3.6) * 640 - 600, width: 1200, height: 1200, borderRadius: "50%", background: `radial-gradient(circle, ${c} 0%, transparent 62%)` }} />;
    })}
  </>
);

/** Tap ripple + finger dot at (x, y), animating from `t0`. */
export const Tap: React.FC<{ x: number; y: number; t: number; t0: number; color?: string }> = ({ x, y, t, t0, color = C.pink }) => {
  const p = (t - t0) / 0.55;
  if (p < 0 || p > 1) return null;
  return (
    <>
      <div style={{ position: "absolute", left: x - 70, top: y - 70, width: 140, height: 140, borderRadius: 99, border: `6px solid ${color}`, transform: `scale(${0.25 + p})`, opacity: 1 - p }} />
      <div style={{ position: "absolute", left: x - 26, top: y - 26, width: 52, height: 52, borderRadius: 99, background: color, opacity: 0.55 * (1 - p * 0.5), transform: `scale(${1 - 0.25 * Math.sin(p * Math.PI)})` }} />
    </>
  );
};
