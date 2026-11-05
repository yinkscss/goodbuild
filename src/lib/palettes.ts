/**
 * Colour palettes for the app a person is building (never GoodBuild's own UI, which stays on
 * DESIGN_SYSTEM.md). Curated rather than generated: a model-written palette costs tokens and can't
 * promise readable text, while these are checked for contrast by a test (palettes.test.ts). The
 * model only says which one suits the request. "Other" takes the person's own words instead.
 */

export interface PaletteTokens {
  background: string;
  foreground: string;
  muted: string;
  "muted-foreground": string;
  card: string;
  border: string;
  ring: string;
  primary: string;
  "primary-foreground": string;
  accent: string;
  "accent-foreground": string;
  success: string;
  warning: string;
  danger: string;
}

export interface Palette {
  id: string;
  name: string;
  /** A few plain words, for the person and for the model picking one. */
  mood: string;
  tokens: PaletteTokens;
}

const LIGHT_STATUS = { success: "#047857", warning: "#B45309", danger: "#B91C1C" };

export const PALETTES: Palette[] = [
  {
    id: "sunrise",
    name: "Warm sunrise",
    mood: "Friendly and warm, orange and cream",
    tokens: { background: "#FFFBF5", foreground: "#2B1A10", muted: "#FBF1E4", "muted-foreground": "#6B5543", card: "#FFFFFF", border: "#EFDFCB", ring: "#C2410C", primary: "#2B1A10", "primary-foreground": "#FFFFFF", accent: "#C2410C", "accent-foreground": "#FFFFFF", ...LIGHT_STATUS },
  },
  {
    id: "forest",
    name: "Forest",
    mood: "Calm and trustworthy, deep greens",
    tokens: { background: "#F7FAF6", foreground: "#14281D", muted: "#EAF2E9", "muted-foreground": "#4C6355", card: "#FFFFFF", border: "#D7E4D6", ring: "#15803D", primary: "#14532D", "primary-foreground": "#FFFFFF", accent: "#15803D", "accent-foreground": "#FFFFFF", ...LIGHT_STATUS },
  },
  {
    id: "ocean",
    name: "Ocean",
    mood: "Clear and professional, blues",
    tokens: { background: "#F5FAFC", foreground: "#0B2530", muted: "#E6F2F6", "muted-foreground": "#47626E", card: "#FFFFFF", border: "#CFE3EA", ring: "#0369A1", primary: "#0B3C5D", "primary-foreground": "#FFFFFF", accent: "#0369A1", "accent-foreground": "#FFFFFF", ...LIGHT_STATUS },
  },
  {
    id: "berry",
    name: "Berry",
    mood: "Bold and playful, pinks and plums",
    tokens: { background: "#FFF8FB", foreground: "#2E0F20", muted: "#FBEDF3", "muted-foreground": "#75495F", card: "#FFFFFF", border: "#F2D8E4", ring: "#BE185D", primary: "#6D1A45", "primary-foreground": "#FFFFFF", accent: "#BE185D", "accent-foreground": "#FFFFFF", ...LIGHT_STATUS },
  },
  {
    id: "midnight",
    name: "Midnight",
    mood: "Dark and striking, navy and gold",
    tokens: { background: "#0F1420", foreground: "#F1F5F9", muted: "#0A0E17", "muted-foreground": "#A3B0C2", card: "#171E2E", border: "#2A3448", ring: "#F5B83D", primary: "#E2E8F0", "primary-foreground": "#0F1420", accent: "#F5B83D", "accent-foreground": "#1A1405", success: "#34D399", warning: "#FBBF24", danger: "#F87171" },
  },
  {
    id: "mono",
    name: "Black and white",
    mood: "Simple and clean, no colour at all",
    tokens: { background: "#FFFFFF", foreground: "#111111", muted: "#F4F4F5", "muted-foreground": "#5F5F68", card: "#FFFFFF", border: "#E4E4E7", ring: "#111111", primary: "#111111", "primary-foreground": "#FFFFFF", accent: "#111111", "accent-foreground": "#FFFFFF", ...LIGHT_STATUS },
  },
];

export function paletteById(id: string | undefined): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}

/** WCAG contrast ratio of two #rrggbb colours, or null when either can't be read. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminance(hex: string): number | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex.trim());
  const full = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : hex.trim();
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(full);
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const THEME_BLOCK = /@theme\s*\{([\s\S]*?)\}/;

/**
 * The page's own colours, in the stylesheet as well as on <body>: the preview's bundler keeps only
 * what's inside <body>, not its classes. Light themes hide that, but on a dark one everything that
 * inherits its text colour went black on navy (seen in the browser on Midnight).
 */
const PAGE_COLOURS = `@layer base {
        body {
          @apply bg-muted text-foreground;
        }
      }`;

function setToken(theme: string, name: string, value: string): string {
  const line = new RegExp(`--color-${name}\\s*:[^;]*;`);
  return line.test(theme) ? theme.replace(line, `--color-${name}: ${value};`) : `${theme.trimEnd()}\n        --color-${name}: ${value};\n      `;
}

/**
 * Write a palette into the @theme block of public/index.html. Other tokens (fonts, radius) are kept.
 * A page whose block is gone gets a new one, so the choice still lands.
 */
export function applyPalette(html: string, palette: Palette): string {
  const write = (theme: string) => Object.entries(palette.tokens).reduce((t, [name, value]) => setToken(t, name, value), theme);
  const page = html.includes("@apply bg-muted text-foreground") ? "" : `\n      ${PAGE_COLOURS}`;
  if (THEME_BLOCK.test(html)) return html.replace(THEME_BLOCK, (_, theme: string) => `@theme {${write(theme)}}${page}`);
  const block = `<style type="text/tailwindcss">\n      @theme {${write("\n")}}\n      ${PAGE_COLOURS}\n    </style>\n  `;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${block}</head>`) : `${block}${html}`;
}

/** Read the --color-* tokens of a page's @theme block. */
export function readTheme(html: string): Record<string, string> {
  const theme = THEME_BLOCK.exec(html)?.[1] ?? "";
  return Object.fromEntries([...theme.matchAll(/--color-([a-z-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const READABLE = 4.5;

/**
 * For colours the person described in their own words: the model picks them, so nothing promises
 * they're readable. Any text token that falls short against its background becomes black or white,
 * whichever reads better. Colours in another format (rgb, oklch) can't be judged and are left alone.
 */
export function ensureReadable(html: string): string {
  const pairs: Array<[text: string, on: string[]]> = [
    ["primary-foreground", ["primary"]],
    ["accent-foreground", ["accent"]],
    ["foreground", ["background", "muted", "card"]],
    ["muted-foreground", ["background", "muted", "card"]],
  ];
  let out = html;
  for (const [text, backgrounds] of pairs) {
    const theme = readTheme(out);
    const on = backgrounds.map((b) => theme[b]).filter(Boolean);
    if (!theme[text] || !on.length) continue;
    const ratios = on.map((b) => contrastRatio(theme[text], b));
    if (ratios.some((r) => r === null) || ratios.every((r) => (r as number) >= READABLE)) continue;
    const score = (candidate: string) => Math.min(...on.map((b) => contrastRatio(candidate, b) ?? 0));
    const better = score("#111111") >= score("#ffffff") ? "#111111" : "#ffffff";
    out = out.replace(THEME_BLOCK, (_, t: string) => `@theme {${setToken(t, text, better)}}`);
  }
  return out;
}
