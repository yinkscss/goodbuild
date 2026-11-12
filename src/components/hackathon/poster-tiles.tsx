"use client";

import * as React from "react";

/**
 * The poster's moving background: a grid of rounded tiles (the 2x2 logo motif) with a slow wave
 * running through it and the odd pink tile. Decorative only; a still frame under reduced motion.
 */
export function PosterTiles({ className }: { className?: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let frame = 0;
    let visible = true;

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const rr = (x: number, y: number, s: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + s, y, x + s, y + s, r);
      ctx.arcTo(x + s, y + s, x, y + s, r);
      ctx.arcTo(x, y + s, x, y, r);
      ctx.arcTo(x, y, x + s, y, r);
      ctx.closePath();
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const s = w < 600 ? 34 : 52;
      const g = 8;
      const cols = Math.ceil(w / (s + g)) + 1;
      const rows = Math.ceil(h / (s + g)) + 1;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const d = Math.hypot(i - cols * 0.85, j - rows * 0.15);
          const wave = Math.sin(d * 0.55 - t * 0.0016);
          const pink = (i * 7 + j * 13) % 29 === 0 && wave > 0.85;
          ctx.fillStyle = pink ? `rgba(255,133,217,${0.25 + wave * 0.4})` : `rgba(226,210,240,${0.03 + Math.max(0, wave) * 0.1})`;
          const k = s * (0.86 + 0.14 * Math.max(0, wave));
          rr(i * (s + g) + (s - k) / 2, j * (s + g) + (s - k) / 2, k, s * 0.26);
          ctx.fill();
        }
      }
    };
    const loop = (t: number) => {
      if (visible) draw(t);
      frame = requestAnimationFrame(loop);
    };

    size();
    const ro = new ResizeObserver(() => {
      size();
      if (reduce) draw(4000);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    if (reduce) draw(4000);
    else frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
