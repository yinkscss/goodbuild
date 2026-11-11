import React from "react";
import { Easing, Img, interpolate, staticFile } from "remotion";
import { C } from "../theme";
import { clamp } from "../fx";
import type { VisualProps } from "../scenes/Card";

/** A live pulse over a chain of glass-tile blocks marching left. */
export const Chain: React.FC<VisualProps> = ({ f, w, h }) => {
  const pulse = Math.min(h * 0.55, 440);
  const p = interpolate(f, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2.5)) });
  const blk = 150;
  const gapX = 70;
  const span = blk + gapX;
  const off = (f * 7) % span;
  return (
    <div style={{ width: w, height: h, position: "relative", overflow: "hidden" }}>
      {/* pulse */}
      <div style={{ position: "absolute", left: (w - pulse) / 2, top: (h - pulse) / 2 - 110, width: pulse, height: pulse, transform: `scale(${p})` }}>
        {[0, 1, 2].map((i) => {
          const t = ((f + i * 12) % 36) / 36;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: `6px solid ${C.pink}`,
                transform: `scale(${0.3 + t * 0.8})`,
                opacity: 1 - t,
              }}
            />
          );
        })}
        <div style={{ position: "absolute", inset: "35%", borderRadius: "50%", background: C.pink, boxShadow: `0 0 80px 20px ${C.pink}88`, transform: `scale(${1 + 0.08 * Math.sin(f / 3)})` }} />
      </div>
      {/* chain */}
      <div style={{ position: "absolute", left: 0, right: 0, top: h - blk - 30, height: blk }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: blk / 2 - 3, height: 6, background: C.lilac, opacity: 0.5 }} />
        {Array.from({ length: 7 }).map((_, i) => {
          const x = i * span - off - span / 2;
          const isNew = i === 5;
          return (
            <div key={i} style={{ position: "absolute", left: x, top: 0, width: blk, height: blk, borderRadius: 34, background: isNew ? `${C.pink}44` : "rgba(255,255,255,.08)", border: `3px solid ${isNew ? C.pink : "rgba(226,210,240,.35)"}`, display: "grid", placeItems: "center" }}>
              <Img src={staticFile("logo-mark.png")} style={{ width: blk * 0.62 }} />
            </div>
          );
        })}
      </div>
    </div>
  );
};
