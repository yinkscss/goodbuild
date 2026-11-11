import timeline from "./timeline.json";

export const TL = timeline;
export type CardSpec = (typeof timeline.cards)[number] & { chips?: string[]; url?: string };

/** Brand palette for this video. No green anywhere. */
export const C = {
  ink: "#120A1C",
  ink2: "#1E1230",
  deep: "#2A1240",
  purple: "#592E81",
  lilac: "#C9B3F0",
  lilacSoft: "#E2D2F0",
  pink: "#FF85D9",
  cream: "#F6EFE4",
  white: "#FFFFFF",
};

export const F = {
  slam: "Unbounded, sans-serif", // heavy grotesk, 900
  serif: "'Instrument Serif', serif", // italic answers
  mono: "'JetBrains Mono', monospace",
  ui: "Inter, sans-serif",
};

/** Safe area: 8% sides, 12% top/bottom. */
export const SAFE = { x: 86, y: 230, w: 1080 - 172, h: 1920 - 460 };

export type Theme = { bg: string; q: string; a: string; label: string; accent: string; flash: string };
export const THEMES: Record<string, Theme> = {
  ink: { bg: C.ink, q: C.cream, a: C.pink, label: C.lilac, accent: C.pink, flash: C.pink },
  purple: { bg: C.purple, q: C.cream, a: C.pink, label: C.lilacSoft, accent: C.pink, flash: C.cream },
  cream: { bg: C.cream, q: C.ink, a: C.purple, label: C.purple, accent: C.pink, flash: C.purple },
  pink: { bg: C.pink, q: C.ink, a: C.deep, label: C.deep, accent: C.ink, flash: C.ink },
  lilac: { bg: C.lilac, q: C.ink, a: C.purple, label: C.deep, accent: C.pink, flash: C.pink },
};

export const sec = (s: number) => Math.round(s * TL.fps);
