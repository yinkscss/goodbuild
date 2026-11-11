import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { C, F, SAFE, TL, shadowCard } from "../theme";
import { clamp } from "../fx";
import type { SceneProps } from "../Video";
import { Blobs, Headline, SceneRoot } from "./common";

export const BackendScene: React.FC<SceneProps> = ({ f, spec }) => {
  const portal = spec.portal as { cx: number; cy: number; r: number };
  const swap = Math.round(spec.swapAt * TL.fps);
  const second = f >= swap;
  const card = { x: SAFE.x, y: 700, w: SAFE.w, h: 1690 - 700 };
  const listTop = portal.cy + 50;
  const rowH = 84;
  const entries = spec.entries as string[];
  // entries arrive one per beat after the swap, newest on top, one per beat (15 frames at 120 bpm)
  const arrived = second ? Math.min(entries.length, Math.floor((f - swap) / 15) + 1) : 0;
  const slide = second ? interpolate((f - swap) % 15, [0, 5], [-rowH, 0], { ...clamp, easing: Easing.out(Easing.exp) }) : 0;
  const lastArrival = arrived >= entries.length && (f - swap) >= (entries.length - 1) * 15 + 5;

  return (
    <SceneRoot base={C.white}>
      <Blobs f={f} colors={[`${C.lilacSoft}`, `${C.pink}22`]} seed={1} />
      {!second ? (
        <Headline f={f} h={spec.h} a={spec.a} hColor={C.ink} aColor={C.purple} maxH={120} maxA={86} />
      ) : (
        <Headline f={f} h={spec.h2} a={spec.a2} hColor={C.purple} aColor={C.ink} at={swap} aAt={6} maxH={120} maxA={86} />
      )}

      <div style={{ position: "absolute", left: card.x, top: card.y, width: card.w, height: card.h, borderRadius: 44, background: C.white, boxShadow: shadowCard, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "36px 40px 10px" }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={C.purple} strokeWidth="2.2" strokeLinecap="round">
            <ellipse cx="12" cy="5" rx="8" ry="3" />
            <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
            <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
          </svg>
          <span style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 40, color: C.ink }}>Backend</span>
          <span style={{ marginLeft: "auto", fontFamily: F.mono, fontWeight: 700, fontSize: 22, color: C.purple, background: C.tint, padding: "8px 18px", borderRadius: 99 }}>racer</span>
        </div>
        {(spec.collections as { name: string; rule: string }[]).map((c, i) => {
          const at = 8 + i * 6;
          return (
            <div
              key={c.name}
              style={{
                margin: "14px 40px 0",
                height: 92,
                borderRadius: 24,
                background: C.tint,
                display: "flex",
                alignItems: "center",
                padding: "0 28px",
                gap: 18,
                opacity: f >= at ? 1 : 0,
                transform: `translateX(${interpolate(f - at, [0, 6], [120, 0], { ...clamp, easing: Easing.out(Easing.exp) })}px)`,
              }}
            >
              <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 32, color: C.ink }}>{c.name}</span>
              <span style={{ marginLeft: "auto", fontFamily: F.ui, fontWeight: 600, fontSize: 24, color: C.purple, background: C.white, padding: "10px 18px", borderRadius: 99 }}>{c.rule}</span>
            </div>
          );
        })}
      </div>
      {/* entries header in scene coordinates: the live dot is the portal */}
      <div style={{ position: "absolute", left: card.x + 40, width: card.w - 80, top: portal.cy - 30, height: 60, display: "flex", alignItems: "center", borderTop: "2px solid rgba(17,17,17,.06)" }}>
        <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 24, letterSpacing: "0.12em", color: "rgba(17,17,17,.5)" }}>ENTRIES · SCORES</span>
        <span style={{ position: "absolute", left: portal.cx - card.x - 40 + portal.r + 14, fontFamily: F.mono, fontWeight: 700, fontSize: 24, color: C.purple, letterSpacing: "0.1em" }}>LIVE</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: portal.cx - portal.r,
          top: portal.cy - portal.r,
          width: portal.r * 2,
          height: portal.r * 2,
          borderRadius: 99,
          background: C.pink,
          boxShadow: `0 0 0 ${interpolate(f % 15, [0, 15], [0, 12])}px rgba(255,133,217,${interpolate(f % 15, [0, 15], [0.5, 0])})`,
        }}
      />
      <div style={{ position: "absolute", left: card.x + 40, width: card.w - 80, top: listTop, height: rowH * 5, overflow: "hidden" }}>
        {!second && (
          <div style={{ fontFamily: F.ui, fontWeight: 500, fontSize: 28, color: "rgba(17,17,17,.4)", paddingTop: 20 }}>Nothing yet. Entries appear here once your app gets some.</div>
        )}
        {Array.from({ length: arrived }).map((_, k) => {
          const idx = arrived - 1 - k; // newest first
          const isNew = k === 0 && !lastArrival;
          return (
            <div
              key={idx}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: k * rowH + slide,
                height: rowH - 12,
                borderRadius: 20,
                background: isNew ? `${C.pink}33` : C.canvas,
                display: "flex",
                alignItems: "center",
                padding: "0 24px",
                gap: 16,
                fontFamily: F.mono,
                fontWeight: 500,
                fontSize: 28,
                color: C.ink,
              }}
            >
              <span style={{ width: 12, height: 12, borderRadius: 99, background: isNew ? C.pink : C.lilac }} />
              {entries[idx]}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: card.x + 40, top: 1690 - 40 - 72, display: "flex", gap: 14 }}>
        {(spec.actions as string[]).map((a, i) => (
          <span key={a} style={{ height: 72, padding: "0 28px", borderRadius: 99, background: i === 0 ? C.ink : C.tint, color: i === 0 ? C.white : C.purple, fontFamily: F.ui, fontWeight: 700, fontSize: 26, display: "flex", alignItems: "center" }}>
            {a}
          </span>
        ))}
      </div>
    </SceneRoot>
  );
};
