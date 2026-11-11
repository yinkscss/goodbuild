import React, { useEffect, useState } from "react";
import { AbsoluteFill, Audio, Easing, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Portal, SceneSpec, TL } from "./theme";
import { loadFonts } from "./fonts";
import { Grain } from "./fx";
import { PromptScene } from "./scenes/PromptScene";
import { BuildScene } from "./scenes/BuildScene";
import { MiniPayScene } from "./scenes/MiniPayScene";
import { GdScene } from "./scenes/GdScene";
import { BackendScene } from "./scenes/BackendScene";
import { WalletScene } from "./scenes/WalletScene";
import { OutroScene } from "./scenes/OutroScene";

export type SceneProps = { f: number; spec: SceneSpec };
const SCENES: Record<string, React.FC<SceneProps>> = {
  prompt: PromptScene,
  build: BuildScene,
  minipay: MiniPayScene,
  gd: GdScene,
  backend: BackendScene,
  wallet: WalletScene,
  outro: OutroScene,
};

const W = 1080;
const H = 1920;
const CX = W / 2;
const CY = H / 2;
const HALF_DIAG = Math.hypot(CX, CY) + 4;

/**
 * Portal geometry: the next scene lives inside the portal, scaled by `s`.
 * Zooming by K = 1/s about the fixed point X maps the portal exactly onto the screen,
 * so the hand-off from one world to the next is mathematically seamless.
 */
const geometry = (p: Portal) => {
  const pc = p.shape === "circle" ? { x: p.cx, y: p.cy } : { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  const s = p.shape === "circle" ? (2 * p.r) / W : p.w / W;
  const K = 1 / s;
  const X = { x: (CX - K * pc.x) / (1 - K), y: (CY - K * pc.y) / (1 - K) };
  return { pc, s, K, X };
};

const Camera: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / TL.fps;
  const scenes = TL.scenes as SceneSpec[];
  let i = scenes.findIndex((s) => t >= s.start && t < s.end);
  if (i < 0) i = scenes.length - 1;
  const cur = scenes[i];
  const next = scenes[i + 1];
  const Cur = SCENES[cur.id];
  const fCur = frame - Math.round(cur.start * TL.fps);

  const zStart = cur.end - TL.zoom;
  if (!next || !cur.portal || t < zStart) {
    return (
      <AbsoluteFill>
        <Cur f={fCur} spec={cur} />
      </AbsoluteFill>
    );
  }

  // frame-exact: the last zoom frame is p = 1, i.e. identical to the next scene's first frame
  const zf0 = Math.round(zStart * TL.fps);
  const zfN = Math.round(cur.end * TL.fps) - zf0;
  const p = Math.min(1, (frame - zf0) / (zfN - 1));
  const e = Easing.bezier(0.7, 0, 0.35, 1)(p);
  const g = geometry(cur.portal);
  const z = Math.pow(g.K, e);
  const parentT = `translate(${g.X.x * (1 - z)}px, ${g.X.y * (1 - z)}px) scale(${z})`;
  const childT = `translate(${z * (g.pc.x - CX * g.s) + g.X.x * (1 - z)}px, ${z * (g.pc.y - CY * g.s) + g.X.y * (1 - z)}px) scale(${z * g.s})`;

  // portal centre on screen, and a clip that grows to cover the frame exactly at the landing
  const sx = z * g.pc.x + g.X.x * (1 - z);
  const sy = z * g.pc.y + g.X.y * (1 - z);
  const grow = Math.pow(e, 4);
  let clip: string;
  if (cur.portal.shape === "circle") {
    const r = cur.portal.r * z;
    clip = `circle(${r + (HALF_DIAG * 1.05 - r) * grow}px at ${sx}px ${sy}px)`;
  } else {
    const pr = cur.portal;
    const l = sx - (pr.w / 2) * z;
    const r = sx + (pr.w / 2) * z;
    const tp = sy - (pr.h / 2) * z;
    const b = sy + (pr.h / 2) * z;
    const L = l * (1 - grow);
    const R = r + (W - r) * grow;
    const T = tp * (1 - grow);
    const B = b + (H - b) * grow;
    clip = `inset(${T}px ${W - R}px ${H - B}px ${L}px round ${pr.radius * z * (1 - grow)}px)`;
  }
  const Next = SCENES[next.id];
  const fNext = frame - Math.round(next.start * TL.fps);
  const childOpacity = interpolate(p, [0, 0.25], [0, 1], { extrapolateRight: "clamp" });
  // speed lines: radial streaks that intensify as the camera accelerates
  const streak = interpolate(p, [0.2, 0.85, 1], [0, 0.55, 0.2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transformOrigin: "0 0", transform: parentT, filter: `blur(${Math.max(0, e - 0.5) * 6}px)` }}>
        <Cur f={fCur} spec={cur} />
      </AbsoluteFill>
      <AbsoluteFill style={{ clipPath: clip, opacity: childOpacity }}>
        <AbsoluteFill style={{ transformOrigin: "0 0", transform: childT }}>
          <Next f={fNext} spec={next} />
        </AbsoluteFill>
      </AbsoluteFill>
      {streak > 0 && (
        <AbsoluteFill
          style={{
            background: `repeating-conic-gradient(from ${frame * 7}deg at ${sx}px ${sy}px, rgba(255,255,255,0) 0deg 5deg, rgba(255,255,255,${streak}) 5.4deg 5.8deg, rgba(255,255,255,0) 6.2deg 11deg)`,
            maskImage: `radial-gradient(circle at ${sx}px ${sy}px, transparent 18%, black 60%)`,
            WebkitMaskImage: `radial-gradient(circle at ${sx}px ${sy}px, transparent 18%, black 60%)`,
            mixBlendMode: "screen",
          }}
        />
      )}
    </AbsoluteFill>
  );
};

export const PlatformLaunch: React.FC = () => {
  const [handle] = useState(() => delayRender("fonts"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadFonts().then(() => {
      setReady(true);
      continueRender(handle);
    });
  }, [handle]);
  if (!ready) return null;
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      <Audio src={staticFile("music.wav")} />
      <Camera />
      <Grain opacity={0.07} />
    </AbsoluteFill>
  );
};
