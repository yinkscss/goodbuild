import timeline from "./timeline.json";

export const TL = timeline;
// Loose typing: each scene carries its own copy fields (see timeline.json).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SceneSpec = { id: string; start: number; end: number; portal?: Portal } & Record<string, any>;
export type Portal =
  | { shape: "circle"; cx: number; cy: number; r: number }
  | { shape: "rect"; x: number; y: number; w: number; h: number; radius: number };

/** Brand palette. No green anywhere. */
export const C = {
  ink: "#120A1C",
  ink2: "#1E1230",
  deep: "#2A1240",
  purple: "#592E81",
  lilac: "#C9B3F0",
  lilacSoft: "#E2D2F0",
  tint: "#F3EEF8",
  pink: "#FF85D9",
  cream: "#F6EFE4",
  canvas: "#F5F5F5",
  white: "#FFFFFF",
};

export const F = {
  slam: "Unbounded, sans-serif",
  serif: "'Instrument Serif', serif",
  mono: "'JetBrains Mono', monospace",
  ui: "Inter, sans-serif",
};

export const SAFE = { x: 86, y: 230, w: 1080 - 172, h: 1920 - 460 };
export const sec = (s: number) => Math.round(s * TL.fps);
export const shadowCard = "0 2px 4px rgba(17,17,17,.04), 0 30px 70px -30px rgba(89,46,129,.35)";
