import React from "react";
import { C, F, SAFE } from "../theme";
import { UI, easeBack, easeOut, ls, prog, scene, wt } from "../cues";
import { Blobs, Tap } from "../ui";
import { Racer } from "../visuals/Racer";

const PH = { x: 280, y: 345, w: 520, h: 1040 };
const SC = { x: PH.x + 16, y: PH.y + 16, w: PH.w - 32, h: PH.h - 32 };

const Toggle: React.FC<{ on: number }> = ({ on }) => (
  <span style={{ width: 92, height: 52, borderRadius: 99, background: on > 0.5 ? C.purple : "#D9D2E3", position: "relative", flexShrink: 0 }}>
    <span style={{ position: "absolute", top: 5, left: 5 + on * 40, width: 42, height: 42, borderRadius: 99, background: "#fff", boxShadow: "0 3px 8px rgba(0,0,0,.25)" }} />
  </span>
);
const ListRow: React.FC<{ children: React.ReactNode; hl?: number; right?: React.ReactNode }> = ({ children, hl = 0, right }) => (
  <div style={{ height: 96, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 30px", borderTop: "2px solid rgba(17,17,17,.06)", background: `rgba(255,133,217,${0.22 * hl})`, fontFamily: F.ui, fontWeight: 600, fontSize: 30, color: C.ink }}>
    <span>{children}</span>{right ?? <span style={{ color: "rgba(17,17,17,.3)" }}>›</span>}
  </div>
);

/** A phone walking through MiniPay's developer settings to the app running inside it. */
export const MiniPayScene: React.FC<{ t: number }> = ({ t }) => {
  const s = scene("minipay").start;
  const f = (t - s) * 30;
  const enter = easeBack(prog(t, s + 0.05, 0.5), 1.5);
  const tDevSet = wt("m2", /^Developer$/, 0), tDevMode = wt("m2", /^Mode\.?$/), tTest = wt("m2", /^Testnet$/);
  const tLoad = wt("m3", /^Load$/), tPaste = wt("m3", /^paste$/), tGo = wt("m3", /^Go\.?$/);
  const tApp = ls("m4"), tList = wt("m4", /^list\.?$/), tLogin = wt("m4", /^login/);
  // screen index: 0 settings, 1 developer settings, 2 load test page, 3 the app
  const tB = tDevSet + 0.55, tBt = tDevMode - 0.7;
  const goToB = tDevSet + 0.5, goToC = tLoad + 0.55, goToD = tGo + 0.5;
  const slide = (t0: number) => easeOut(prog(t, t0, 0.35));
  const x1 = slide(goToB), x2 = slide(goToC), x3 = slide(goToD);
  const idx = x1 + x2 + x3; // 0..3, fractional while sliding
  const url = `https://${UI.slug}.${UI.domain}`;
  const typed = Math.floor(prog(t, tPaste, 0.55) * url.length + 0.001);
  const modeOn = easeOut(prog(t, tDevMode + 0.1, 0.2));
  const testOn = easeOut(prog(t, tTest + 0.05, 0.2));
  const screens = [0, 1, 2, 3];
  const sx = (i: number) => (i - idx) * SC.w;
  const stat = (
    <div style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 30px", fontFamily: F.ui, fontWeight: 700, fontSize: 22, color: C.ink }}>
      <span>9:41</span><span style={{ width: 110, height: 30, borderRadius: 99, background: C.ink }} /><span>●●●</span>
    </div>
  );
  // tap positions (absolute)
  const tapY = (ry: number) => SC.y + ry;
  return (
    <div style={{ position: "absolute", inset: 0, background: C.lilacSoft, overflow: "hidden" }}>
      <Blobs t={t} colors={[`${C.pink}55`, C.white, C.lilac]} seed={7} />
      <div style={{ position: "absolute", left: PH.x, top: PH.y + (1 - enter) * 800, width: PH.w, height: PH.h, borderRadius: 72, background: C.ink, boxShadow: `0 0 0 3px ${C.purple}, 0 80px 140px -40px ${C.purple}`, transform: `rotate(${(1 - enter) * 6}deg)` }} />
      <div style={{ position: "absolute", left: SC.x, top: SC.y + (1 - enter) * 800, width: SC.w, height: SC.h, borderRadius: 58, background: C.cream, overflow: "hidden", transform: `rotate(${(1 - enter) * 6}deg)` }}>
        {/* 0: Settings */}
        <div style={{ position: "absolute", inset: 0, transform: `translateX(${sx(0)}px)` }}>
          {stat}
          <div style={{ padding: "16px 30px 18px", fontFamily: F.ui, fontWeight: 700, fontSize: 44 }}>Settings</div>
          <ListRow>Account</ListRow><ListRow>Security</ListRow><ListRow>Language</ListRow>
          <ListRow hl={t >= tDevSet - 0.1 && t < goToB ? 1 : 0}>Developer Settings</ListRow>
          <ListRow>About</ListRow>
        </div>
        {/* 1: Developer Settings */}
        <div style={{ position: "absolute", inset: 0, transform: `translateX(${sx(1)}px)` }}>
          {stat}
          <div style={{ padding: "16px 30px 18px", fontFamily: F.ui, fontWeight: 700, fontSize: 40, display: "flex", gap: 14 }}><span style={{ color: C.purple }}>‹</span>Developer Settings</div>
          <ListRow right={<Toggle on={modeOn} />} hl={t >= tDevMode - 0.2 && t < tDevMode + 0.4 ? 1 : 0}>Developer Mode</ListRow>
          <ListRow right={<Toggle on={testOn} />} hl={t >= tTest - 0.2 && t < tTest + 0.4 ? 1 : 0}>Use Testnet</ListRow>
          <ListRow hl={t >= tLoad - 0.1 && t < goToC ? 1 : 0}>Load Test Page</ListRow>
        </div>
        {/* 2: Load Test Page */}
        <div style={{ position: "absolute", inset: 0, transform: `translateX(${sx(2)}px)` }}>
          {stat}
          <div style={{ padding: "16px 30px 18px", fontFamily: F.ui, fontWeight: 700, fontSize: 40, display: "flex", gap: 14 }}><span style={{ color: C.purple }}>‹</span>Load Test Page</div>
          <div style={{ margin: "10px 30px 0", padding: "28px 24px", minHeight: 110, borderRadius: 28, background: C.white, fontFamily: F.mono, fontWeight: 700, fontSize: 21, color: C.ink, whiteSpace: "nowrap", lineHeight: 1.35, boxShadow: `0 0 0 4px ${t >= tPaste ? C.purple + "33" : "transparent"}` }}>
            {typed ? url.slice(0, typed) : <span style={{ color: "rgba(17,17,17,.3)" }}>https://</span>}
          </div>
          <div style={{ margin: "30px 30px 0", height: 92, borderRadius: 99, background: C.purple, color: C.cream, display: "grid", placeItems: "center", fontFamily: F.ui, fontWeight: 700, fontSize: 34, transform: `scale(${t >= tGo && t < tGo + 0.25 ? 0.94 : 1})` }}>Go</div>
        </div>
        {/* 3: the app, inside MiniPay */}
        <div style={{ position: "absolute", inset: 0, transform: `translateX(${sx(3)}px)` }}>
          {stat}
          <div style={{ margin: "6px 22px", height: 78, borderRadius: 99, background: C.white, display: "flex", alignItems: "center", padding: "0 28px", gap: 12, boxShadow: "0 10px 24px -12px rgba(89,46,129,.45)" }}>
            <span style={{ fontFamily: F.slam, fontWeight: 800, fontSize: 28 }}>MiniPay</span>
            <span style={{ marginLeft: "auto", fontFamily: F.mono, fontWeight: 700, fontSize: 24, color: C.purple }}>$12.40</span>
          </div>
          <div style={{ margin: "10px 22px 0", borderRadius: 30, overflow: "hidden", height: 640 }}>
            <Racer f={f * 1 + 20} width={SC.w - 44} height={640} radius={30} />
          </div>
          <div style={{ position: "absolute", left: 22, right: 22, bottom: 26, height: 80, borderRadius: 99, background: C.purple, color: C.cream, fontFamily: F.ui, fontWeight: 700, fontSize: 28, display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <span style={{ width: 14, height: 14, borderRadius: 99, background: C.pink }} />wallet connected
          </div>
        </div>
      </div>
      {/* taps */}
      <Tap x={SC.x + 300} y={tapY(64 + 74 + 96 * 3 + 48)} t={t} t0={tDevSet + 0.1} />
      <Tap x={SC.x + 400} y={tapY(64 + 78 + 96 * 0 + 48)} t={t} t0={tDevMode + 0.05} />
      <Tap x={SC.x + 400} y={tapY(64 + 78 + 96 * 1 + 48)} t={t} t0={tTest + 0.0} />
      <Tap x={SC.x + 260} y={tapY(64 + 78 + 96 * 2 + 48)} t={t} t0={tLoad + 0.1} />
      <Tap x={SC.x + 260} y={tapY(64 + 78 + 150 + 38 + 30 + 46 + 60)} t={t} t0={tGo + 0.05} />
      {/* stickers when it opens */}
      {[["No wallet list", tList, 560, 700, 4], ["No login", tLogin, 120, 940, -5]].map(([label, at, x, y, r]) => {
        const p = easeBack(prog(t, (at as number) - 0.1, 0.4), 2.2);
        return <div key={label as string} style={{ position: "absolute", left: x as number, top: (y as number) + Math.sin(t * 2.4) * 6, padding: "22px 40px", borderRadius: 99, background: label === "No login" ? C.pink : C.ink, color: label === "No login" ? C.ink : C.cream, fontFamily: F.ui, fontWeight: 700, fontSize: 38, whiteSpace: "nowrap", boxShadow: "0 30px 60px -22px rgba(18,10,28,.6)", transform: `scale(${p}) rotate(${r}deg)`, opacity: t >= (at as number) - 0.1 ? 1 : 0 }}>{label}</div>;
      })}
      <div style={{ position: "absolute", left: SAFE.x, width: SAFE.w, top: 1408, textAlign: "center", fontFamily: F.mono, fontWeight: 500, fontSize: 24, color: C.purple, opacity: 0.8 }}>menu labels can differ between MiniPay versions</div>
    </div>
  );
};
