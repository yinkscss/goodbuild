import React from "react";
import { Easing, interpolate } from "remotion";
import { C, F } from "../theme";
import { clamp } from "../fx";
import { Arcade } from "./Arcade";
import type { VisualProps } from "../scenes/Card";

/** A phone with the game running inside the MiniPay browser. */
export const Phone: React.FC<VisualProps> = ({ f, h }) => {
  const ph = Math.min(h - 10, 900);
  const pw = ph * 0.5;
  const y = interpolate(f, [0, 7], [700, 0], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  const rot = interpolate(f, [0, 7], [14, -4], { ...clamp, easing: Easing.out(Easing.cubic) });
  const pad = pw * 0.05;
  const inner = pw - pad * 2;
  const k = pw / 450; // scale factor for UI inside
  return (
    <div
      style={{
        width: pw,
        height: ph,
        borderRadius: 64 * k,
        background: C.ink,
        padding: pad,
        transform: `translateY(${y}px) rotate(${rot + Math.sin(f / 16) * 1.2}deg)`,
        boxShadow: `0 0 0 3px ${C.purple}, 0 60px 120px -30px ${C.purple}aa`,
        position: "relative",
      }}
    >
      <div style={{ width: inner, height: ph - pad * 2, borderRadius: 48 * k, background: C.cream, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* status bar + island */}
        <div style={{ height: 52 * k, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${26 * k}px`, fontFamily: F.ui, fontWeight: 700, fontSize: 18 * k, color: C.ink }}>
          <span>9:41</span>
          <span style={{ width: 96 * k, height: 26 * k, borderRadius: 99, background: C.ink }} />
          <span style={{ letterSpacing: 2 }}>●●●</span>
        </div>
        {/* MiniPay chrome */}
        <div style={{ margin: `${6 * k}px ${16 * k}px`, height: 58 * k, borderRadius: 99, background: C.white, display: "flex", alignItems: "center", gap: 10 * k, padding: `0 ${18 * k}px`, boxShadow: "0 8px 24px -14px rgba(89,46,129,.4)" }}>
          <span style={{ fontFamily: F.slam, fontWeight: 800, fontSize: 20 * k, color: C.ink }}>MiniPay</span>
          <span style={{ fontFamily: F.mono, fontWeight: 500, fontSize: 15 * k, color: C.purple, opacity: 0.8 }}>mini app</span>
          <span style={{ marginLeft: "auto", width: 12 * k, height: 12 * k, borderRadius: 99, background: C.pink, boxShadow: `0 0 0 ${interpolate(f % 20, [0, 20], [0, 10]) * k}px ${C.pink}33` }} />
        </div>
        <div style={{ padding: `${14 * k}px ${22 * k}px ${4 * k}px`, fontFamily: F.slam, fontWeight: 900, fontSize: 34 * k, color: C.purple, letterSpacing: "-0.03em" }}>ARCADE</div>
        <div style={{ display: "flex", justifyContent: "center", padding: `${8 * k}px 0` }}>
          <Arcade f={f + 30} size={inner - 36 * k} />
        </div>
        <div style={{ margin: `auto ${16 * k}px ${20 * k}px`, height: 64 * k, borderRadius: 99, background: C.purple, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 * k, fontFamily: F.ui, fontWeight: 700, fontSize: 21 * k, color: C.cream }}>
          <span style={{ width: 12 * k, height: 12 * k, borderRadius: 99, background: C.pink }} />
          wallet connected
        </div>
      </div>
    </div>
  );
};
