import React, { useLayoutEffect, useRef } from "react";
import { C, F } from "../theme";

/** A top-down arcade racer on a raw <canvas>, deterministic per frame. */
const W = 600;
const H = 760;
const LANES = 3;
const ROAD_X = 90;
const ROAD_W = W - 180;
const laneX = (l: number) => ROAD_X + ROAD_W * ((l + 0.5) / LANES);
const SPEED = 19;
const SPACING = 300;
const hash = (k: number) => {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const obstacle = (k: number) => ({ lane: Math.floor(hash(k) * LANES), color: [C.lilac, C.cream, "#B49AF0"][k % 3] });

const playerLane = (fr: number) => {
  // look at the next obstacle that will reach the player and dodge it
  const dist = fr * SPEED;
  const k = Math.floor((dist + 120) / SPACING) + 2;
  const o = obstacle(k);
  const prev = obstacle(k - 1);
  for (const l of [1, 0, 2]) if (l !== o.lane && l !== prev.lane) return l;
  return (o.lane + 1) % LANES;
};

const car = (ctx: CanvasRenderingContext2D, x: number, y: number, body: string, glass: string) => {
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath();
  ctx.roundRect(x - 34, y - 52, 72, 112, 22);
  ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(x - 36, y - 58, 72, 112, 22);
  ctx.fill();
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.roundRect(x - 24, y - 34, 48, 30, 10);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.45)";
  ctx.fillRect(x - 26, y + 20, 52, 6);
};

export const Racer: React.FC<{ f: number; width: number; height: number; radius?: number }> = ({ f, width, height, radius = 24 }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const fr = f + 200;
    const dist = fr * SPEED;
    ctx.fillStyle = "#2A1240";
    ctx.fillRect(0, 0, W, H);
    // side stripes (curbs)
    for (let y = -80; y < H + 80; y += 80) {
      const yy = y + (dist % 160) - 80;
      ctx.fillStyle = Math.floor((y + 80) / 80) % 2 ? C.pink : C.cream;
      ctx.fillRect(ROAD_X - 22, yy, 22, 80);
      ctx.fillRect(ROAD_X + ROAD_W, yy, 22, 80);
    }
    ctx.fillStyle = "#170B24";
    ctx.fillRect(ROAD_X, 0, ROAD_W, H);
    // lane dashes
    ctx.fillStyle = "rgba(226,210,240,.35)";
    for (let l = 1; l < LANES; l++) {
      const x = ROAD_X + (ROAD_W * l) / LANES - 4;
      for (let y = -100; y < H + 100; y += 100) ctx.fillRect(x, y + (dist % 100), 8, 52);
    }
    // obstacles
    const k0 = Math.floor(dist / SPACING);
    for (let k = k0 - 1; k < k0 + 5; k++) {
      const o = obstacle(k);
      const y = H - 150 - (k * SPACING - dist) * 1 + 0;
      if (y < -120 || y > H + 120) continue;
      car(ctx, laneX(o.lane), y, o.color, C.deep);
    }
    // player: smooth lane changes
    const a = playerLane(fr - 6);
    const b = playerLane(fr);
    let px = laneX(b);
    for (let s = 1; s <= 6; s++) if (playerLane(fr - s) !== b) px = laneX(a) + (laneX(b) - laneX(a)) * (s / 6) ** 0.5;
    car(ctx, px, H - 120, C.pink, C.ink);
    // exhaust
    ctx.fillStyle = "rgba(255,133,217,.5)";
    for (let i = 0; i < 4; i++) ctx.fillRect(px - 14 + (i % 2) * 20, H - 52 + i * 10 + (fr % 3) * 3, 8, 8);
    // HUD
    const secs = 30 + fr / 30;
    const m = Math.floor(secs / 60);
    const s = (secs % 60).toFixed(1).padStart(4, "0");
    ctx.fillStyle = "rgba(18,10,28,.75)";
    ctx.beginPath();
    ctx.roundRect(20, 20, 250, 56, 28);
    ctx.fill();
    ctx.fillStyle = C.cream;
    ctx.font = `700 26px ${F.mono}`;
    ctx.fillText(`LAP ${m}:${s}`, 44, 57);
    ctx.fillStyle = "rgba(18,10,28,.75)";
    ctx.beginPath();
    ctx.roundRect(W - 170, 20, 150, 56, 28);
    ctx.fill();
    ctx.fillStyle = C.pink;
    ctx.fillText("P1", W - 120, 57);
  }, [f]);
  return (
    <div style={{ width, height, borderRadius: radius, overflow: "hidden", background: "#2A1240" }}>
      <canvas ref={ref} width={W} height={H} style={{ width, height, objectFit: "cover", display: "block" }} />
    </div>
  );
};
