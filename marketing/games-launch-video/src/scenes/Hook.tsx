import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { C, F, SAFE, TL } from "../theme";
import { clamp, fit } from "../fx";

const hk = TL.hook;
const FPS = TL.fps;

const typed = (text: string, at: number, t: number) => {
  if (t < at) return "";
  const n = Math.floor((t - at) / hk.charDur) + 1;
  return text.slice(0, n);
};

export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const end = hk.end - hk.start;
  const glitchFrom = end - 0.33;
  const blackFrom = end - 0.07;

  const [l1, l2, l3] = hk.lines;
  const s1 = typed(l1.text, l1.at, t);
  const s2 = typed(l2.text, l2.at, t);
  const s3 = typed(l3.text, l3.at, t);

  // which line owns the caret
  const active = t >= l3.at ? 3 : t >= l2.at ? 2 : 1;
  const caretOn = Math.floor(f / 8) % 2 === 0 || (active === 1 && s1.length < l1.text.length) || (active === 2 && s2.length < l2.text.length) || (active === 3 && s3.length < l3.text.length);

  const serifSize = Math.min(fit(l2.text, F.serif, 400, 210, SAFE.w, "italic"), fit(l3.text, F.serif, 400, 210, SAFE.w, "italic"));

  const glitch = t >= glitchFrom && t < blackFrom;
  const gx = glitch ? (random(`hgx${f}`) - 0.5) * 60 : 0;
  const gs = glitch ? 1 + random(`hgs${f}`) * 0.08 : 1;

  // slow push-in on the whole hook
  const push = interpolate(t, [0, end], [1, 1.06], clamp);
  const glowO = interpolate(t, [0, 1.5, end], [0, 0.5, 0.75], clamp);

  const caret = (color: string, h: number) => (
    <span style={{ display: "inline-block", width: h * 0.08, height: h * 0.82, background: color, marginLeft: h * 0.06, transform: `translateY(${h * 0.1}px)`, opacity: caretOn ? 1 : 0 }} />
  );

  if (t >= blackFrom) return <AbsoluteFill style={{ background: "#000" }} />;

  const content = (
    <AbsoluteFill style={{ transform: `translateX(${gx}px) scale(${push * gs})`, filter: glitch ? `drop-shadow(${-14 - Math.abs(gx) * 0.3}px 0 0 ${C.pink}) drop-shadow(${14 + Math.abs(gx) * 0.3}px 0 0 ${C.lilac})` : undefined }}>
      <div style={{ position: "absolute", left: SAFE.x, top: 640, width: SAFE.w }}>
        <div style={{ fontFamily: F.mono, fontWeight: 500, fontSize: 44, color: C.lilac, letterSpacing: "0.02em", height: 60 }}>
          {s1}
          {active === 1 && caret(C.lilac, 44)}
        </div>
        <div
          style={{
            height: 3,
            marginTop: 18,
            background: C.lilac,
            opacity: 0.35,
            width: `${interpolate(t, [l1.at, l1.at + 1.2], [0, 100], clamp)}%`,
          }}
        />
        <div style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: serifSize, color: C.cream, lineHeight: 1.05, marginTop: 56, height: serifSize * 1.1, whiteSpace: "nowrap" }}>
          {s2}
          {active === 2 && caret(C.cream, serifSize)}
        </div>
        <div style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: serifSize, color: C.pink, lineHeight: 1.05, height: serifSize * 1.1, whiteSpace: "nowrap" }}>
          {s3}
          {active === 3 && caret(C.pink, serifSize)}
        </div>
      </div>
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      {/* deep glass glow */}
      <div
        style={{
          position: "absolute",
          width: 1500,
          height: 1500,
          left: 60,
          top: 900,
          borderRadius: "50%",
          background: `radial-gradient(circle at 45% 45%, ${C.pink}66 0%, ${C.purple}88 22%, ${C.deep}66 45%, transparent 70%)`,
          opacity: glowO,
          transform: `translate(${Math.sin(t / 1.3) * 40}px, ${-t * 18}px)`,
        }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(120% 70% at 30% 35%, transparent 40%, rgba(0,0,0,.55) 100%)" }} />
      {content}
      {glitch &&
        Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: random(`hb${f}${i}`) * 1920,
              height: 8 + random(`hh${f}${i}`) * 60,
              background: i % 2 ? C.pink : C.lilac,
              opacity: 0.85,
              mixBlendMode: "difference",
              transform: `translateX(${(random(`hbx${f}${i}`) - 0.5) * 200}px)`,
            }}
          />
        ))}
    </AbsoluteFill>
  );
};

