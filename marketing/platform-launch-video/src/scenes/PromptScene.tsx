import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { C, F, SAFE, TL, shadowCard } from "../theme";
import { clamp } from "../fx";
import type { SceneProps } from "../Video";
import { Blobs, Headline, SceneRoot } from "./common";

export const PromptScene: React.FC<SceneProps> = ({ f, spec }) => {
  const t = f / TL.fps;
  const portal = spec.portal as { cx: number; cy: number; r: number };
  const n = t < spec.typeFrom ? 0 : Math.min(spec.prompt.length, Math.floor((t - spec.typeFrom) / spec.charDur) + 1);
  const typing = n < spec.prompt.length;
  const caretOn = typing || Math.floor(f / 8) % 2 === 0;
  const pf = f - Math.round(spec.pressAt * TL.fps);
  const press = pf >= 0 ? interpolate(pf, [0, 3, 8], [1, 0.92, 1], clamp) : 1;
  const ripple = pf >= 0 ? interpolate(pf, [0, 18], [0, 1], clamp) : 0;
  // cursor glides to the button
  const cx = interpolate(t, [spec.pressAt - 0.9, spec.pressAt - 0.05], [640, portal.cx - 6], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const cy = interpolate(t, [spec.pressAt - 0.9, spec.pressAt - 0.05], [1780, portal.cy + 10], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const cursorOn = t > spec.pressAt - 0.9 && t < spec.pressAt + 0.5;
  const card = { x: SAFE.x, y: 960, w: SAFE.w, h: portal.cy + 70 - 960 };
  const cardIn = interpolate(f, [4, 14], [80, 0], { ...clamp, easing: Easing.out(Easing.exp) });
  const btnW = 300;
  const btnH = 92;
  const glow = pf >= 0 ? interpolate(pf, [0, 10], [0, 1], clamp) : 0;

  return (
    <SceneRoot base={C.cream}>
      <Blobs f={f} colors={[`${C.lilac}aa`, `${C.pink}55`, `${C.lilacSoft}`]} />
      <div style={{ position: "absolute", left: SAFE.x, top: SAFE.y, display: "flex", alignItems: "center", gap: 14, fontFamily: F.mono, fontWeight: 700, fontSize: 30, color: C.purple, letterSpacing: "0.06em" }}>
        <span style={{ width: 14, height: 14, borderRadius: 99, background: C.pink }} />
        {spec.eyebrow}
      </div>
      <Headline f={f} h={spec.h} a={spec.a} hColor={C.ink} aColor={C.purple} top={SAFE.y + 100} at={3} aAt={10} maxH={150} />

      <div
        style={{
          position: "absolute",
          left: card.x,
          top: card.y,
          width: card.w,
          height: card.h,
          borderRadius: 44,
          background: C.white,
          boxShadow: shadowCard,
          transform: `translateY(${cardIn}px)`,
          opacity: f >= 4 ? 1 : 0,
        }}
      >
        <div style={{ position: "absolute", left: 44, top: 36, fontFamily: F.mono, fontWeight: 500, fontSize: 26, color: "rgba(17,17,17,.4)", letterSpacing: "0.08em" }}>NEW PROJECT</div>
        <div style={{ position: "absolute", left: 44, top: 96, right: 44, fontFamily: F.ui, fontWeight: 500, fontSize: 50, lineHeight: 1.3, color: C.ink }}>
          {spec.prompt.slice(0, n)}
          <span style={{ display: "inline-block", width: 5, height: 56, background: C.purple, marginLeft: 4, transform: "translateY(10px)", opacity: caretOn ? 1 : 0 }} />
        </div>
      </div>
      {/* toolbar, placed in scene coordinates so the portal disc sits exactly at spec.portal */}
      <div style={{ position: "absolute", left: SAFE.x + 44, top: portal.cy - 32, display: "flex", gap: 14, transform: `translateY(${cardIn}px)`, opacity: f >= 4 ? 1 : 0 }}>
        <span style={{ height: 64, padding: "0 26px", borderRadius: 99, background: C.tint, color: C.purple, fontFamily: F.ui, fontWeight: 700, fontSize: 26, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: C.pink }} />
          Celo
        </span>
        <span style={{ height: 64, padding: "0 26px", borderRadius: 99, background: C.tint, color: C.purple, fontFamily: F.ui, fontWeight: 700, fontSize: 26, display: "flex", alignItems: "center" }}>credits in G$</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: portal.cx + portal.r + 12 - btnW,
          top: portal.cy - btnH / 2,
          width: btnW,
          height: btnH,
          borderRadius: 99,
          background: C.purple,
          transform: `translateY(${cardIn}px) scale(${press})`,
          transformOrigin: `${btnW - portal.r - 12}px 50%`,
          boxShadow: `0 20px 50px -18px ${C.purple}`,
          opacity: f >= 4 ? 1 : 0,
        }}
      >
        <span style={{ position: "absolute", left: 40, top: 0, lineHeight: `${btnH}px`, fontFamily: F.ui, fontWeight: 700, fontSize: 32, color: C.white }}>Build it</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: portal.cx - portal.r,
          top: portal.cy - portal.r + cardIn,
          width: portal.r * 2,
          height: portal.r * 2,
          borderRadius: "50%",
          background: C.pink,
          boxShadow: `0 0 ${40 * glow}px ${16 * glow}px ${C.pink}aa`,
          display: "grid",
          placeItems: "center",
          fontFamily: F.ui,
          fontWeight: 700,
          fontSize: 30,
          color: C.ink,
          transform: `scale(${press})`,
          opacity: f >= 4 ? 1 : 0,
        }}
      >
        →
      </div>
      {ripple > 0 && ripple < 1 && (
        <div style={{ position: "absolute", left: portal.cx - 200, top: portal.cy - 200, width: 400, height: 400, borderRadius: "50%", border: `4px solid ${C.pink}`, transform: `scale(${0.17 + ripple})`, opacity: 1 - ripple }} />
      )}
      {cursorOn && (
        <svg style={{ position: "absolute", left: cx, top: cy }} width="54" height="64" viewBox="0 0 27 32">
          <path d="M2 2 L2 26 L8.5 20 L13 30 L17 28 L12.5 18.5 L21 18.5 Z" fill={C.ink} stroke={C.white} strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )}
    </SceneRoot>
  );
};
