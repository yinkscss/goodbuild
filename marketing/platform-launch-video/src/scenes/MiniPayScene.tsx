import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { C, F, SAFE } from "../theme";
import { clamp } from "../fx";
import type { SceneProps } from "../Video";
import { Racer } from "../visuals/Racer";
import { Blobs, Headline, SceneRoot } from "./common";

/** Phone laid out in scene coordinates so the G$ coin in the MiniPay bar is exactly the portal. */
export const MiniPayScene: React.FC<SceneProps> = ({ f, spec }) => {
  const portal = spec.portal as { cx: number; cy: number; r: number };
  const ph = { x: 270, y: 640, w: 540, h: 1050 };
  const scr = { x: ph.x + 18, y: ph.y + 18, w: ph.w - 36, h: ph.h - 36 };
  const bar = { y: portal.cy - 38, h: 76 };
  const gameTop = bar.y + bar.h + 26;
  const gameH = scr.y + scr.h - 130 - gameTop;
  const tap = f >= 20 ? interpolate((f - 20) % 45, [0, 18], [0, 1], clamp) : 0;

  return (
    <SceneRoot base={C.lilacSoft}>
      <Blobs f={f} colors={[`${C.pink}55`, `${C.white}`, `${C.lilac}`]} seed={4} />
      <Headline f={f} h={spec.h} a={spec.a} hColor={C.ink} aColor={C.purple} maxH={110} maxA={100} />
      <div style={{ position: "absolute", left: SAFE.x, top: SAFE.y + 250, fontFamily: F.mono, fontWeight: 500, fontSize: 28, color: C.purple, opacity: f >= 14 ? 1 : 0 }}>{spec.label}</div>

      {/* phone body */}
      <div style={{ position: "absolute", left: ph.x, top: ph.y, width: ph.w, height: ph.h, borderRadius: 78, background: C.ink, boxShadow: `0 0 0 3px ${C.purple}, 0 80px 140px -40px ${C.purple}` }} />
      <div style={{ position: "absolute", left: scr.x, top: scr.y, width: scr.w, height: scr.h, borderRadius: 62, background: C.cream, overflow: "hidden" }}>
        <div style={{ height: 70, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 40px", fontFamily: F.ui, fontWeight: 700, fontSize: 24, color: C.ink }}>
          <span>9:41</span>
          <span style={{ width: 120, height: 34, borderRadius: 99, background: C.ink }} />
          <span>●●●</span>
        </div>
      </div>
      {/* MiniPay bar */}
      <div style={{ position: "absolute", left: scr.x + 20, top: bar.y, width: scr.w - 40, height: bar.h, borderRadius: 99, background: C.white, boxShadow: "0 10px 30px -14px rgba(89,46,129,.5)", display: "flex", alignItems: "center", padding: "0 26px", boxSizing: "border-box", gap: 12 }}>
        <span style={{ fontFamily: F.slam, fontWeight: 800, fontSize: 28, color: C.ink }}>MiniPay</span>
        <span style={{ fontFamily: F.mono, fontWeight: 500, fontSize: 18, color: C.purple }}>mini app</span>
      </div>
      <div style={{ position: "absolute", left: portal.cx - portal.r - 8, top: portal.cy - 26, height: 52, paddingLeft: portal.r * 2 + 18, paddingRight: 16, borderRadius: 99, background: C.tint, display: "flex", alignItems: "center", fontFamily: F.ui, fontWeight: 700, fontSize: 22, color: C.purple }}>
        G$
      </div>
      <div
        style={{
          position: "absolute",
          left: portal.cx - portal.r,
          top: portal.cy - portal.r,
          width: portal.r * 2,
          height: portal.r * 2,
          borderRadius: 99,
          background: `radial-gradient(circle at 35% 30%, #fff, ${C.pink} 45%, ${C.purple})`,
        }}
      />
      <div style={{ position: "absolute", left: scr.x + 20, top: gameTop, width: scr.w - 40, height: gameH, borderRadius: 30, overflow: "hidden" }}>
        <Racer f={f + 40} width={scr.w - 40} height={gameH} radius={30} />
      </div>
      <div style={{ position: "absolute", left: scr.x + 20, top: scr.y + scr.h - 108, width: scr.w - 40, height: 80, borderRadius: 99, background: C.purple, color: C.cream, display: "flex", alignItems: "center", justifyContent: "center", gap: 14, fontFamily: F.ui, fontWeight: 700, fontSize: 28 }}>
        <span style={{ width: 14, height: 14, borderRadius: 99, background: C.pink }} />
        wallet connected
      </div>
      {/* tap ripples on the game */}
      {tap > 0 && tap < 1 && (
        <div style={{ position: "absolute", left: 540 - 90, top: gameTop + gameH * 0.7 - 90, width: 180, height: 180, borderRadius: 99, border: `5px solid ${C.white}`, transform: `scale(${0.3 + tap})`, opacity: 1 - tap }} />
      )}
    </SceneRoot>
  );
};
