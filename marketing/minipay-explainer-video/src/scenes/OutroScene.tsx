import React from "react";
import { Img, staticFile } from "remotion";
import { C, F, SAFE } from "../theme";
import { CUES, UI, easeBack, easeOut, ls, prog, scene, wt } from "../cues";
import { Blobs } from "../ui";

const S = 330;
const SX = 0.528, SY = 0.515;
const PIECES = [
  { x0: 0, y0: 0, x1: SX, y1: SY, d: 0 }, { x0: SX, y0: 0, x1: 1, y1: SY, d: 0.1 },
  { x0: 0, y0: SY, x1: SX, y1: 1, d: 0.2 }, { x0: SX, y0: SY, x1: 1, y1: 1, d: 0.3 },
];
/** 1 Deploy. 2 Publish. 3 MiniPay. Then the logo and the address. */
export const OutroScene: React.FC<{ t: number }> = ({ t }) => {
  const s = scene("outro").start;
  const end = CUES.duration;
  const rows: [string, number, string, string][] = [
    ["1", wt("o1", /^Deploy\.?$/), C.cream, "DEPLOY."], ["2", wt("o1", /^Publish\.?$/), C.pink, "PUBLISH."], ["3", wt("o1", /^MiniPay\.?$/), C.lilac, "MINIPAY."],
  ];
  const tLogo = ls("o2");
  const compact = easeOut(prog(t, tLogo - 0.1, 0.5));
  const fade = prog(t, end - 0.9, 0.85);
  return (
    <div style={{ position: "absolute", inset: 0, background: C.ink, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: -300, top: 500, width: 1700, height: 1500, borderRadius: "50%", background: `radial-gradient(circle at 50% 40%, ${C.purple}cc 0%, ${C.deep}88 40%, transparent 70%)` }} />
      <div style={{ position: "absolute", left: SAFE.x, top: 290 - compact * 40, width: SAFE.w }}>
        {rows.map(([n, at, color, label], i) => {
          const p = easeBack(prog(t, at - 0.05, 0.32), 1.9);
          const size = 150 - compact * 62;
          return (
            <div key={n} style={{ display: "flex", alignItems: "baseline", gap: 26, height: size * 1.12, overflow: "hidden", opacity: t >= at - 0.05 ? 1 : 0, transform: `translateX(${(1 - p) * -700}px)` }}>
              <span style={{ fontFamily: F.slam, fontWeight: 900, fontSize: size, color: C.pink, lineHeight: 1.05, width: size * 0.78 }}>{n}</span>
              <span style={{ fontFamily: F.slam, fontWeight: 900, fontSize: size * 0.82, color, letterSpacing: "-0.03em", lineHeight: 1.05 }}>{label}</span>
            </div>
          );
        })}
      </div>
      {t >= tLogo - 0.05 && (
        <>
          <div style={{ position: "absolute", left: (1080 - S) / 2, top: 760 + Math.sin(t * 1.4) * 8, width: S, height: S, filter: `drop-shadow(0 40px 60px ${C.pink}55)` }}>
            {PIECES.map((p, i) => {
              const k = easeBack(prog(t, tLogo + p.d, 0.4), 2.4);
              return (
                <div key={i} style={{ position: "absolute", left: p.x0 * S, top: p.y0 * S, width: (p.x1 - p.x0) * S, height: (p.y1 - p.y0) * S, overflow: "hidden", transform: `scale(${k}) rotate(${(1 - k) * (i % 2 ? 40 : -40)}deg)`, opacity: t >= tLogo + p.d ? 1 : 0 }}>
                  <Img src={staticFile("logo-mark.png")} style={{ position: "absolute", width: S, height: S, left: -p.x0 * S, top: -p.y0 * S }} />
                </div>
              );
            })}
          </div>
          <div style={{ position: "absolute", left: SAFE.x, width: SAFE.w, top: 760 + S + 40, textAlign: "center", fontFamily: F.slam, fontWeight: 800, fontSize: 108, letterSpacing: "-0.03em", color: C.cream, opacity: prog(t, tLogo + 0.5, 0.3), transform: `translateY(${(1 - easeOut(prog(t, tLogo + 0.5, 0.4))) * 40}px)` }}>GoodBuildit</div>
          <div style={{ position: "absolute", left: SAFE.x, width: SAFE.w, top: 760 + S + 40 + 150, textAlign: "center", fontFamily: F.mono, fontWeight: 700, fontSize: 44, letterSpacing: "0.04em", color: C.lilac, opacity: prog(t, wt("o2", /^goodbuildit/i), 0.3) }}>{UI.domain}</div>
        </>
      )}
      <div style={{ position: "absolute", inset: 0, background: C.white, opacity: fade * 0 }} />
      <div style={{ position: "absolute", inset: 0, background: C.ink, opacity: fade }} />
    </div>
  );
};
