import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { C, F, SAFE } from "../theme";
import { clamp } from "../fx";
import type { SceneProps } from "../Video";
import { Headline, SceneRoot } from "./common";

/** Everything orbits one wallet. Lines carry pulses into it. */
export const WalletScene: React.FC<SceneProps> = ({ f, spec }) => {
  const portal = spec.portal as { cx: number; cy: number; r: number };
  const nodes = spec.nodes as string[];
  const rx = 262;
  const ry = 370;
  const rot = f / 160;
  const hub = 150;
  const pos = nodes.map((_, i) => {
    const a = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2 + rot;
    return { x: portal.cx + Math.cos(a) * rx, y: portal.cy + Math.sin(a) * ry };
  });
  const hubIn = interpolate(f, [-18, 0], [0.7, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

  return (
    <SceneRoot base={C.deep} bg={`radial-gradient(37.5% 25% at 50% 55%, #6B3A99, ${C.purple} 45%, ${C.deep})`}>
      <Headline f={f} h={spec.h} a={spec.a} hColor={C.cream} aColor={C.pink} maxH={130} maxA={100} />
      <svg style={{ position: "absolute", inset: 0 }} width={1080} height={1920}>
        {pos.map((p, i) => {
          const at = 6 + i * 4;
          const draw = interpolate(f, [at, at + 6], [0, 1], clamp);
          const x2 = portal.cx + (p.x - portal.cx) * draw;
          const y2 = portal.cy + (p.y - portal.cy) * draw;
          const pulse = ((f - at) % 20) / 20;
          return (
            <g key={i}>
              <line x1={portal.cx} y1={portal.cy} x2={x2} y2={y2} stroke={C.lilac} strokeOpacity={0.5} strokeWidth={4} strokeDasharray="2 14" strokeLinecap="round" />
              {draw >= 1 && <circle cx={p.x + (portal.cx - p.x) * pulse} cy={p.y + (portal.cy - p.y) * pulse} r={9} fill={C.pink} />}
            </g>
          );
        })}
      </svg>
      {/* hub */}
      <div
        style={{
          position: "absolute",
          left: portal.cx - hub,
          top: portal.cy - hub,
          width: hub * 2,
          height: hub * 2,
          borderRadius: "50%",
          background: "rgba(255,255,255,.12)",
          border: `3px solid rgba(255,255,255,.35)`,
          boxShadow: `0 0 120px 10px ${C.pink}55, inset 0 0 60px rgba(255,255,255,.15)`,
          transform: `scale(${hubIn})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: portal.cx - portal.r,
          top: portal.cy - portal.r,
          width: portal.r * 2,
          height: portal.r * 2,
          borderRadius: "50%",
          background: `radial-gradient(circle at 35% 30%, #fff, ${C.pink} 45%, ${C.purple})`,
        }}
      />
      <div style={{ position: "absolute", left: portal.cx - 190, width: 380, top: portal.cy + portal.r + 22, textAlign: "center", fontFamily: F.mono, fontWeight: 700, fontSize: 34, color: C.cream }}>{spec.address}</div>
      {nodes.map((n, i) => {
        const at = 6 + i * 4 + 4;
        const s = interpolate(f, [at, at + 6], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2.4)) });
        return (
          <div
            key={n}
            style={{
              position: "absolute",
              left: pos[i].x,
              top: pos[i].y,
              transform: `translate(-50%, -50%) scale(${s})`,
              padding: "18px 30px",
              borderRadius: 99,
              background: i === 3 ? C.pink : C.cream,
              color: C.ink,
              fontFamily: F.slam,
              fontWeight: 800,
              fontSize: 30,
              whiteSpace: "nowrap",
              boxShadow: "0 20px 40px -18px rgba(0,0,0,.6)",
            }}
          >
            {n}
          </div>
        );
      })}
      <div style={{ position: "absolute", left: SAFE.x, width: SAFE.w, top: SAFE.y + SAFE.h - 50, textAlign: "center", fontFamily: F.mono, fontWeight: 500, fontSize: 32, color: C.lilacSoft, opacity: f >= 40 ? 1 : 0 }}>
        {spec.label}
      </div>
    </SceneRoot>
  );
};
