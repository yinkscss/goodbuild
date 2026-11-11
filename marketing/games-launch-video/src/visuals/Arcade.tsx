import React, { useLayoutEffect, useRef } from "react";
import { C, F } from "../theme";

/**
 * A tiny brick-breaker drawn on a raw <canvas>, no engine.
 * Fully deterministic: the game is re-simulated from frame 0 every render.
 */
type Brick = { x: number; y: number; c: string; hitAt: number };
type Spark = { x: number; y: number; vx: number; vy: number; c: string; t0: number };

const W = 600;
const H = 600;
const COLS = 6;
const ROWS = 5;
const ROW_COLORS = [C.pink, C.lilac, C.cream, C.lilac, C.pink];

const simulate = (frames: number) => {
  const bw = (W - 60) / COLS;
  const bh = 30;
  const bricks: Brick[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) bricks.push({ x: 30 + c * bw, y: 90 + r * (bh + 10), c: ROW_COLORS[r], hitAt: -1 });
  let bx = 330,
    by = 420,
    vx = 9.5,
    vy = -12.5;
  let px = 300;
  let score = 0;
  const sparks: Spark[] = [];
  const trail: [number, number][] = [];
  const sub = 3;
  for (let fr = 0; fr <= frames; fr++) {
    for (let s = 0; s < sub; s++) {
      bx += vx / sub;
      by += vy / sub;
      if (bx < 12 || bx > W - 12) vx = -vx;
      if (by < 64) vy = Math.abs(vy);
      // paddle
      if (by > H - 58 && by < H - 40 && Math.abs(bx - px) < 70 && vy > 0) {
        vy = -Math.abs(vy);
        vx += (bx - px) * 0.08;
        vx = Math.max(-14, Math.min(14, vx));
      }
      if (by > H) {
        by = H - 60;
        vy = -Math.abs(vy);
      }
      for (const b of bricks) {
        if (b.hitAt >= 0) continue;
        if (bx > b.x && bx < b.x + bw - 8 && by > b.y && by < b.y + bh) {
          b.hitAt = fr;
          vy = -vy;
          score += 40;
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * Math.PI * 2 + fr;
            sparks.push({ x: bx, y: by, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6, c: b.c, t0: fr });
          }
          break;
        }
      }
    }
    // paddle AI eases toward the ball
    px += (bx - px) * 0.35;
    px = Math.max(70, Math.min(W - 70, px));
    trail.push([bx, by]);
    if (trail.length > 7) trail.shift();
  }
  return { bricks, bx, by, px, score, sparks, trail, bw, bh };
};

export const Arcade: React.FC<{ f: number; size: number; framed?: boolean }> = ({ f, size, framed }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const st = simulate(Math.max(0, f) + 40);
    const fr = Math.max(0, f) + 40;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0B0612";
    ctx.fillRect(0, 0, W, H);
    // dot grid
    ctx.fillStyle = "rgba(201,179,240,0.10)";
    for (let x = 20; x < W; x += 30) for (let y = 70; y < H; y += 30) ctx.fillRect(x, y, 2, 2);
    // hud
    ctx.fillStyle = C.lilac;
    ctx.font = `700 22px ${F.mono}`;
    ctx.fillText(`SCORE ${String(st.score).padStart(6, "0")}`, 24, 40);
    ctx.textAlign = "right";
    ctx.fillStyle = C.pink;
    ctx.fillText("● ● ●", W - 24, 40);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(201,179,240,0.25)";
    ctx.fillRect(0, 58, W, 2);
    // bricks
    for (const b of st.bricks) {
      if (b.hitAt >= 0) {
        const age = fr - b.hitAt;
        if (age < 4) {
          ctx.fillStyle = "#fff";
          ctx.globalAlpha = 1 - age / 4;
          ctx.beginPath();
          ctx.roundRect(b.x - age * 2, b.y - age, st.bw - 8 + age * 4, st.bh + age * 2, 8);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        continue;
      }
      ctx.fillStyle = b.c;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, st.bw - 8, st.bh, 8);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(b.x + 8, b.y + 5, st.bw - 24, 4);
    }
    // sparks
    for (const s of st.sparks) {
      const age = fr - s.t0;
      if (age > 12) continue;
      ctx.globalAlpha = 1 - age / 12;
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x + s.vx * age, s.y + s.vy * age + 0.4 * age * age, 7, 7);
    }
    ctx.globalAlpha = 1;
    // trail + ball
    st.trail.forEach(([x, y], k) => {
      ctx.globalAlpha = (k + 1) / st.trail.length / 2.5;
      ctx.fillStyle = C.pink;
      ctx.fillRect(x - 9, y - 9, 18, 18);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.cream;
    ctx.fillRect(st.bx - 10, st.by - 10, 20, 20);
    // paddle
    ctx.fillStyle = C.pink;
    ctx.beginPath();
    ctx.roundRect(st.px - 70, H - 44, 140, 18, 9);
    ctx.fill();
  }, [f]);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: framed ? 36 : 18,
        overflow: "hidden",
        boxShadow: framed ? `0 0 0 6px ${C.lilac}33, 0 40px 120px -20px ${C.pink}66` : undefined,
        transform: framed ? `rotate(${-2 + Math.sin(f / 18) * 1.2}deg)` : undefined,
      }}
    >
      <canvas ref={ref} width={W} height={H} style={{ width: size, height: size, display: "block" }} />
    </div>
  );
};
