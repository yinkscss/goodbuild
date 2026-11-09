/**
 * Landing-page templates (the gallery on the marketing page).
 *
 * Each template is ONE spec that drives two things, so they can't drift apart:
 *  1. the thumbnail: scripts/render-templates.tsx renders the spec to HTML and screenshots it;
 *  2. the build: when a project starts from a template, the server adds `templateBrief(spec)`
 *     to the first build's context (src/server/agent/runner.ts), and the agent writes the page.
 *
 * Every design here is original to GoodBuild. Sources only inspired layouts and are listed with
 * their licences in docs/TEMPLATES.md (permissive sources only; 21st.dev and Pinterest are
 * inspiration, never copied). Copy rules: no em dashes, no lorem ipsum.
 */

import SLIDES from "./page-template-data/slides.json";

export type TemplateCategory = "SaaS" | "Portfolio" | "Web3" | "Store" | "Events" | "Community";

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ["SaaS", "Portfolio", "Web3", "Store", "Events", "Community"];

/** Picture drawn beside or under a hero headline. */
export type HeroArt = "dashboard" | "code" | "phone" | "mint" | "orb" | "chart" | "portrait" | "tiles" | "none";

export type Section =
  | { type: "hero"; variant: "center" | "split"; eyebrow?: string; title: string; sub: string; cta: string; cta2?: string; art?: HeroArt; note?: string }
  | { type: "logos"; label: string; items: string[] }
  | { type: "features"; title: string; sub?: string; items: { icon: string; title: string; text: string }[] }
  | { type: "stats"; items: { value: string; label: string }[] }
  | { type: "steps"; title: string; items: { title: string; text: string }[] }
  | { type: "cards"; title: string; sub?: string; items: { title: string; text: string; meta?: string }[] }
  | { type: "pricing"; title: string; items: { name: string; price: string; note?: string; points: string[]; highlight?: boolean }[] }
  | { type: "quote"; text: string; who: string }
  | { type: "faq"; items: { q: string; a: string }[] }
  | { type: "form"; title: string; sub?: string; placeholder: string; button: string }
  | { type: "list"; title: string; rows: { left: string; mid?: string; right?: string }[] }
  | { type: "cta"; title: string; sub?: string; button: string };

/** A page after Home. It becomes a route (HashRouter, src/pages/) and a nav link of the same name. */
export interface ExtraPage {
  name: string;
  sections: Section[];
}

export interface TemplateTheme {
  bg: string;
  fg: string;
  muted: string;
  card: string;
  accent: string;
  /** Text on the accent colour. */
  accentFg: string;
}

export interface TemplateSource {
  /** What it inspired (layout idea, section pattern). */
  idea: string;
  source: string;
  licence: string;
}

export interface PageTemplate {
  id: string;
  label: string;
  category: TemplateCategory;
  /** "dapp" templates also need a contract or on-chain action; "site" ones are plain pages. */
  kind: "site" | "dapp";
  description: string;
  /** One line on the feel: used in the thumbnail caption and the build brief. */
  mood: string;
  font: "sans" | "serif" | "mono";
  theme: TemplateTheme;
  nav: { brand: string; links: string[]; cta: string };
  /** The Home page. */
  sections: Section[];
  /** More pages, for plain websites. */
  pages?: ExtraPage[];
  footer: string;
  /** For dapps: what the page does on-chain, in plain words. */
  onchain?: string;
  inspiration: TemplateSource[];
}

export const TEMPLATE_THUMB_DIR = "/templates";

export function thumbnailFor(template: Pick<PageTemplate, "id">, slide = 1): string {
  return `${TEMPLATE_THUMB_DIR}/${template.id}${slide > 1 ? `-${slide}` : ""}.png`;
}

/**
 * Every screenshot of a template, in slideshow order: Home, Home scrolled (when the page is long),
 * then each extra page. The count comes from the renderer (slides.json), so it can't drift.
 */
export function thumbnailsFor(template: Pick<PageTemplate, "id">): string[] {
  const n = (SLIDES as Record<string, number>)[template.id] ?? 1;
  return Array.from({ length: n }, (_, i) => thumbnailFor(template, i + 1));
}

/** Placeholder help in the prompt box once a template is attached: what a person might type next. */
export const TEMPLATE_EXAMPLE: Record<TemplateCategory, string> = {
  SaaS: "e.g. A landing page for my invoicing app, with my own name and pricing",
  Portfolio: "e.g. A portfolio for me, a photographer in Accra, with my own projects",
  Web3: "e.g. My own collection: 500 pieces at 10 G$ each",
  Store: "e.g. A shop for my handmade soap business, with my products",
  Events: "e.g. My tech conference on 14 March in Nairobi",
  Community: "e.g. A page for my school's alumni newsletter",
};

/** The short message the user sees in the chat. The full brief is added server-side. */
export function templateRequest(template: Pick<PageTemplate, "label" | "description">): string {
  return `Build the ${template.label} template: ${template.description.charAt(0).toLowerCase()}${template.description.slice(1)}`;
}

const FONT_NOTE: Record<PageTemplate["font"], string> = {
  sans: "a clean sans-serif (the default font stack)",
  serif: "a classic serif for headings (font-serif) with sans-serif body text",
  mono: "a monospace font (font-mono) for headings, labels and code, sans-serif for body text",
};

