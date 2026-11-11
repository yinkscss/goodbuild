import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { C, F, SAFE, TL } from "../theme";
import { clamp } from "../fx";
import type { SceneProps } from "../Video";
import { Headline, SceneRoot } from "./common";

/** A spinning 3D G$ coin that comes to rest face-on just before the camera dives into it. */
const Coin: React.FC<{ angle: number; d: number }> = ({ angle, d }) => {
  const layers = 18;
  const face = (back: boolean): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
    background: `radial-gradient(circle at 32% 28%, #fff 0%, ${C.lilac} 22%, ${C.pink} 58%, ${C.purple} 100%)`,
    boxShadow: `inset 0 0 0 ${d * 0.035}px rgba(255,255,255,.55), inset 0 0 0 ${d * 0.075}px ${C.purple}55`,
    display: "grid",
    placeItems: "center",
    transform: `${back ? "rotateY(180deg) " : ""}translateZ(${layers}px)`,
    backfaceVisibility: "hidden",
  });
  const glyph = (
    <span style={{ fontFamily: F.slam, fontWeight: 900, fontSize: d * 0.36, color: C.cream, letterSpacing: "-0.04em", textShadow: `0 ${d * 0.012}px 0 ${C.purple}` }}>G$</span>
  );
  return (
    <div style={{ width: d, height: d, perspective: 2200 }}>
      <div style={{ position: "relative", width: d, height: d, transformStyle: "preserve-3d", transform: `rotateY(${angle}deg) rotateX(${Math.sin(angle / 70) * 6}deg)` }}>
        {Array.from({ length: layers * 2 }).map((_, i) => (
          <div key={i} style={{ position: "absolute", inset: 0, borderRadius: "50%", background: i % 4 < 2 ? C.purple : "#7A4AA8", transform: `translateZ(${i - layers}px)` }} />
        ))}
        <div style={face(false)}>{glyph}</div>
        <div style={face(true)}>{glyph}</div>
      </div>
    </div>
  );
};

export const GdScene: React.FC<SceneProps> = ({ f, spec }) => {
  const portal = spec.portal as { cx: number; cy: number; r: number };
  const dur = (spec.end - spec.start) * TL.fps;
  const restAt = dur - TL.zoom * TL.fps - 10;
  // fast spin that decelerates onto 0deg (face-on) at restAt
  const k = interpolate(f, [-18, restAt], [0, 1], clamp);
  const angle = -1440 * (1 - Easing.out(Easing.cubic)(k));
  const d = 560;
  const credits = Math.round(interpolate(f, [16, 52], [0, 120], { ...clamp, easing: Easing.out(Easing.cubic) }));

  return (
    <SceneRoot base={C.ink} bg={`radial-gradient(35% 22.5% at 50% 52%, ${C.purple}, ${C.deep} 60%, ${C.ink})`}>
      {/* orbiting sparks */}
      {Array.from({ length: 14 }).map((_, i) => {
        const a = (i / 14) * Math.PI * 2 + f / 40;
        const rx = 430;
        const ry = 160;
        const z = Math.sin(a);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: portal.cx + Math.cos(a) * rx - 9,
              top: portal.cy + z * ry - 9,
              width: 18,
              height: 18,
              borderRadius: 99,
              background: i % 3 ? C.lilac : C.pink,
              opacity: 0.35 + 0.65 * ((z + 1) / 2),
              transform: `scale(${0.6 + 0.6 * ((z + 1) / 2)})`,
            }}
          />
        );
      })}
      <Headline f={f} h={spec.h} a={spec.a} hColor={C.cream} aColor={C.pink} maxH={120} maxA={86} />
      <div style={{ position: "absolute", left: portal.cx - d / 2, top: portal.cy - d / 2 }}>
        <Coin angle={angle} d={d} />
      </div>
      {/* credits pill */}
      <div
        style={{
          position: "absolute",
          left: 540 - 220,
          top: portal.cy + d / 2 + 40,
          width: 440,
          height: 92,
          borderRadius: 99,
          background: C.white,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          fontFamily: F.ui,
          fontWeight: 700,
          fontSize: 38,
          color: C.ink,
          transform: `scale(${interpolate(f, [14, 20], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) })})`,
        }}
      >
        <span style={{ fontFamily: F.mono, fontSize: 24, color: C.purple, letterSpacing: "0.1em" }}>CREDITS</span>
        {credits} G$
      </div>
      <div style={{ position: "absolute", left: SAFE.x, width: SAFE.w, top: portal.cy + d / 2 + 160, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 14 }}>
        {(spec.chips as string[]).map((c, i) => (
          <span
            key={c}
            style={{
              padding: "14px 26px",
              borderRadius: 99,
              background: "rgba(255,255,255,.12)",
              border: `2px solid ${C.lilac}66`,
              color: C.cream,
              fontFamily: F.mono,
              fontWeight: 700,
              fontSize: 26,
              opacity: f >= 26 + i * 5 ? 1 : 0,
              transform: `translateY(${interpolate(f - 26 - i * 5, [0, 5], [30, 0], clamp)}px)`,
            }}
          >
            {c}
          </span>
        ))}
      </div>
    </SceneRoot>
  );
};
