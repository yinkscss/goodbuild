import React from "react";
import { C, F, SAFE, shadowPop } from "../theme";
import { UI, easeBack, easeOut, ls, prog, scene, wt } from "../cues";
import { Blobs, Eyebrow, Pill, Row, Tick } from "../ui";

/** The real Publish modal, recreated: address, confirm box, Publish, then the live link. */
export const PublishScene: React.FC<{ t: number }> = ({ t }) => {
  const s = scene("publish").start;
  const enter = easeOut(prog(t, s + 0.05, 0.45));
  const tAddr = wt("p2", /^address,?$/), tTick = wt("p2", /^tick$/), tPub = wt("p2", /^Publish\.?$/);
  const tOwn = wt("p3", /^own$/), tDemo = ls("p4");
  const slug = UI.slug;
  const typed = Math.floor(prog(t, tAddr + 0.05, 0.5) * slug.length + 0.001);
  const ticked = t >= tTick;
  const working = t >= tPub && t < tOwn;
  const live = t >= tOwn;
  const btnScale = t >= tPub && t < tPub + 0.3 ? 1 - 0.07 * Math.sin(prog(t, tPub, 0.3) * Math.PI) : 1;
  const swap = easeOut(prog(t, tOwn, 0.35));
  const demoP = easeBack(prog(t, tDemo, 0.45), 1.7);
  const build = prog(t, tPub, tOwn - tPub);

  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas, overflow: "hidden" }}>
      <Blobs t={t} colors={[`${C.lilacSoft}`, `${C.pink}33`]} seed={5} />
      <div style={{ position: "absolute", left: SAFE.x, top: 350, width: SAFE.w, borderRadius: 48, background: C.white, boxShadow: shadowPop, padding: 44, boxSizing: "border-box", transform: `translateY(${(1 - enter) * 160}px) scale(${0.96 + 0.04 * enter})`, opacity: enter, minHeight: 800 }}>
        {!live || swap < 1 ? (
          <div style={{ opacity: 1 - swap, transform: `translateY(${-swap * 30}px)` }}>
            <Eyebrow>One address, all yours</Eyebrow>
            <div style={{ fontFamily: F.slam, fontWeight: 800, fontSize: 56, letterSpacing: "-0.03em", lineHeight: 1, marginTop: 14, whiteSpace: "nowrap" }}>PUBLISH YOUR APP</div>
            <div style={{ marginTop: 14, fontFamily: F.ui, fontWeight: 500, fontSize: 27, color: "rgba(17,17,17,.55)", lineHeight: 1.35 }}>GoodBuild builds your latest saved version and puts it on its own public address.</div>
            <div style={{ marginTop: 26, fontFamily: F.ui, fontWeight: 700, fontSize: 26 }}>Address</div>
            <div style={{ marginTop: 12, height: 92, borderRadius: 24, background: C.canvas, display: "flex", alignItems: "center", padding: "0 28px", fontFamily: F.mono, fontWeight: 700, fontSize: 34, boxShadow: t >= tAddr && !ticked ? `0 0 0 6px ${C.purple}22` : "none" }}>
              <span style={{ color: C.ink }}>{slug.slice(0, typed)}</span>
              {t >= tAddr && t < tTick && <span style={{ width: 4, height: 44, background: C.purple, marginLeft: 3, opacity: Math.floor(t * 3) % 2 ? 0.2 : 1 }} />}
              <span style={{ color: "rgba(17,17,17,.4)" }}>.{UI.domain}</span>
              {typed >= slug.length && <span style={{ marginLeft: "auto", fontFamily: F.ui, fontSize: 24, color: C.purple, display: "flex", alignItems: "center", gap: 10 }}><Tick size={34} />Available</span>}
            </div>
            <div style={{ marginTop: 22 }}>
              <Row label="Version" h={80}>v3</Row>
              <Row label="Contract" h={80}><Pill size={22} bg={C.tint} fg={C.purple}><span style={{ width: 12, height: 12, borderRadius: 99, background: C.pink }} />Deployed on Celo</Pill></Row>
              <Row label="Review" h={80}><Pill bg={`${C.warn}22`} fg={C.warn} size={22}>Unaudited</Pill></Row>
            </div>
            <div style={{ marginTop: 22, display: "flex", gap: 18, alignItems: "flex-start" }}>
              <span style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: ticked ? C.purple : C.white, boxShadow: ticked ? "none" : `inset 0 0 0 4px ${C.lilac}`, display: "grid", placeItems: "center", transform: `scale(${ticked && t < tTick + 0.25 ? 1 + 0.25 * Math.sin(prog(t, tTick, 0.25) * Math.PI) : 1})` }}>
                {ticked && <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
              </span>
              <span style={{ fontFamily: F.ui, fontWeight: 500, fontSize: 24, lineHeight: 1.35, color: "rgba(17,17,17,.6)" }}>I understand this code hasn't been audited and is public. The app isn't for sports betting, and isn't aimed at anyone under 18 or at US persons.</span>
            </div>
            <div style={{ marginTop: 28, position: "relative" }}>
              {working ? (
                <div style={{ height: 104, borderRadius: 99, background: C.deep, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", inset: 0, width: `${20 + build * 80}%`, background: `linear-gradient(90deg, ${C.purple}, ${C.pink})` }} />
                  <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.ui, fontWeight: 700, fontSize: 34, color: C.cream, mixBlendMode: "normal" }}>{build < 0.5 ? "Building your app…" : "Putting it online…"}</div>
                </div>
              ) : (
                <div style={{ height: 104, borderRadius: 99, background: ticked ? C.purple : `${C.purple}55`, color: C.cream, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.ui, fontWeight: 700, fontSize: 38, transform: `scale(${btnScale})` }}>Publish</div>
              )}
              {t >= tPub && t < tPub + 0.6 && <div style={{ position: "absolute", left: "50%", top: "50%", width: 120, height: 120, marginLeft: -60, marginTop: -60, borderRadius: 99, border: `6px solid ${C.pink}`, transform: `scale(${0.3 + prog(t, tPub, 0.6) * 3})`, opacity: 1 - prog(t, tPub, 0.6) }} />}
            </div>
          </div>
        ) : null}
        {live && (
          <div style={{ position: swap < 1 ? "absolute" : "relative", left: 44, right: 44, top: 44, opacity: swap, transform: `translateY(${(1 - swap) * 40}px)` }}>
            <div style={{ position: "relative", margin: "20px auto 0", width: 130, height: 130 }}>
              <span style={{ position: "absolute", inset: 0, borderRadius: 99, background: `${C.pink}66`, transform: `scale(${1 + prog(t, tOwn, 0.7) * 0.9})`, opacity: 1 - prog(t, tOwn, 0.7) }} />
              <span style={{ position: "relative", display: "grid", placeItems: "center", width: 130, height: 130, borderRadius: 99, background: C.purple }}>
                <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </span>
            </div>
            <div style={{ textAlign: "center", fontFamily: F.slam, fontWeight: 800, fontSize: 56, letterSpacing: "-0.03em", marginTop: 34 }}>YOUR APP IS LIVE</div>
            <div style={{ textAlign: "center", fontFamily: F.ui, fontWeight: 500, fontSize: 27, color: "rgba(17,17,17,.55)", marginTop: 14 }}>Anyone with the link can open it and connect their own wallet.</div>
            <div style={{ marginTop: 34, borderRadius: 24, background: C.canvas, padding: "28px 12px", textAlign: "center", fontFamily: F.mono, fontWeight: 700, fontSize: 31, color: C.ink, whiteSpace: "nowrap" }}>https://{slug}.{UI.domain}</div>
            <div style={{ marginTop: 34, display: "flex", justifyContent: "center", gap: 18 }}>
              <span style={{ padding: "24px 44px", borderRadius: 99, background: C.white, boxShadow: "0 2px 4px rgba(17,17,17,.06), 0 18px 40px -20px rgba(89,46,129,.4)", fontFamily: F.ui, fontWeight: 700, fontSize: 30 }}>Copy link</span>
              <span style={{ padding: "24px 44px", borderRadius: 99, background: C.ink, color: C.white, fontFamily: F.ui, fontWeight: 700, fontSize: 30 }}>Open app ↗</span>
            </div>
          </div>
        )}
      </div>
      {/* p4: deploy first */}
      {t >= tDemo && (
        <div style={{ position: "absolute", left: SAFE.x + 30, width: SAFE.w - 60, top: 1180, borderRadius: 32, background: "#FFF3DF", boxShadow: "0 30px 60px -26px rgba(199,119,0,.45)", padding: "26px 30px", display: "flex", gap: 18, alignItems: "flex-start", transform: `translateY(${(1 - demoP) * 200}px) scale(${0.9 + 0.1 * demoP})`, opacity: demoP }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={C.warn} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18.5v.1" /></svg>
          <span style={{ fontFamily: F.ui, fontWeight: 600, fontSize: 27, lineHeight: 1.35, color: "#5A3600" }}>If {UI.contract} isn't deployed, your app goes live as a demo with a notice, and on-chain actions won't work.</span>
        </div>
      )}
    </div>
  );
};
