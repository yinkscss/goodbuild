import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { C, CardSpec, F, SAFE, THEMES, TL } from "../theme";
import { Chroma, clamp, fit, Grain, punch, shake } from "../fx";
import { Arcade } from "../visuals/Arcade";
import { Tiles3D } from "../visuals/Tiles3D";
import { Phone } from "../visuals/Phone";
import { Wallets } from "../visuals/Wallets";
import { Contract } from "../visuals/Contract";
import { UrlBar } from "../visuals/UrlBar";
import { Chain } from "../visuals/Chain";

export type VisualProps = { f: number; spec: CardSpec; theme: (typeof THEMES)[string]; w: number; h: number };

const VISUALS: Record<string, React.FC<VisualProps>> = {
  arcade: ({ f, w, h }) => <Arcade f={f} size={Math.min(w - 60, h - 30, 760)} framed />,
  tiles3d: Tiles3D,
  phone: Phone,
  wallets: Wallets,
  contract: Contract,
  url: UrlBar,
  chain: Chain,
};

const ANSWER_AT = 5; // frames after the cut
const VISUAL_AT = 2;
const LABEL_AT = 12;

export const Card: React.FC<{ spec: CardSpec; index: number; total: number }> = ({ spec, index, total }) => {
  const f = useCurrentFrame();
  const base = THEMES[spec.theme];
  const theme = f === 0 ? { ...base, bg: base.flash, q: base.bg } : base;

  const PUNCH = 1.1;
  const qSize = fit(spec.q, F.slam, 900, 270, SAFE.w / PUNCH);
  const aSize = fit(spec.a, F.serif, 400, 150, SAFE.w, "italic");
  const sk = shake(f, 12, 8, spec.id);

  const headerH = 48;
  const qH = qSize * 0.98;
  const aH = aSize * 1.12;
  const labelH = spec.label ? 64 : 0;
  const gap = 34;
  const visH = SAFE.h - headerH - gap - qH - 8 - aH - gap - labelH - (spec.label ? 20 : 0);

  const aReveal = interpolate(f, [ANSWER_AT, ANSWER_AT + 4], [100, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const labelChars = Math.max(0, Math.floor((f - LABEL_AT) * 1.6));
  const V = VISUALS[spec.visual];
  const durF = (spec.end - spec.start) * TL.fps;

  return (
    <AbsoluteFill style={{ background: theme.bg, overflow: "hidden" }}>
      {/* giant rotating tile outline: the logo's geometry as backdrop */}
      <div
        style={{
          position: "absolute",
          width: 1500,
          height: 1500,
          left: -210,
          top: 520,
          borderRadius: 340,
          border: `46px solid ${base.q}`,
          opacity: 0.06,
          transform: `rotate(${12 + f * 0.35}deg) scale(${interpolate(f, [0, durF], [1, 1.12])})`,
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(90% 55% at 50% 62%, ${base.accent}22, transparent 70%)` }} />

      <div
        style={{
          position: "absolute",
          left: SAFE.x,
          top: SAFE.y,
          width: SAFE.w,
          height: SAFE.h,
          display: "flex",
          flexDirection: "column",
          transform: `translate(${sk.x}px, ${sk.y}px)`,
        }}
      >
        <div style={{ height: headerH, display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: F.mono, fontWeight: 700, fontSize: 30, color: theme.q, letterSpacing: "0.06em" }}>
          <span>
            {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 12, opacity: 0.85 }}>
            <span style={{ width: 14, height: 14, borderRadius: 99, background: base.accent }} />
            GoodBuildit
          </span>
        </div>
        <div style={{ height: gap }} />
        <div style={{ height: qH, display: "flex", alignItems: "center", transform: `scale(${punch(f, PUNCH, 3)})`, transformOrigin: "left center" }}>
          <Chroma f={f} dist={30} a={base.bg === C.pink ? C.cream : C.pink} b={base.bg === C.lilac ? C.cream : C.lilac} style={{ fontFamily: F.slam, fontWeight: 900, fontSize: qSize, lineHeight: 1, letterSpacing: "-0.03em", color: theme.q }}>
            {spec.q}
          </Chroma>
        </div>
        <div style={{ height: 8 }} />
        <div
          style={{
            height: aH,
            fontFamily: F.serif,
            fontStyle: "italic",
            fontSize: aSize,
            lineHeight: 1.05,
            color: theme.a,
            whiteSpace: "nowrap",
            clipPath: `inset(0 ${aReveal}% 0 0)`,
            opacity: f >= ANSWER_AT ? 1 : 0,
          }}
        >
          {spec.a}
        </div>
        <div style={{ height: gap }} />
        <div style={{ height: visH, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {f >= VISUAL_AT && <V f={f - VISUAL_AT} spec={spec} theme={base} w={SAFE.w} h={visH} />}
        </div>
        {spec.label ? (
          <>
            <div style={{ height: 20 }} />
            <div style={{ height: labelH, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontFamily: F.mono, fontWeight: 500, fontSize: 34, color: base.label, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
                {spec.label.slice(0, labelChars)}
                {labelChars < spec.label.length && f >= LABEL_AT && <span style={{ opacity: 0.6 }}>▍</span>}
              </div>
            </div>
          </>
        ) : null}
      </div>
      <Grain opacity={base.bg === C.ink || base.bg === C.purple ? 0.14 : 0.1} />
    </AbsoluteFill>
  );
};
