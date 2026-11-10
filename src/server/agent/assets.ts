/**
 * User-uploaded assets: logos, images and design references (AI_AGENT.md §6, P17).
 *
 * Bytes never enter the model's string file map. Apps reference an asset by its stable path
 * `/assets/<name>` (also exported from the platform-owned src/assets/index.ts); the preview
 * swaps those paths for data URLs, because Sandpack runs on another https origin that can't
 * load images from localhost (measured, see DECISIONS P17). The model sees a manifest: name,
 * kind, size, palette and a description.
 */

/** What an upload is for. A person picks one of the first three for an image; the rest follow from the file (D78). */
export type AssetKind = "logo" | "image" | "reference" | "audio" | "font" | "model";
export type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
export type AssetMime = ImageMime | "audio/mpeg" | "audio/ogg" | "audio/wav" | "font/woff2" | "font/woff" | "font/ttf" | "font/otf" | "model/gltf-binary";

/** The kinds a person can choose between for an image. */
export const ASSET_KINDS: AssetKind[] = ["logo", "image", "reference"];

/** Size limits by what the file is (D78). Images stay at 5 MB; sounds, fonts and models differ. */
export const MAX_BYTES_BY_CATEGORY = { image: 5_000_000, audio: 10_000_000, font: 2_000_000, model: 15_000_000 } as const;
/** The largest any single upload may be: the early check on a request's size. */
export const MAX_ASSET_BYTES = Math.max(...Object.values(MAX_BYTES_BY_CATEGORY));
export const MAX_ASSETS_PER_PROJECT = 20;
/** All of a project's uploads together: a published app has a 30 MB limit (publish/build.ts), so this stays under it. */
export const MAX_PROJECT_ASSET_BYTES = 25_000_000;
/** Platform-owned module listing the assets for the app's code. */
export const ASSETS_MODULE = "src/assets/index.ts";

const EXT: Record<AssetMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "model/gltf-binary": "glb",
};

/** Every file extension an upload can have, for matching "/assets/<name>" in code. */
export const ASSET_EXTENSIONS = Object.values(EXT).concat("jpeg").join("|");

export type AssetCategory = keyof typeof MAX_BYTES_BY_CATEGORY;

export function categoryOf(mime: AssetMime): AssetCategory {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("font/")) return "font";
  return "model";
}

export const isImage = (mime: AssetMime): mime is ImageMime => categoryOf(mime) === "image";

/** The kind a file gets when it isn't an image; an image keeps the one chosen for it. */
export function kindFor(mime: AssetMime, chosen: AssetKind): AssetKind {
  const c = categoryOf(mime);
  return c === "image" ? (ASSET_KINDS.includes(chosen) ? chosen : "image") : c;
}

/** Asset metadata (everything but the bytes). */
export interface AssetInfo {
  id: string;
  name: string;
  kind: AssetKind;
  mime: AssetMime;
  size: number;
  width: number | null;
  height: number | null;
  palette: string[];
  description: string;
}

/** The real type from the bytes, not the client's claim. Null for anything we don't accept. */
export function sniffType(bytes: Uint8Array): AssetMime | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 4 && ascii(b, 0, 4) === "OggS") return "audio/ogg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE") return "audio/wav";
  // MP3: an ID3 tag, or the 11 bits of frame sync that start an MPEG audio frame.
  if (b.length >= 3 && ascii(b, 0, 3) === "ID3") return "audio/mpeg";
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return "audio/mpeg";
  if (b.length >= 4 && ascii(b, 0, 4) === "wOF2") return "font/woff2";
  if (b.length >= 4 && ascii(b, 0, 4) === "wOFF") return "font/woff";
  if (b.length >= 4 && ascii(b, 0, 4) === "OTTO") return "font/otf";
  if (b.length >= 4 && ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || ascii(b, 0, 4) === "true")) return "font/ttf";
  // Binary glTF: the magic, then version 2.
  if (b.length >= 12 && ascii(b, 0, 4) === "glTF" && b[4] === 2 && b[5] === 0 && b[6] === 0 && b[7] === 0) return "model/gltf-binary";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 2048)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to));
}

/**
 * Make an SVG safe to serve and to rasterise: no scripts, no event handlers, no entities, no
 * foreignObject, and no external references (librsvg and browsers would fetch them). Fragment
 * links (#id) and embedded raster data URLs stay. Returns an error for anything we won't fix.
 */
