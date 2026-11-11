import React from "react";
import { Easing, interpolate } from "remotion";
import { F, SAFE } from "../theme";
import { clamp, fit } from "../fx";

/** Display headline that lands on frame `at` with a short drop + overshoot, and an italic answer under it. */
export const Headline: React.FC<{
  f: number;
  h: string;
  a?: string;
  hColor: string;
  aColor: string;
  top?: number;
  at?: number;
  aAt?: number;
  maxH?: number;
  maxA?: number;
}> = ({ f, h, a, hColor, aColor, top = SAFE.y + 20, at = 0, aAt = 6, maxH = 170, maxA = 120 }) => {
  const hs = fit(h, F.slam, 900, maxH, SAFE.w / 1.06);
  const as = a ? fit(a, F.serif, 400, maxA, SAFE.w, "italic") : 0;
  const lf = f - at;
  if (lf < 0) return null;
  const words = h.split(" ");
  return (
    <div style={{ position: "absolute", left: SAFE.x, top, width: SAFE.w }}>
      <div style={{ fontFamily: F.slam, fontWeight: 900, fontSize: hs, lineHeight: 1.02, letterSpacing: "-0.03em", color: hColor, whiteSpace: "nowrap" }}>
        {words.map((w, i) => {
          const wf = lf - i * 2;
          const y = interpolate(wf, [0, 5], [hs * 0.9, 0], { ...clamp, easing: Easing.out(Easing.back(1.8)) });
          return (
            <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingRight: i < words.length - 1 ? hs * 0.28 : 0 }}>
              <span style={{ display: "inline-block", transform: `translateY(${y}px)`, opacity: wf >= 0 ? 1 : 0 }}>{w}</span>
            </span>
          );
        })}
      </div>
      {a && (
        <div
          style={{
            fontFamily: F.serif,
            fontStyle: "italic",
            fontSize: as,
            lineHeight: 1.1,
            color: aColor,
            whiteSpace: "nowrap",
            marginTop: 6,
            clipPath: `inset(0 ${interpolate(lf, [aAt, aAt + 6], [100, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}% 0 0)`,
          }}
        >
          {a}
        </div>
      )}
    </div>
  );
};

/** Soft blurred colour blobs for light backgrounds. */
export const Blobs: React.FC<{ f: number; colors: string[]; seed?: number }> = ({ f, colors, seed = 0 }) => (
  <>
    {colors.map((c, i) => {
      const a = (i + seed) * 2.1;
      const x = 540 + Math.cos(a + f / 90) * 380 - 600;
      const y = 960 + Math.sin(a * 1.3 + f / 110) * 640 - 600;
      return (
        <div
          key={i}
          style={{ position: "absolute", left: x, top: y, width: 1200, height: 1200, borderRadius: "50%", background: `radial-gradient(circle, ${c} 0%, transparent 62%)` }}
        />
      );
    })}
  </>
);

/** Scene root whose background runs far past the frame, so a scene seen through a portal has no edges. */
export const SceneRoot: React.FC<{ base: string; bg?: string; children: React.ReactNode }> = ({ base, bg, children }) => (
  <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920 }}>
    <div style={{ position: "absolute", left: -4000, top: -4000, right: -4000, bottom: -4000, background: base }} />
    {bg && <div style={{ position: "absolute", left: -540, top: -960, width: 2160, height: 3840, background: bg }} />}
    {children}
  </div>
);
