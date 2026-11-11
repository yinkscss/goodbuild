import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, F, SAFE, TL, sec } from "../theme";
import { clamp, fit, Grain, shake } from "../fx";

const S = 440; // logo size
const SX = 0.528; // where the 2x2 mark splits (fraction of the image)
const SY = 0.515;
const PIECES = [
  { x0: 0, y0: 0, x1: SX, y1: SY, from: [-900, -1100], rot: -140, delay: 0 },
  { x0: SX, y0: 0, x1: 1, y1: SY, from: [900, -900], rot: 120, delay: 2 },
  { x0: 0, y0: SY, x1: SX, y1: 1, from: [-900, 1000], rot: 160, delay: 4 },
  { x0: SX, y0: SY, x1: 1, y1: 1, from: [900, 1200], rot: -110, delay: 6 },
];
const LAND = 14;
const WORD_AT = 27;
const URL_AT = 48;
const CTA_AT = 78;

export const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const ot = TL.outro;
  const fadeFrom = sec(ot.fadeOutFrom - ot.start);
  const total = sec(ot.end - ot.start);
  const fade = interpolate(f, [fadeFrom, total - 2], [1, 0], { ...clamp, easing: Easing.in(Easing.quad) });

  const sk = shake(f - LAND, 16, 9, "outro");
  const landed = f >= LAND;
  const ring = interpolate(f, [LAND, LAND + 16], [0, 1], clamp);
  const float = landed ? Math.sin((f - LAND) / 20) * 8 : 0;
  const logoTop = SAFE.y + 265;
  const logoPunch = interpolate(f, [LAND, LAND + 5], [1.08, 1], { ...clamp, easing: Easing.out(Easing.exp) });

  const wm = ot.wordmark;
  const wmSize = fit(wm, F.slam, 800, 140);
  const ctaSize = Math.min(fit(ot.cta, F.serif, 400, 112, SAFE.w - 120, "italic"), 112);

  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      <AbsoluteFill style={{ opacity: fade }}>
        <AbsoluteFill style={{ background: `radial-gradient(80% 50% at 50% 42%, ${C.purple}, ${C.deep} 55%, ${C.ink} 100%)` }} />
        <div
          style={{
            position: "absolute",
            left: -360,
            top: logoTop - 560,
            width: 1800,
            height: 1800,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${C.pink}55 0%, ${C.lilac}33 20%, ${C.purple}22 40%, transparent 65%)`,
            opacity: interpolate(f, [LAND, LAND + 20], [0, 1], clamp),
          }}
        />
        {f < 1 && <AbsoluteFill style={{ background: C.cream }} />}

        {/* shockwave */}
        {landed && ring < 1 && (
          <div
            style={{
              position: "absolute",
              left: 540 - 600,
              top: logoTop + S / 2 - 600,
              width: 1200,
              height: 1200,
              borderRadius: "50%",
              border: `${interpolate(ring, [0, 1], [40, 2])}px solid ${C.pink}`,
              transform: `scale(${interpolate(ring, [0, 1], [0.2, 1.3], { easing: Easing.out(Easing.cubic) })})`,
              opacity: 1 - ring,
            }}
          />
        )}

        {/* logo build */}
        <div
          style={{
            position: "absolute",
            left: (1080 - S) / 2,
            top: logoTop,
            width: S,
            height: S,
            transform: `translate(${sk.x}px, ${sk.y + float}px) scale(${logoPunch})`,
          }}
        >
          {PIECES.map((p, i) => {
            const t = interpolate(f, [p.delay, LAND - 6 + p.delay * 0.75], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
            const x = p.from[0] * (1 - t);
            const y = p.from[1] * (1 - t);
            const r = p.rot * (1 - t);
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
                  transform: `translate(${x}px, ${y}px) rotate(${r}deg) scale(${0.6 + 0.4 * t})`,
                }}
              >
                <Img src={staticFile("logo-mark.png")} style={{ position: "absolute", width: S, height: S, left: -p.x0 * S, top: -p.y0 * S }} />
              </div>
            );
          })}
        </div>

        {/* wordmark: letters drop in */}
        <div
          style={{
            position: "absolute",
            left: SAFE.x,
            width: SAFE.w,
            top: logoTop + S + 70,
            display: "flex",
            justifyContent: "center",
            fontFamily: F.slam,
            fontWeight: 800,
            fontSize: wmSize,
            letterSpacing: "-0.03em",
            color: C.cream,
            lineHeight: 1,
          }}
        >
          {wm.split("").map((ch, i) => {
            const at = WORD_AT + i;
            const y = interpolate(f, [at, at + 5], [-140, 0], { ...clamp, easing: Easing.out(Easing.back(2)) });
            return (
              <span key={i} style={{ display: "inline-block", opacity: f >= at ? 1 : 0, transform: `translateY(${y}px)`, }}>
                {ch}
              </span>
            );
          })}
        </div>

        <div
          style={{
            position: "absolute",
            left: SAFE.x,
            width: SAFE.w,
            top: logoTop + S + 70 + wmSize * 1.25,
            textAlign: "center",
            fontFamily: F.mono,
            fontWeight: 700,
            fontSize: 46,
            color: C.lilac,
            letterSpacing: "0.04em",
            opacity: f >= URL_AT ? 1 : 0,
            transform: `scale(${interpolate(f, [URL_AT, URL_AT + 4], [1.25, 1], { ...clamp, easing: Easing.out(Easing.exp) })})`,
          }}
        >
          {ot.url}
        </div>

        <div
          style={{
            position: "absolute",
            left: SAFE.x,
            width: SAFE.w,
            top: logoTop + S + 70 + wmSize * 1.25 + 120,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 26,
            opacity: f >= CTA_AT ? 1 : 0,
            clipPath: `inset(0 ${interpolate(f, [CTA_AT, CTA_AT + 6], [100, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}% 0 0)`,
          }}
        >
          <span style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: ctaSize, color: C.pink, whiteSpace: "nowrap", lineHeight: 1.1 }}>{ot.cta}</span>
          <span
            style={{
              width: ctaSize * 0.8,
              height: ctaSize * 0.8,
              borderRadius: 99,
              background: C.pink,
              color: C.ink,
              display: "grid",
              placeItems: "center",
              fontFamily: F.ui,
              fontWeight: 700,
              fontSize: ctaSize * 0.42,
              flexShrink: 0,
              transform: `translateX(${Math.max(0, Math.sin((f - CTA_AT) / 6)) * 8}px)`,
            }}
          >
            →
          </span>
        </div>
        <Grain opacity={0.12} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
