import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile } from "remotion";
import { C, F, SAFE, TL } from "../theme";
import { clamp, fit } from "../fx";
import type { SceneProps } from "../Video";
import { Blobs, SceneRoot } from "./common";

const S = 460;
const SX = 0.528;
const SY = 0.515;
const PIECES = [
  { x0: 0, y0: 0, x1: SX, y1: SY, delay: 0 },
  { x0: SX, y0: 0, x1: 1, y1: SY, delay: 3 },
  { x0: 0, y0: SY, x1: SX, y1: 1, delay: 6 },
  { x0: SX, y0: SY, x1: 1, y1: 1, delay: 9 },
];
const WORD_AT = 20;
const URL_AT = 36;
const CTA_AT = 52;

export const OutroScene: React.FC<SceneProps> = ({ f, spec }) => {
  const total = (spec.end - spec.start) * TL.fps;
  const fadeFrom = (spec.fadeOutFrom - spec.start) * TL.fps;
  const fade = interpolate(f, [fadeFrom, total - 1], [0, 1], clamp);
  const logoTop = 470;
  const wm = fit(spec.wordmark, F.slam, 800, 150);
  const cta = Math.min(96, fit(spec.cta, F.serif, 400, 96, SAFE.w - 110, "italic"));
  const float = Math.sin(f / 22) * 8;

  return (
    <SceneRoot base={C.cream}>
      <Blobs f={f} colors={[`${C.lilac}99`, `${C.pink}44`, C.white]} seed={3} />
      <div style={{ position: "absolute", left: (1080 - S) / 2, top: logoTop + float, width: S, height: S, filter: "drop-shadow(0 50px 60px rgba(89,46,129,.35))" }}>
        {PIECES.map((p, i) => {
          const s = interpolate(f, [p.delay, p.delay + 9], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2.6)) });
          const r = interpolate(f, [p.delay, p.delay + 9], [i % 2 ? 40 : -40, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: p.x0 * S,
                top: p.y0 * S,
                width: (p.x1 - p.x0) * S,
                height: (p.y1 - p.y0) * S,
                overflow: "hidden",
                transform: `scale(${s}) rotate(${r}deg)`,
              }}
            >
              <Img src={staticFile("logo-mark.png")} style={{ position: "absolute", width: S, height: S, left: -p.x0 * S, top: -p.y0 * S }} />
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: SAFE.x, width: SAFE.w, top: logoTop + S + 80, display: "flex", justifyContent: "center", fontFamily: F.slam, fontWeight: 800, fontSize: wm, letterSpacing: "-0.03em", color: C.ink, lineHeight: 1 }}>
        {(spec.wordmark as string).split("").map((ch, i) => {
          const at = WORD_AT + i;
          return (
            <span key={i} style={{ display: "inline-block", opacity: f >= at ? 1 : 0, transform: `translateY(${interpolate(f, [at, at + 6], [60, 0], { ...clamp, easing: Easing.out(Easing.back(2)) })}px)` }}>
              {ch}
            </span>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: SAFE.x, width: SAFE.w, top: logoTop + S + 80 + wm * 1.3, textAlign: "center", fontFamily: F.mono, fontWeight: 700, fontSize: 44, color: C.purple, letterSpacing: "0.04em", opacity: f >= URL_AT ? 1 : 0 }}>
        {spec.url}
      </div>
      <div
        style={{
          position: "absolute",
          left: SAFE.x,
          width: SAFE.w,
          top: logoTop + S + 80 + wm * 1.3 + 110,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 24,
          clipPath: `inset(0 ${interpolate(f, [CTA_AT, CTA_AT + 8], [100, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}% 0 0)`,
        }}
      >
        <span style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: cta, color: C.purple, whiteSpace: "nowrap", lineHeight: 1.1 }}>{spec.cta}</span>
        <span style={{ width: cta * 0.78, height: cta * 0.78, borderRadius: 99, background: C.pink, display: "grid", placeItems: "center", fontFamily: F.ui, fontWeight: 700, fontSize: cta * 0.4, color: C.ink, flexShrink: 0 }}>→</span>
      </div>
      <AbsoluteFill style={{ background: C.white, opacity: fade }} />
    </SceneRoot>
  );
};
