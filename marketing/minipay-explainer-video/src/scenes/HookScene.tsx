import React from "react";
import { C, F, SAFE } from "../theme";
import { easeBack, easeOut, le, ls, prog, scene, wt } from "../cues";
import { Racer } from "../visuals/Racer";

/** Dark open: a finished game, and the question every builder asks next. */
export const HookScene: React.FC<{ t: number }> = ({ t }) => {
  const s = scene("hook").start;
  const f = (t - s) * 30;
  const t3 = ls("h3");
  const move = easeOut(prog(t, t3 - 0.1, 0.5));
  const showQ = t >= t3;
  const card = { w: 400, h: 506 };
  const cardX = 540 - card.w / 2 - move * 250;
  const stage = (text: string, t0: number, color: string, size: number, serif = false) => {
    const words = text.split(" ");
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: `0 ${size * 0.28}px`, fontFamily: serif ? F.serif : F.slam, fontStyle: serif ? "italic" : "normal", fontWeight: serif ? 400 : 900, fontSize: size, lineHeight: serif ? 1.02 : 1.06, letterSpacing: serif ? 0 : "-0.03em", color }}>
        {words.map((w, i) => {
          const at = t0 + i * 0.11;
          const p = easeBack(prog(t, at, 0.28), 2.2);
          return (
            <span key={i} style={{ display: "inline-block", opacity: t >= at ? 1 : 0, transform: `translateY(${(1 - p) * size * 0.8}px) scale(${0.85 + 0.15 * p})` }}>
              {w}
            </span>
          );
        })}
      </div>
    );
  };
  const t1 = ls("h1"), t2 = ls("h2");
  return (
    <div style={{ position: "absolute", inset: 0, background: C.ink, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: -300, top: 700, width: 1700, height: 1500, borderRadius: "50%", background: `radial-gradient(circle at 50% 40%, ${C.pink}55 0%, ${C.purple}88 28%, ${C.deep}55 50%, transparent 70%)`, opacity: 0.9 }} />
      <div style={{ position: "absolute", left: SAFE.x, top: 270, width: SAFE.w, height: 560 }}>
        {t < t2 && stage("YOU JUST BUILT A GAME.", t1 - 0.02, C.cream, 128)}
        {t >= t2 && t < t3 && stage("IT LOOKS GREAT. IT RUNS.", t2 - 0.02, C.pink, 118)}
        {t >= t3 && stage("how do I get it onto MiniPay?", t3 - 0.02, C.cream, 124, true)}
      </div>
      {/* the game */}
      <div style={{ position: "absolute", left: cardX, top: 900, width: card.w, height: card.h, transform: `rotate(${-4 + move * 2}deg) scale(${easeBack(prog(t, s + 0.1, 0.45), 1.6)})`, borderRadius: 36, overflow: "hidden", boxShadow: `0 0 0 6px ${C.lilac}44, 0 50px 120px -20px ${C.pink}99` }}>
        <Racer f={f} width={card.w} height={card.h} radius={36} />
      </div>
      {/* the question */}
      {showQ && (() => {
        const p = easeBack(prog(t, t3 + 0.25, 0.4), 1.8);
        const dash = 1 - easeOut(prog(t, t3 + 0.1, 0.6));
        return (
          <>
            <svg style={{ position: "absolute", left: 0, top: 0 }} width={1080} height={1920}>
              <path d="M 520 1150 C 560 1030, 640 1030, 690 1140" stroke={C.pink} strokeWidth="6" strokeLinecap="round" strokeDasharray="14 16" fill="none" strokeDashoffset={dash * 400} opacity={1 - dash} />
            </svg>
            <div style={{ position: "absolute", left: 700, top: 900, width: 300, height: 506, borderRadius: 40, border: `5px dashed ${C.lilac}88`, background: "rgba(255,255,255,.06)", transform: `scale(${p})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
              <div style={{ fontFamily: F.slam, fontWeight: 800, fontSize: 40, color: C.cream, letterSpacing: "-0.03em" }}>MiniPay</div>
              <div style={{ fontFamily: F.slam, fontWeight: 900, fontSize: 170, color: C.pink, lineHeight: 1 }}>?</div>
            </div>
          </>
        );
      })()}
      {[0, 1, 2, 3].map((i) => {
        if (!showQ) return null;
        const at = t3 + 0.3 + i * 0.22;
        const p = prog(t, at, 0.5);
        const x = [120, 330, 880, 960][i], y = [880, 1500, 860, 1400][i];
        return <div key={i} style={{ position: "absolute", left: x, top: y - p * 60 + Math.sin(t * 2 + i) * 8, fontFamily: F.slam, fontWeight: 900, fontSize: [90, 60, 70, 100][i], color: i % 2 ? C.lilac : C.pink, opacity: t >= at ? 0.5 * (1 - 0.3 * p) : 0, transform: `rotate(${[-14, 10, 16, -8][i]}deg)` }}>?</div>;
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4 }} />
    </div>
  );
};