function describe(s: Section, n: number): string {
  const head = `${n}. `;
  switch (s.type) {
    case "hero":
      return `${head}Hero (${s.variant === "split" ? "text on the left, picture on the right" : "centred"}${s.art && s.art !== "none" ? `, with a ${s.art} illustration drawn in CSS and SVG` : ""}): ${s.eyebrow ? `small label "${s.eyebrow}", ` : ""}headline "${s.title}", line "${s.sub}", primary button "${s.cta}"${s.cta2 ? `, secondary button "${s.cta2}"` : ""}${s.note ? `, small note "${s.note}"` : ""}.`;
    case "logos":
      return `${head}Logo strip, caption "${s.label}": ${s.items.join(", ")} (plain text wordmarks).`;
    case "features":
      return `${head}Features, title "${s.title}"${s.sub ? ` (line: "${s.sub}")` : ""}, a grid of cards each with a lucide icon: ${s.items.map((i) => `${i.icon}: "${i.title}" / "${i.text}"`).join("; ")}.`;
    case "stats":
      return `${head}Stats row: ${s.items.map((i) => `${i.value} ${i.label}`).join("; ")}.`;
    case "steps":
      return `${head}Numbered steps, title "${s.title}": ${s.items.map((i, k) => `${k + 1} "${i.title}" / "${i.text}"`).join("; ")}.`;
    case "cards":
      return `${head}Card grid, title "${s.title}"${s.sub ? ` (line: "${s.sub}")` : ""}: ${s.items.map((i) => `"${i.title}" / "${i.text}"${i.meta ? ` / ${i.meta}` : ""}`).join("; ")}. Each card gets a coloured gradient image area made with CSS.`;
    case "pricing":
      return `${head}Pricing, title "${s.title}": ${s.items.map((i) => `${i.name} ${i.price}${i.note ? ` ${i.note}` : ""} (${i.points.join(", ")})${i.highlight ? " [highlighted]" : ""}`).join("; ")}.`;
    case "quote":
      return `${head}Testimonial: "${s.text}" by ${s.who}.`;
    case "faq":
      return `${head}FAQ with an accordion: ${s.items.map((i) => `"${i.q}" / "${i.a}"`).join("; ")}.`;
    case "form":
      return `${head}Sign-up block, title "${s.title}"${s.sub ? `, line "${s.sub}"` : ""}, email field placeholder "${s.placeholder}", button "${s.button}".`;
    case "list":
      return `${head}List, title "${s.title}": ${s.rows.map((r) => [r.left, r.mid, r.right].filter(Boolean).join(" | ")).join("; ")}.`;
    case "cta":
      return `${head}Closing call to action: "${s.title}"${s.sub ? `, line "${s.sub}"` : ""}, button "${s.button}".`;
  }
}

/**
 * The full design brief the agent receives with the first build. It describes the same sections,
 * copy and colours the thumbnail shows, so the result matches what the user clicked.
 */
export function templateBrief(t: PageTemplate): string {
  const lines = [
    `The person started from the "${t.label}" template (${t.category}, ${t.kind === "dapp" ? "an app with an on-chain part" : "a plain website, no contract"}). They picked it from the gallery and saw its thumbnail, then wrote their own request. Keep the layout, sections and look of the template, and follow their message wherever it differs (their name, business, copy, colours, extra or missing sections). Replace the template's example names and copy with theirs. Do not ask questions, build it now.`,
    `Feel: ${t.mood}. Type: ${FONT_NOTE[t.font]}.`,
    `Colours (set them as the --color-* tokens in public/index.html, and keep text easy to read): page background ${t.theme.bg}, text ${t.theme.fg}, secondary text ${t.theme.muted}, cards ${t.theme.card}, accent ${t.theme.accent} with ${t.theme.accentFg} text on it. ${isDark(t.theme.bg) ? "It is a dark design." : "It is a light design."}`,
    `Top bar: brand "${t.nav.brand}", links ${t.nav.links.map((l) => `"${l}"`).join(", ")}, and a button "${t.nav.cta}"${t.kind === "dapp" ? " (use ConnectButton as the wallet control on the right)" : ""}.`,
    t.pages?.length
      ? `This is a multi-page website. Load the pages-and-routing guide: HashRouter, one file per page in src/pages/, a shared Layout with the top bar and footer, and a nav link for each page. Pages: Home (/), ${t.pages.map((p) => `${p.name} (/${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")})`).join(", ")}. Nav links that match a page name go to that page, the others scroll to a section of Home.`
      : "This is a single page.",
    "Home page sections, top to bottom:",
    ...t.sections.map((s, i) => describe(s, i + 1)),
    ...(t.pages ?? []).flatMap((pg) => [`Page "${pg.name}": a short page title, then:`, ...pg.sections.map((s, i) => describe(s, i + 1))]),
    `Footer: ${t.footer}`,
    t.onchain ? `On-chain part: ${t.onchain}` : "No contract is needed: make every button do something sensible (scroll to a section, open a form, or save to app data when it collects entries).",
    "Make it responsive (stacked on phones, with a compact menu), keep the copy as written, and keep the whole page in a few small files. Placeholder pictures are CSS gradients and inline SVG, not remote images.",
  ];
  return lines.join("\n");
}

export function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum < 0.45;
}