export function sanitizeSvg(text: string): { ok: true; svg: string } | { ok: false; error: string } {
  if (/<!ENTITY/i.test(text) || /<!DOCTYPE[^>]*\[/i.test(text)) return { ok: false, error: "SVGs with entity declarations aren't accepted." };
  if (/<\s*script\b/i.test(text)) return { ok: false, error: "SVGs with scripts aren't accepted." };
  if (/<\s*foreignObject\b/i.test(text)) return { ok: false, error: "SVGs with embedded HTML (foreignObject) aren't accepted." };
  let svg = text
    .replace(/<\?xml-stylesheet[^>]*>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    // Event handlers: onload="...", onclick='...', onfocus=bare
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Every href/src must be a fragment or an embedded raster image (quoted or not).
  const refs = [...svg.matchAll(/\s(?:xlink:)?(?:href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((m) => (m[2] ?? m[3] ?? m[4] ?? "").trim());
  if (refs.some((r) => !(r.startsWith("#") || /^data:image\/(png|jpeg|webp);base64,/i.test(r)))) {
    return { ok: false, error: "SVGs that link to external files aren't accepted. Embed or remove the linked images." };
  }
  // CSS: url(...) only to fragments; no @import; no javascript: anywhere.
  if (/@import/i.test(svg) || /javascript:/i.test(svg)) return { ok: false, error: "SVGs with imports or javascript: links aren't accepted." };
  if ([...svg.matchAll(/url\(\s*['"]?([^'")]*)/gi)].some((m) => !m[1].trim().startsWith("#") && !/^data:image\/(png|jpeg|webp);/i.test(m[1].trim()))) {
    return { ok: false, error: "SVGs with external url() references aren't accepted." };
  }
  svg = svg.trim();
  return { ok: true, svg };
}

/** "My Logo (final).PNG" as a logo → "my-logo-final.png", unique among `taken`. */
export function assetFileName(original: string, mime: AssetMime, taken: Iterable<string>): string {
  const base =
    original
      .replace(/\.[A-Za-z0-9]+$/, "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "image";
  const ext = EXT[mime];
  const used = new Set(taken);
  let name = `${base}.${ext}`;
  for (let i = 2; used.has(name); i++) name = `${base}-${i}.${ext}`;
  return name;
}

/** The key in src/assets/index.ts: "my-logo-final.png" → "myLogoFinal". */
export function assetKey(name: string): string {
  const parts = name.replace(/\.[a-z0-9]+$/, "").split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const key = parts.map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1))).join("") || "asset";
  return /^[0-9]/.test(key) ? `a${key}` : key;
}

export function assetPath(name: string): string {
  return `/assets/${name}`;
}

/** Content of the platform-owned src/assets/index.ts. Design references aren't shipped. */
export function assetsModule(assets: AssetInfo[]): string {
  const shipped = assets.filter((a) => a.kind !== "reference").sort((a, b) => a.name.localeCompare(b.name));
  const lines = shipped.map(
    (a) =>
      `  ${assetKey(a.name)}: { src: ${JSON.stringify(assetPath(a.name))}, width: ${a.width ?? 0}, height: ${a.height ?? 0}, alt: ${JSON.stringify(altText(a))} },`,
  );
  return `// Written by GoodBuild from the files the user uploaded. Don't edit: import from it.
// Use the src paths as they are (also fine as literal strings, e.g. in public/index.html).
export interface Asset {
  src: string;
  width: number;
  height: number;
  alt: string;
}

export const assets = {
${lines.join("\n")}
} satisfies Record<string, Asset>;
`;
}

function altText(a: AssetInfo): string {
  if (!isImage(a.mime)) return a.name.replace(/\.[a-z0-9]+$/, "").replace(/-/g, " ");
  const first = a.description.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  if (first && first.length <= 120) return first.replace(/\.$/, "");
  return a.kind === "logo" ? "Logo" : a.name.replace(/\.[a-z]+$/, "").replace(/-/g, " ");
}

/** How the builder uses each kind of file that isn't an image. */
const USE_NOTE: Record<AssetCategory, string> = {
  image: "",
  audio: 'Play it with new Audio(assets.<key>.src) from a tap or click (phones block sound until then). Keep it off until the person starts something.',
  font: 'Use it in a @font-face rule in a <style> in public/index.html or src/index.css: font-family "<Name>", src: url("/assets/<file>") format("woff2"|"woff"|"truetype"|"opentype"), font-display: swap, then put the family in --font-display or --font-sans.',
  model: 'A binary glTF model for the 3D kit: load it with GLTFLoader (three/examples/jsm/loaders/GLTFLoader.js) from assets.<key>.src.',
};

/** The manifest the model sees in its context. */
export function assetManifest(assets: AssetInfo[]): string {
  if (!assets.length) return "";
  const rows = assets.map((a) => {
    const dims = a.width && a.height ? `${a.width}x${a.height}` : "size unknown";
    const palette = a.palette.length ? ` · palette ${a.palette.join(" ")}` : "";
    if (!isImage(a.mime)) return `- ${assetPath(a.name)} (${a.kind}, ${EXT[a.mime]}, ${(a.size / 1_000_000).toFixed(1)} MB) → assets.${assetKey(a.name)}\n  ${USE_NOTE[categoryOf(a.mime)]}`;
    const head =
      a.kind === "reference"
        ? `- ${a.name} (design reference, ${dims}${palette}): NOT shipped in the app; match its layout and style.`
        : `- ${assetPath(a.name)} (${a.kind}, ${a.mime.replace("image/", "")}, ${dims}${palette}) → assets.${assetKey(a.name)}`;
    return a.description ? `${head}\n  ${a.description.replace(/\n+/g, "\n  ")}` : head;
  });
  return `Uploaded assets (import { assets } from the ${ASSETS_MODULE.replace(/^src\//, "").replace(/\/index\.ts$/, "")} folder, or use the /assets/... path as a literal string; load the brand-and-assets guide):\n${rows.join("\n")}`;
}

/** Every literal "/assets/<name>" path a file mentions (for the app check). */
export function assetRefs(content: string): string[] {
  return [...content.matchAll(new RegExp(`/assets/([A-Za-z0-9][A-Za-z0-9._-]*\\.(?:${ASSET_EXTENSIONS}))`, "g"))].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Image analysis (server only; sharp is a native module)

export interface ImageFacts {
  width: number | null;
  height: number | null;
  palette: string[];
}

/** Dimensions and up to 5 dominant colours (near-white, near-black and transparent pixels count less). */
export async function analyseImage(bytes: Uint8Array): Promise<ImageFacts> {
  const sharp = (await import("sharp")).default;
  const img = sharp(bytes, { limitInputPixels: 40_000_000 });
  const meta = await img.metadata();
  const { data, info } = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .resize(64, 64, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: meta.width ?? null, height: meta.height ?? null, palette: dominantColours(data, info.channels) };
}

/** Bucket pixels into a 16-level colour cube, weight, merge near neighbours, return hex. */
export function dominantColours(data: Uint8Array, channels: number, max = 5): string[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i + channels - 1 < data.length; i += channels) {
    const a = channels === 4 ? data[i + 3] : 255;
    if (a < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    e.r += r;
    e.g += g;
    e.b += b;
    e.n += 1;
    buckets.set(key, e);
  }
  const colours = [...buckets.values()]
    .map((e) => {
      const c = { r: e.r / e.n, g: e.g / e.n, b: e.b / e.n };
      const max = Math.max(c.r, c.g, c.b);
      const min = Math.min(c.r, c.g, c.b);
      // Near-white and near-black are usually background or outline, not the brand colour.
      const neutral = (min > 235 || max < 20) && max - min < 20;
      return { ...c, w: e.n * (neutral ? 0.35 : 1) };
    })
    .sort((a, b) => b.w - a.w);
  const picked: typeof colours = [];
  for (const c of colours) {
    if (picked.length >= max) break;
    if (picked.some((p) => Math.hypot(p.r - c.r, p.g - c.g, p.b - c.b) < 48)) continue;
    picked.push(c);
  }
  return picked.map((c) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`);
}

/** A PNG or JPEG copy no larger than `maxSide` for a vision call (SVGs are rasterised). */
export async function visionImage(bytes: Uint8Array, mime: AssetMime, maxSide = 1568): Promise<{ data: string; mediaType: "image/png" | "image/jpeg" }> {
  const sharp = (await import("sharp")).default;
  const pipeline = sharp(bytes, { limitInputPixels: 40_000_000 }).resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true });
  if (mime === "image/jpeg") return { data: (await pipeline.jpeg({ quality: 85 }).toBuffer()).toString("base64"), mediaType: "image/jpeg" };
  return { data: (await pipeline.png().toBuffer()).toString("base64"), mediaType: "image/png" };
}

/** The vision prompt per kind. A reference becomes a layout spec the builder can follow without seeing it. */
export function describePrompt(kind: AssetKind, name: string): string {
  if (kind === "reference") {
    return `This is a design reference (${name}) the user uploaded for a website or dApp they want built. A front-end developer who cannot see it will rebuild its look in React + Tailwind. Describe it as a build spec, in short plain lines, under 220 words:
- Page type and overall feel (one line).
- Navigation: position and items.
- Sections from top to bottom: for each, layout (columns, alignment, card grid), what it contains, and roughly how tall.
- Colours: background, surface/cards, text, accent, as hex estimates.
- Typography: heading style (serif, sans, display; weight; case), body size, any notable font character.
- Shape and spacing: corner radius, borders or shadows, density.
- Imagery: photos, illustrations, icons, gradients.
Describe only what you see. No preamble.`;
  }
  if (kind === "logo") {
    return `This is the user's logo (${name}). In one or two sentences: what the mark shows (symbol and any wordmark text, spelled exactly), its style, and whether it is meant for a light or dark background. No preamble.`;
  }
  return `This is an image the user uploaded (${name}) to use in their website. In one sentence, describe what it shows and where it would fit (hero, section, avatar, background). No preamble.`;
}
