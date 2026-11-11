import React from "react";
import { Easing, interpolate } from "remotion";
import { C, F } from "../theme";
import { clamp } from "../fx";
import { Arcade } from "./Arcade";
import type { VisualProps } from "../scenes/Card";

/** A browser window: the URL types in, enter, the game loads. */
export const UrlBar: React.FC<VisualProps> = ({ f, spec, w, h }) => {
  const url = spec.url ?? "";
  const typeFrom = 3;
  const n = Math.max(0, Math.min(url.length, Math.floor((f - typeFrom) / 1.15)));
  const doneAt = typeFrom + url.length * 1.15;
  const loaded = f >= doneAt + 6;
  const dot = url.indexOf(".");
  const sub = url.slice(0, Math.min(n, dot));
  const rest = n > dot ? url.slice(dot, n) : "";
  const enter = interpolate(f, [doneAt + 2, doneAt + 6], [1, 0.94], clamp);
  const enterBack = f > doneAt + 6 ? 1 : enter;
  const wipe = interpolate(f, [doneAt + 6, doneAt + 12], [100, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const y = interpolate(f, [0, 6], [140, 0], { ...clamp, easing: Easing.out(Easing.exp) });
  const bodyH = Math.min(h - 150, 660);
  return (
    <div style={{ width: w - 30, borderRadius: 36, background: C.cream, overflow: "hidden", transform: `translateY(${y}px) rotate(1.5deg)`, boxShadow: `0 60px 120px -40px ${C.deep}` }}>
      <div style={{ padding: "26px 26px 22px", background: C.white, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", gap: 12 }}>
          {[C.pink, C.lilac, C.purple].map((c) => (
            <span key={c} style={{ width: 18, height: 18, borderRadius: 99, background: c }} />
          ))}
        </div>
        <div
          style={{
            height: 92,
            borderRadius: 999,
            background: "#F3EEF8",
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "0 30px",
            transform: `scale(${enterBack})`,
            boxShadow: f > doneAt ? `0 0 0 5px ${C.pink}` : undefined,
          }}
        >
          <svg width="30" height="34" viewBox="0 0 30 34">
            <rect x="3" y="14" width="24" height="18" rx="5" fill={C.purple} />
            <path d="M8 14 V10 a7 7 0 0 1 14 0 V14" stroke={C.purple} strokeWidth="4" fill="none" />
          </svg>
          <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 40, whiteSpace: "nowrap" }}>
            <span style={{ color: C.white, background: C.purple, borderRadius: 10, padding: sub ? "2px 8px" : 0 }}>{sub}</span>
            <span style={{ color: C.ink }}>{rest}</span>
            {f < doneAt + 4 && <span style={{ color: C.pink, opacity: Math.floor(f / 4) % 2 ? 1 : 0.2 }}>▍</span>}
          </span>
          {f > doneAt && (
            <span style={{ marginLeft: "auto", width: 52, height: 52, borderRadius: 99, background: C.pink, display: "grid", placeItems: "center", fontFamily: F.ui, fontWeight: 700, fontSize: 30, color: C.ink }}>→</span>
          )}
        </div>
      </div>
      <div style={{ height: bodyH, position: "relative", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {loaded ? (
          <div style={{ clipPath: `inset(0 0 ${wipe}% 0)`, display: "flex", alignItems: "center", gap: 36 }}>
            <Arcade f={f + 60} size={bodyH - 90} />
          </div>
        ) : (
          <div style={{ display: "flex", gap: 14 }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 22, height: 22, borderRadius: 99, background: C.lilac, opacity: (Math.floor(f / 3) % 3) === i ? 1 : 0.25 }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
