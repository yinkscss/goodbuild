import React from "react";
import { Easing, interpolate } from "remotion";
import { C, F } from "../theme";
import { clamp } from "../fx";
import type { VisualProps } from "../scenes/Card";

// [text, colour] tokens per line
const KW = C.pink;
const TY = C.lilac;
const PL = C.cream;
const CM = "rgba(201,179,240,.55)";
const CODE: [string, string][][] = [
  [["// Arcade.sol", CM]],
  [["contract ", KW], ["Arcade", TY], [" {", PL]],
  [["  mapping", KW], ["(address => uint256) ", TY], ["public ", KW], ["best;", PL]],
  [["  event ", KW], ["Score", TY], ["(address p, uint256 s);", PL]],
  [["  function ", KW], ["submit", TY], ["(uint256 s) ", PL], ["external ", KW], ["{", PL]],
  [["    if ", KW], ["(s > best[msg.sender])", PL]],
  [["      best[msg.sender] = s;", PL]],
  [["    emit ", KW], ["Score(msg.sender, s);", PL]],
  [["  }", PL]],
  [["}", PL]],
];

export const Contract: React.FC<VisualProps> = ({ f, spec, w, h }) => {
  const fontSize = 29;
  const lineH = fontSize * 1.55;
  const shown = interpolate(f, [0, 30], [0, CODE.length], clamp);
  const tags = spec.chips ?? [];
  const y = interpolate(f, [0, 6], [120, 0], { ...clamp, easing: Easing.out(Easing.exp) });
  return (
    <div style={{ width: w, display: "flex", flexDirection: "column", gap: 30, transform: `translateY(${y}px)`, maxHeight: h }}>
      <div style={{ background: C.ink2, borderRadius: 32, padding: "30px 34px", boxShadow: `0 0 0 3px ${C.purple}, 0 50px 120px -40px ${C.pink}88`, transform: "rotate(-1deg)", margin: "0 14px" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          {[C.pink, C.lilac, C.purple].map((c) => (
            <span key={c} style={{ width: 16, height: 16, borderRadius: 99, background: c }} />
          ))}
        </div>
        {CODE.map((line, i) => {
          const vis = shown - i;
          if (vis <= 0) return <div key={i} style={{ height: lineH }} />;
          const full = line.map((t) => t[0]).join("");
          let chars = vis >= 1 ? full.length : Math.floor(full.length * vis);
          return (
            <div key={i} style={{ height: lineH, fontFamily: F.mono, fontWeight: 500, fontSize, lineHeight: `${lineH}px`, whiteSpace: "pre" }}>
              {line.map(([t, c], k) => {
                const take = t.slice(0, Math.max(0, chars));
                chars -= t.length;
                return (
                  <span key={k} style={{ color: c }}>
                    {take}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center" }}>
        {tags.map((t, i) => {
          const at = 14 + i * 4;
          const p = interpolate(f, [at, at + 5], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2.5)) });
          return (
            <div
              key={t}
              style={{
                transform: `scale(${p})`,
                background: i === 2 ? C.pink : C.cream,
                color: C.ink,
                fontFamily: F.mono,
                fontWeight: 700,
                fontSize: 30,
                padding: "16px 28px",
                borderRadius: 999,
                whiteSpace: "nowrap",
              }}
            >
              {t}
            </div>
          );
        })}
      </div>
    </div>
  );
};
