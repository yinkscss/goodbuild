import React from "react";
import { C, F, SAFE, shadowCard } from "../theme";
import { easeBack, easeOut, le, ls, prog, scene, wt } from "../cues";
import { Blobs, Tick } from "../ui";
import { Racer } from "../visuals/Racer";

const CHECKS = [
  { text: "No login signature", at: () => wt("w3", /^built$/) },
  { text: "No connect button", at: () => wt("w3", /that,?$/) },
  { text: "Plain transactions", at: () => wt("w3", /^GoodBuild$/) },
  { text: "MiniPay footer included", at: () => wt("w3", /^way\.?$/) },
];

/** What MiniPay is, why it's different, and the three steps. */
export const WhatScene: React.FC<{ t: number }> = ({ t }) => {
  const s = scene("what").start;
  const f = (t - s) * 30;
  const w3 = ls("w3");
  const w4 = ls("w4");
  const inW4 = t >= w4 - 0.05;
  const phone = { w: 400, h: 800 };
  const enter = easeBack(prog(t, s + 0.05, 0.5), 1.5);
  // phone drifts left when the checks arrive, then leaves for the 3 steps
  const shiftL = easeOut(prog(t, w3 - 0.1, 0.5)) * 190;
  const leave = easeOut(prog(t, w4 - 0.15, 0.45));
  const px = 540 - phone.w / 2 - shiftL - leave * 900;
  return (
    <div style={{ position: "absolute", inset: 0, background: C.lilacSoft, overflow: "hidden" }}>
      <Blobs t={t} colors={[`${C.pink}55`, C.white, `${C.lilac}`]} seed={2} />
      {/* phone */}
      <div style={{ position: "absolute", left: px, top: 340 + (1 - enter) * 700, width: phone.w, height: phone.h, borderRadius: 64, background: C.ink, padding: 14, boxSizing: "border-box", boxShadow: `0 0 0 3px ${C.purple}, 0 70px 120px -40px ${C.purple}`, transform: `rotate(${-3 + 3 * enter}deg)` }}>
        <div style={{ width: "100%", height: "100%", borderRadius: 52, background: C.cream, overflow: "hidden", position: "relative" }}>
          <div style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ width: 100, height: 28, borderRadius: 99, background: C.ink }} /></div>
          <div style={{ margin: "6px 16px", height: 64, borderRadius: 99, background: C.white, display: "flex", alignItems: "center", padding: "0 22px", gap: 10, boxShadow: "0 10px 24px -12px rgba(89,46,129,.45)" }}>
            <span style={{ fontFamily: F.slam, fontWeight: 800, fontSize: 24 }}>MiniPay</span>
            <span style={{ marginLeft: "auto", fontFamily: F.mono, fontWeight: 700, fontSize: 20, color: C.purple }}>$12.40</span>
          </div>
          <div style={{ margin: "10px 16px 0", borderRadius: 26, overflow: "hidden", height: 500 }}>
            <Racer f={f + 60} width={368} height={500} radius={26} />
          </div>
          <div style={{ position: "absolute", left: 16, right: 16, bottom: 22, height: 64, borderRadius: 99, background: C.purple, color: C.cream, fontFamily: F.ui, fontWeight: 700, fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <span style={{ width: 12, height: 12, borderRadius: 99, background: C.pink }} />wallet connected
          </div>
        </div>
      </div>

      {/* w1: dollar coins */}
      {[["USDT", C.lilac, "#fff"], ["USDC", C.purple, C.cream], ["USDm", C.pink, C.ink]].map(([n, bg, fg], i) => {
        const at = wt("w1", /dollar/i) + i * 0.16;
        const p = easeBack(prog(t, at, 0.4), 2.2);
        const gone = easeOut(prog(t, ls("w2") - 0.1, 0.3));
        return (
          <div key={n} style={{ position: "absolute", left: [800, 820, 800][i], top: [420, 600, 780][i] + Math.sin(t * 2 + i) * 8, width: 150, height: 150, borderRadius: 99, background: bg, color: fg, display: "grid", placeItems: "center", fontFamily: F.slam, fontWeight: 900, fontSize: 34, transform: `scale(${p * (1 - gone)}) rotate(${[-10, 8, -4][i]}deg)`, boxShadow: "0 30px 60px -24px rgba(89,46,129,.6)", opacity: t >= at ? 1 : 0 }}>{n}</div>
        );
      })}
      {/* w2: struck-through chips + the wallet that is just there */}
      {t >= ls("w2") && t < w3 + 0.2 && (
        <div style={{ position: "absolute", left: 540 - 360, top: 1150 }}>
          {[["Sign up", wt("w2", /sign-up/)], ["Connect wallet", wt("w2", /^connect$/)]].map(([label, at], i) => {
            const a = at as number;
            const p = easeBack(prog(t, a - 0.1, 0.35), 2);
            const strike = easeOut(prog(t, a + 0.25, 0.25));
            return (
              <div key={i} style={{ display: "inline-flex", position: "relative", marginRight: 22, transform: `scale(${p})`, opacity: t >= a - 0.1 ? 1 : 0 }}>
                <div style={{ padding: "22px 40px", borderRadius: 99, background: C.white, fontFamily: F.ui, fontWeight: 700, fontSize: 38, color: "rgba(17,17,17,.7)", boxShadow: shadowCard }}>{label}</div>
                <div style={{ position: "absolute", left: 28, top: "50%", height: 8, width: `calc((100% - 56px) * ${strike})`, background: C.pink, borderRadius: 4, transform: "rotate(-3deg)" }} />
              </div>
            );
          })}
          {(() => {
            const a = wt("w2", /^wallet$/);
            const p = easeBack(prog(t, a, 0.4), 2);
            return <div style={{ marginTop: 28, display: "inline-flex", alignItems: "center", gap: 16, padding: "24px 44px", borderRadius: 99, background: C.purple, color: C.cream, fontFamily: F.ui, fontWeight: 700, fontSize: 40, transform: `scale(${p})`, opacity: t >= a ? 1 : 0, boxShadow: `0 30px 60px -24px ${C.purple}` }}><span style={{ width: 18, height: 18, borderRadius: 99, background: C.pink }} />The wallet is just there</div>;
          })()}
        </div>
      )}
      {/* w3: what GoodBuild checks */}
      {t >= w3 - 0.05 && !inW4 && (
        <div style={{ position: "absolute", left: 560, top: 400, width: 434, borderRadius: 40, background: C.white, boxShadow: shadowCard, padding: "34px 30px", transform: `translateX(${(1 - easeOut(prog(t, w3, 0.4))) * 300}px)`, opacity: easeOut(prog(t, w3, 0.3)) }}>
          <div style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 22, letterSpacing: "0.16em", color: C.purple, marginBottom: 20 }}>GOODBUILD CHECKS</div>
          {CHECKS.map((c, i) => {
            const a = c.at();
            const p = easeBack(prog(t, a, 0.3), 2.4);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, height: 92, borderTop: i ? "2px solid rgba(17,17,17,.05)" : "none", fontFamily: F.ui, fontWeight: 700, fontSize: 28, color: C.ink }}>
                <span style={{ transform: `scale(${p})`, opacity: t >= a ? 1 : 0 }}><Tick size={44} /></span>
                <span style={{ opacity: t >= a ? 1 : 0.35 }}>{c.text}</span>
              </div>
            );
          })}
        </div>
      )}
      {/* w4: three steps */}
      {inW4 && ["Deploy a contract", "Publish", "Go to MiniPay"].map((label, i) => {
        const at = [wt("w4", /whole/), wt("w4", /^three$/), wt("w4", /steps/)][i];
        const p = easeBack(prog(t, at - 0.05, 0.4), 1.8);
        return (
          <div key={label} style={{ position: "absolute", left: SAFE.x, width: SAFE.w, top: 330 + i * 360, height: 320, borderRadius: 48, background: [C.purple, C.white, C.ink][i], color: [C.cream, C.ink, C.cream][i], boxShadow: shadowCard, display: "flex", alignItems: "center", padding: "0 52px", gap: 36, transform: `translateX(${(1 - p) * (i % 2 ? 900 : -900)}px)`, opacity: t >= at - 0.05 ? 1 : 0 }}>
            <span style={{ fontFamily: F.slam, fontWeight: 900, fontSize: 200, color: C.pink, lineHeight: 1 }}>{i + 1}</span>
            <span style={{ fontFamily: F.slam, fontWeight: 800, fontSize: 56, letterSpacing: "-0.03em", lineHeight: 1.05 }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
};
