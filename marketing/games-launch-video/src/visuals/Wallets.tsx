import React from "react";
import { Easing, interpolate } from "remotion";
import { C, F } from "../theme";
import { clamp } from "../fx";
import type { VisualProps } from "../scenes/Card";

const LOOKS = [
  { bg: C.ink, fg: C.cream },
  { bg: C.cream, fg: C.ink },
  { bg: C.purple, fg: C.cream },
  { bg: C.white, fg: C.purple },
  { bg: C.deep, fg: C.pink },
];

/** Wallet chips slam in one after another, then a signature line draws. */
export const Wallets: React.FC<VisualProps> = ({ f, spec, w }) => {
  const chips = spec.chips ?? [];
  return (
    <div style={{ width: w, display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
      {chips.map((c, i) => {
        const at = i * 3;
        const p = interpolate(f, [at, at + 5], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2.4)) });
        const x = interpolate(f, [at, at + 5], [i % 2 ? 500 : -500, 0], { ...clamp, easing: Easing.out(Easing.exp) });
        const L = LOOKS[i % LOOKS.length];
        const tilt = [-4, 3, -2, 4, -3][i % 5];
        return (
          <div
            key={c}
            style={{
              opacity: f >= at ? 1 : 0,
              transform: `translateX(${x}px) scale(${p}) rotate(${tilt}deg)`,
              background: L.bg,
              color: L.fg,
              fontFamily: F.slam,
              fontWeight: 800,
              fontSize: 54,
              letterSpacing: "-0.02em",
              padding: "22px 46px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              boxShadow: "0 24px 50px -24px rgba(26,13,38,.55)",
              display: "flex",
              alignItems: "center",
              gap: 20,
            }}
          >
            <span style={{ width: 22, height: 22, borderRadius: 99, background: C.pink, boxShadow: `inset 0 0 0 4px ${L.bg === C.deep ? C.lilac : "rgba(255,255,255,.5)"}` }} />
            {c}
          </div>
        );
      })}
    </div>
  );
};
