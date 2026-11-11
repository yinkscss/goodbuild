import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { C, F, SAFE, shadowCard } from "../theme";
import { clamp, fit } from "../fx";
import type { SceneProps } from "../Video";
import { Racer } from "../visuals/Racer";
import { Blobs, SceneRoot } from "./common";

export const BuildScene: React.FC<SceneProps> = ({ f, spec }) => {
  const portal = spec.portal as { cx: number; cy: number; r: number };
  const hs = Math.min(fit(spec.h1, F.slam, 900, 130, SAFE.w / 1.05), fit(spec.h2, F.slam, 900, 130, SAFE.w / 1.05));
  const as = fit(spec.a, F.serif, 400, 110, SAFE.w, "italic");
  const line = (text: string, at: number, color: string) => {
    const lf = f - at;
    const x = interpolate(lf, [0, 6], [-SAFE.w, 0], { ...clamp, easing: Easing.out(Easing.exp) });
    return (
      <div style={{ overflow: "hidden", height: hs * 1.08 }}>
        <div style={{ transform: `translateX(${x}px)`, opacity: lf >= 0 ? 1 : 0, fontFamily: F.slam, fontWeight: 900, fontSize: hs, lineHeight: 1.04, letterSpacing: "-0.03em", color, whiteSpace: "nowrap" }}>
          {text}
        </div>
      </div>
    );
  };
  const appTop = 790;
  const gameTop = 1150;
  const members = 8;
  const filled = Math.min(members, Math.max(3, Math.floor(f / 6)));

  return (
    <SceneRoot base={C.canvas}>
      <Blobs f={f} colors={[`${C.lilacSoft}`, `${C.pink}33`]} seed={2} />
      <div style={{ position: "absolute", left: SAFE.x, top: SAFE.y, width: SAFE.w }}>
        {line(spec.h1, 0, C.purple)}
        {line(spec.h2, 15, C.ink)}
        <div
          style={{
            fontFamily: F.serif,
            fontStyle: "italic",
            fontSize: as,
            color: C.purple,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            clipPath: `inset(0 ${interpolate(f, [24, 30], [100, 0], clamp)}% 0 0)`,
          }}
        >
          {spec.a}
        </div>
      </div>

      {/* app card */}
      <div style={{ position: "absolute", left: SAFE.x, top: appTop, width: SAFE.w, height: 330, borderRadius: 40, background: C.white, boxShadow: shadowCard, padding: 40, boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 24, letterSpacing: "0.12em", color: C.purple }}>APP</span>
          <span style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 24, color: C.purple, background: C.tint, padding: "8px 20px", borderRadius: 99 }}>on Celo</span>
        </div>
        <div style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 46, color: C.ink, marginTop: 18, letterSpacing: "-0.01em" }}>{spec.app}</div>
        <div style={{ display: "flex", gap: 12, marginTop: 26, alignItems: "center" }}>
          {Array.from({ length: members }).map((_, i) => (
            <span
              key={i}
              style={{
                width: 58,
                height: 58,
                borderRadius: 99,
                background: i < filled ? [C.purple, C.lilac, C.pink, C.deep][i % 4] : C.tint,
                border: `4px solid ${C.white}`,
                marginLeft: i ? -22 : 0,
                transform: `scale(${i === filled - 1 ? interpolate(f % 6, [0, 4], [1.3, 1], clamp) : 1})`,
              }}
            />
          ))}
          <span style={{ marginLeft: "auto", height: 70, padding: "0 34px", borderRadius: 99, background: C.ink, color: C.white, fontFamily: F.ui, fontWeight: 700, fontSize: 28, display: "flex", alignItems: "center" }}>Join the circle</span>
        </div>
      </div>

      {/* game card */}
      <div style={{ position: "absolute", left: SAFE.x, top: gameTop, width: SAFE.w, height: 1690 - gameTop, borderRadius: 40, background: C.ink, boxShadow: shadowCard, overflow: "hidden" }}>
        <Racer f={f} width={SAFE.w} height={1690 - gameTop} radius={0} />
        <span style={{ position: "absolute", right: 30, top: 30, fontFamily: F.mono, fontWeight: 700, fontSize: 24, letterSpacing: "0.12em", color: C.cream, background: "rgba(18,10,28,.7)", padding: "10px 20px", borderRadius: 99 }}>GAME</span>
      </div>
      {/* MiniPay chip: its dot is the portal */}
      <div
        style={{
          position: "absolute",
          left: portal.cx - portal.r - 26,
          top: portal.cy - 36,
          height: 72,
          paddingLeft: portal.r * 2 + 44,
          paddingRight: 34,
          borderRadius: 99,
          background: C.white,
          display: "flex",
          alignItems: "center",
          fontFamily: F.ui,
          fontWeight: 700,
          fontSize: 30,
          color: C.ink,
          boxShadow: "0 16px 40px -16px rgba(0,0,0,.6)",
        }}
      >
        {spec.chip}
      </div>
      <div
        style={{
          position: "absolute",
          left: portal.cx - portal.r,
          top: portal.cy - portal.r,
          width: portal.r * 2,
          height: portal.r * 2,
          borderRadius: 99,
          background: C.pink,
          boxShadow: `0 0 0 ${interpolate(f % 15, [0, 15], [0, 14])}px ${C.pink}${Math.round(interpolate(f % 15, [0, 15], [120, 0])).toString(16).padStart(2, "0")}`,
        }}
      />
    </SceneRoot>
  );
};
