import React from "react";
import { C, F, SAFE, shadowCard } from "../theme";
import { easeBack, easeOut, ls, prog, scene, wt } from "../cues";
import { Blobs, Tick } from "../ui";

/** What GoodBuild already wrote for the listing, and what's left for you. */
export const ListScene: React.FC<{ t: number }> = ({ t }) => {
  const s = scene("list").start;
  const tForm = ls("l1"), tPages = ls("l2"), tRead = ls("l3");
  const items: [string, number][] = [
    ["About", wt("l2", /^About,?$/)], ["How to use", wt("l2", /^How$/)], ["Terms", wt("l2", /^Terms,?$/)],
    ["Privacy", wt("l2", /^Privacy$/)], ["Support", wt("l2", /^Support$/)], ["The footer", wt("l2", /^footer$/)],
  ];
  const youAdd = ["Name & tagline", "Category", "512 × 512 icon", "Support link"];
  const cardP = easeOut(prog(t, s + 0.05, 0.45));
  const readHl = t >= tRead ? 1 : 0;
  const pulse = readHl ? 0.5 + 0.5 * Math.sin((t - tRead) * 7) : 0;
  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas, overflow: "hidden" }}>
      <Blobs t={t} colors={[C.lilacSoft, `${C.pink}33`]} seed={9} />
      <div style={{ position: "absolute", left: SAFE.x, top: 350, width: SAFE.w, opacity: cardP, transform: `translateY(${(1 - cardP) * 60}px)` }}>
        <div style={{ fontFamily: F.slam, fontWeight: 800, fontSize: 56, letterSpacing: "-0.03em", color: C.ink, lineHeight: 1.04 }}>MINIPAY</div>
        <div style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: 84, color: C.purple, lineHeight: 1 }}>app list</div>
      </div>
      <div style={{ position: "absolute", left: SAFE.x, top: 610, width: SAFE.w, borderRadius: 44, background: C.white, boxShadow: shadowCard, padding: "36px 40px", boxSizing: "border-box", transform: `translateY(${(1 - easeOut(prog(t, tPages - 0.1, 0.4))) * 120}px)`, opacity: easeOut(prog(t, tPages - 0.1, 0.3)) }}>
        <div style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 24, letterSpacing: "0.16em", color: C.purple, marginBottom: 14 }}>GOODBUILD ALREADY WROTE</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 14px" }}>
          {items.map(([label, at], i) => {
            const on = t >= at;
            const p = easeBack(prog(t, at, 0.3), 2.2);
            const hot = readHl && (label === "Terms" || label === "Privacy");
            return (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px 16px 18px", borderRadius: 99, background: hot ? `rgba(255,133,217,${0.25 + 0.35 * pulse})` : on ? C.tint : "#F7F5FA", fontFamily: F.ui, fontWeight: 700, fontSize: 32, color: on ? C.ink : "rgba(17,17,17,.3)", boxShadow: hot ? `0 0 0 4px ${C.pink}` : "none" }}>
                <span style={{ transform: `scale(${on ? p : 1})` }}>{on ? <Tick size={40} /> : <span style={{ display: "inline-block", width: 40, height: 40, borderRadius: 99, boxShadow: `inset 0 0 0 4px ${C.lilac}66` }} />}</span>
                {label}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: "absolute", left: SAFE.x, top: 1040, width: SAFE.w, borderRadius: 44, background: C.ink, color: C.cream, padding: "36px 40px", boxSizing: "border-box", transform: `translateY(${(1 - easeOut(prog(t, tForm, 0.4))) * 160}px)`, opacity: easeOut(prog(t, tForm, 0.3)), boxShadow: `0 40px 80px -30px ${C.purple}` }}>
        <div style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 24, letterSpacing: "0.16em", color: C.pink, marginBottom: 14 }}>YOU ADD</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          {youAdd.map((y, i) => {
            const p = easeBack(prog(t, tForm + 0.4 + i * 0.18, 0.35), 2);
            return <span key={y} style={{ padding: "16px 28px", borderRadius: 99, background: "rgba(255,255,255,.1)", border: `2px solid ${C.lilac}55`, fontFamily: F.ui, fontWeight: 700, fontSize: 32, transform: `scale(${p})`, opacity: t >= tForm + 0.4 + i * 0.18 ? 1 : 0 }}>{y}</span>;
          })}
        </div>
      </div>
    </div>
  );
};
