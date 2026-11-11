import React from "react";
import { C, F, SAFE, shadowPop } from "../theme";
import { UI, easeBack, easeOut, le, ls, prog, scene, wt } from "../cues";
import { Blobs, Eyebrow, Pill, Row, Tick } from "../ui";

/** The real "Deploy to Celo" modal, recreated: summary, Sign & deploy, Sign -> Broadcast -> Verified. */
export const DeployScene: React.FC<{ t: number }> = ({ t }) => {
  const s = scene("deploy").start;
  const enter = easeOut(prog(t, s + 0.05, 0.45));
  // cue times
  const tContract = wt("d2", /^contract,?$/), tNetwork = wt("d2", /^network,?$/), tFee = wt("d2", /^fee\.?$/);
  const tSep = wt("d3", /^Sepolia$/), tMain = wt("d3", /^mainnet/);
  const tPress = wt("d4", /^Sign$/);
  const tWallet = wt("d4", /^wallet\.?$/), tKeys = wt("d4", /^keys/);
  const tSign = wt("d5", /^Sign\.?$/), tBroad = wt("d5", /^Broadcast/), tVer = wt("d5", /^Verified/), tLive = wt("d5", /^live$/);
  const mainnet = t >= tMain;
  const pressed = t >= tPress;
  const stage = t >= tVer ? 3 : t >= tBroad ? 2 : pressed ? 1 : 0;
  const done = t >= tLive;
  const hl = (a: number, b: number) => (t >= a && t < b ? 1 : 0);
  const pressP = prog(t, tPress, 0.16);
  const btnScale = pressed && t < tPress + 0.3 ? 1 - 0.07 * Math.sin(prog(t, tPress, 0.3) * Math.PI) : 1;
  const sheetP = easeBack(prog(t, tWallet - 0.1, 0.4), 1.6);
  const sheetOut = prog(t, tBroad - 0.05, 0.2);
  const labels = ["Sign", "Broadcast", "Verified"];
  const railFill = stage === 0 ? 0 : stage === 1 ? 0.08 : stage === 2 ? 0.52 : 1;
  const token = (() => { const p = stage < 2 ? prog(t, tPress, 0.4) * 0.08 : stage === 2 ? 0.08 + 0.44 * easeOut(prog(t, tBroad, 0.6)) : 0.52 + 0.48 * easeOut(prog(t, tVer, 0.5)); return p; })();

  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas, overflow: "hidden" }}>
      <Blobs t={t} colors={[`${C.lilacSoft}`, `${C.pink}33`]} seed={1} />
      <div style={{ position: "absolute", left: SAFE.x, top: 350, width: SAFE.w, borderRadius: 48, background: C.white, boxShadow: shadowPop, padding: "44px 44px 44px", boxSizing: "border-box", transform: `translateY(${(1 - enter) * 160}px) scale(${0.96 + 0.04 * enter})`, opacity: enter }}>
        <Eyebrow>{done ? "Done" : "You sign, we build"}</Eyebrow>
        <div style={{ fontFamily: F.slam, fontWeight: 800, fontSize: 60, letterSpacing: "-0.03em", lineHeight: 1, marginTop: 14, color: C.ink, whiteSpace: "nowrap" }}>{done ? "LIVE ON CELO" : "DEPLOY TO CELO"}</div>
        <div style={{ marginTop: 26 }}>
          <Row label="Contract" hl={hl(tContract - 0.1, tNetwork - 0.1)}>
            <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 30 }}>{UI.contract}</span>
          </Row>
          <Row label="Network" hl={hl(tNetwork - 0.1, tFee - 0.1)}>
            <span style={{ display: "flex", gap: 8, background: C.tint, padding: 6, borderRadius: 99 }}>
              {["Celo Sepolia", "Celo"].map((n, i) => {
                const on = (i === 1) === mainnet;
                return <span key={n} style={{ padding: "10px 22px", borderRadius: 99, background: on ? C.purple : "transparent", color: on ? C.cream : C.purple, fontFamily: F.ui, fontWeight: 700, fontSize: 26 }}>{n}</span>;
              })}
            </span>
          </Row>
          <Row label="Estimated network fee" hl={hl(tFee - 0.1, tSep)}>
            <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 28 }}>≈ 0.002 CELO</span>
          </Row>
          <Row label="Review">
            <Pill bg={`${C.warn}22`} fg={C.warn} size={22}>Unaudited</Pill>
          </Row>
        </div>

        {/* Sign -> Broadcast -> Verified */}
        <div style={{ position: "relative", marginTop: 34, height: 130 }}>
          <div style={{ position: "absolute", left: 40, right: 40, top: 28, height: 8, borderRadius: 4, background: C.tint }} />
          <div style={{ position: "absolute", left: 40, top: 28, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${C.purple}, ${C.pink})`, width: `calc((100% - 80px) * ${railFill})` }} />
          {stage > 0 && !done && <div style={{ position: "absolute", left: `calc(40px + (100% - 80px) * ${token} - 16px)`, top: 16, width: 32, height: 32, borderRadius: 99, background: C.pink, boxShadow: `0 0 0 10px ${C.pink}44` }} />}
          {labels.map((l, i) => {
            const reached = stage > i;
            const active = stage === i + 1 && !(i === 2 && stage === 3);
            const x = ["0%", "50%", "100%"][i];
            return (
              <div key={l} style={{ position: "absolute", left: `calc(40px + (100% - 80px) * ${i / 2})`, top: 0, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <span style={{ width: 64, height: 64, borderRadius: 99, display: "grid", placeItems: "center", background: reached ? C.purple : C.white, boxShadow: reached ? "none" : `inset 0 0 0 5px ${C.tint}`, transform: `scale(${reached && t - [tSign, tBroad, tVer][i] < 0.3 ? 1 + 0.25 * Math.sin(prog(t, [tSign, tBroad, tVer][i], 0.3) * Math.PI) : 1})` }}>
                  {reached ? <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> : <span style={{ fontFamily: F.slam, fontWeight: 900, fontSize: 26, color: "rgba(17,17,17,.3)" }}>{i + 1}</span>}
                </span>
                <span style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 28, color: reached || active ? C.ink : "rgba(17,17,17,.4)" }}>{l}</span>
              </div>
            );
          })}
        </div>

        {/* result / button */}
        <div style={{ marginTop: 26, height: 112, position: "relative" }}>
          {!done ? (
            <div style={{ height: 104, borderRadius: 99, background: C.ink, color: C.white, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.ui, fontWeight: 700, fontSize: 38, transform: `scale(${btnScale})`, opacity: pressed ? 0.78 : 1 }}>
              {pressed ? <span style={{ display: "flex", alignItems: "center", gap: 16 }}><span style={{ width: 22, height: 22, borderRadius: 99, border: `4px solid ${C.pink}`, borderTopColor: "transparent", transform: `rotate(${t * 540}deg)`, display: "inline-block" }} />{stage >= 2 ? "Sending to Celo…" : "Check your wallet"}</span> : "Sign & deploy"}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 18, height: 104, opacity: easeOut(prog(t, tLive, 0.3)), transform: `translateY(${(1 - easeOut(prog(t, tLive, 0.3))) * 20}px)` }}>
              <Tick size={64} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 30, color: C.ink }}>0x7c3a…e19a</div>
                <div style={{ marginTop: 6 }}><Pill size={20} bg={C.tint} fg={C.purple}>Verified on Sourcify</Pill></div>
              </div>
            </div>
          )}
          {pressed && t < tPress + 0.7 && <div style={{ position: "absolute", left: "50%", top: "50%", width: 120, height: 120, marginLeft: -60, marginTop: -60, borderRadius: 99, border: `6px solid ${C.pink}`, transform: `scale(${0.3 + prog(t, tPress, 0.6) * 3})`, opacity: 1 - prog(t, tPress, 0.6) }} />}
        </div>
      </div>

      {/* the wallet asks, keys stay with you */}
      {t >= tWallet - 0.1 && sheetOut < 1 && (
        <div style={{ position: "absolute", left: SAFE.x + 54, width: SAFE.w - 108, top: 880, borderRadius: 40, background: C.ink, color: C.cream, padding: "32px 36px", boxShadow: `0 60px 100px -30px ${C.purple}`, transform: `translateY(${(1 - sheetP) * 400}px) scale(${1 - sheetOut * 0.1})`, opacity: 1 - sheetOut }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ width: 54, height: 54, borderRadius: 99, background: C.pink, display: "grid", placeItems: "center" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="3" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            </span>
            <div style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 32 }}>Confirm in your wallet</div>
          </div>
          <div style={{ marginTop: 16, fontFamily: F.mono, fontWeight: 500, fontSize: 24, color: C.lilac }}>Deploy {UI.contract} · {mainnet ? "Celo" : "Celo Sepolia"}</div>
          <div style={{ marginTop: 22, display: "flex", gap: 14, alignItems: "center" }}>
            <span style={{ padding: "16px 36px", borderRadius: 99, background: C.pink, color: C.ink, fontFamily: F.ui, fontWeight: 700, fontSize: 28 }}>Sign</span>
            <span style={{ fontFamily: F.ui, fontWeight: 600, fontSize: 24, color: C.lilac, opacity: t >= tKeys ? 1 : 0 }}>Your keys stay in your wallet.</span>
          </div>
        </div>
      )}
    </div>
  );
};
