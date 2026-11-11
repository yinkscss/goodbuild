import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, SAFE, TL } from "../theme";
import { Chroma, clamp, fit, Grain, punch, shake } from "../fx";

const LOOK = [
  { bg: C.purple, fg: C.cream, flash: C.pink },
  { bg: C.pink, fg: C.ink, flash: C.cream },
  { bg: C.cream, fg: C.purple, flash: C.ink },
  { bg: C.ink, fg: C.pink, flash: C.lilac },
];

/** YOU / CAN / BUILD / GAMES: one per beat, the word stacked as a poster. */
export const Slams: React.FC = () => {
  const frame = useCurrentFrame();
  const words = TL.slams.words;
  const step = ((TL.slams.end - TL.slams.start) / words.length) * TL.fps;
  const i = Math.min(words.length - 1, Math.floor(frame / step));
  const f = frame - Math.round(i * step);
  const word = words[i];
  const base = LOOK[i % LOOK.length];
  // frame 0 of each slam is an inverted flash frame: the word lands ON the beat
  const look = f === 0 ? { ...base, bg: base.flash, fg: base.bg } : base;

  const PUNCH = 1.12; // peak scale; text is fitted so even the peak stays inside the safe area
  const size = fit(word, F.slam, 900, 400, SAFE.w / PUNCH);
  const rowH = size * 0.92;
  const top = SAFE.y + 110; // under the counter
  const avail = SAFE.y + SAFE.h - top;
  let rows = Math.floor(avail / rowH);
  if (rows % 2 === 0) rows -= 1;
  const mid = (rows - 1) / 2;
  const blockTop = top + (avail - rows * rowH) / 2;

  const sk = shake(f, 14, 10, `slam${i}`);
  const sc = punch(f, PUNCH, 3);

  return (
    <AbsoluteFill style={{ background: look.bg, overflow: "hidden" }}>
      {/* counter */}
      <div style={{ position: "absolute", left: SAFE.x, top: SAFE.y, width: SAFE.w, display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 40, color: look.fg, letterSpacing: "0.04em" }}>
          {String(i + 1).padStart(2, "0")} / {String(words.length).padStart(2, "0")}
        </div>
        <div style={{ flex: 1, display: "flex", gap: 10 }}>
          {words.map((_, k) => (
            <div key={k} style={{ flex: 1, height: 10, borderRadius: 99, background: look.fg, opacity: k <= i ? 1 : 0.2 }} />
          ))}
        </div>
      </div>

      <AbsoluteFill style={{ transform: `translate(${sk.x}px, ${sk.y}px) rotate(${sk.r}deg)` }}>
        {Array.from({ length: rows }).map((_, r) => {
          const dist = Math.abs(r - mid);
          const show = f >= dist; // ripple out from the centre, one row per frame
          if (!show) return null;
          const isMid = r === mid;
          const local = f - dist;
          const y = blockTop + r * rowH;
          const style: React.CSSProperties = {
            fontFamily: F.slam,
            fontWeight: 900,
            fontSize: size,
            lineHeight: `${rowH}px`,
            letterSpacing: "-0.03em",
            textAlign: "center",
            width: SAFE.w,
          };
          return (
            <div
              key={r}
              style={{
                position: "absolute",
                left: SAFE.x,
                top: y,
                width: SAFE.w,
                height: rowH,
                transform: `scale(${isMid ? sc : interpolate(local, [0, 3], [0.7, 1], clamp)})`,
              }}
            >
              {isMid ? (
                <Chroma f={f} style={{ ...style, color: look.fg }} a={C.pink === look.bg ? C.cream : C.pink} b={C.lilac} dist={34}>
                  {word}
                </Chroma>
              ) : (
                <div
                  style={{
                    ...style,
                    color: look.fg,
                    opacity: interpolate(dist, [1, mid || 1], [0.22, 0.07], clamp),
                  }}
                >
                  {word}
                </div>
              )}
            </div>
          );
        })}
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};
