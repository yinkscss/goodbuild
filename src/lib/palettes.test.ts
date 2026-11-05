import { describe, expect, it } from "vitest";

import { starterFiles } from "@/server/agent/template";

import { PALETTES, applyPalette, contrastRatio, ensureReadable, readTheme } from "./palettes";

describe("palettes", () => {
  it("every palette meets WCAG AA for text on the backgrounds generated apps use", () => {
    const low: string[] = [];
    for (const p of PALETTES) {
      const t = p.tokens;
      const pairs: Array<[string, string, string, number]> = [
        ["foreground", t.foreground, t.background, 4.5],
        ["foreground on muted", t.foreground, t.muted, 4.5],
        ["foreground on card", t.foreground, t.card, 4.5],
        ["muted text on page", t["muted-foreground"], t.background, 4.5],
        ["muted text on muted", t["muted-foreground"], t.muted, 4.5],
        ["muted text on card", t["muted-foreground"], t.card, 4.5],
        ["primary button", t["primary-foreground"], t.primary, 4.5],
        ["accent button", t["accent-foreground"], t.accent, 4.5],
        // The design rules use the accent for key numbers and icons on cards.
        ["accent on card", t.accent, t.card, 3],
        ["success", t.success, t.card, 3],
        ["warning", t.warning, t.card, 3],
        ["danger", t.danger, t.card, 3],
      ];
      for (const [name, a, b, min] of pairs) {
        const ratio = contrastRatio(a, b);
        if (ratio === null || ratio < min) low.push(`${p.id} ${name}: ${ratio}`);
      }
    }
    expect(low).toEqual([]);
  });

  it("are visibly different from each other", () => {
    expect(new Set(PALETTES.map((p) => p.tokens.accent)).size).toBe(PALETTES.length);
    expect(PALETTES.length).toBeGreaterThanOrEqual(4);
  });

  it("writes a palette into the starter's @theme block and keeps the rest of the page", () => {
    const html = starterFiles()["public/index.html"];
    const out = applyPalette(html, PALETTES[1]);
    expect(readTheme(out).accent).toBe(PALETTES[1].tokens.accent);
    expect(readTheme(out).muted).toBe(PALETTES[1].tokens.muted);
    expect(out).toContain("--radius-lg: 0.75rem");
    expect(out).toContain('<div id="root"></div>');
    // Applying twice changes nothing, so re-applying after the model's work is safe.
    expect(applyPalette(out, PALETTES[1])).toBe(out);
  });

  it("still lands when the page lost its theme block or a token", () => {
    const out = applyPalette("<html><head><title>x</title></head><body></body></html>", PALETTES[0]);
    expect(readTheme(out).accent).toBe(PALETTES[0].tokens.accent);
    const partial = applyPalette("<style>@theme { --color-accent: #000; --font-sans: Inter; }</style>", PALETTES[0]);
    expect(readTheme(partial).primary).toBe(PALETTES[0].tokens.primary);
    expect(partial).toContain("--font-sans: Inter");
  });

  it("fixes unreadable text in colours the person described, and leaves good ones alone", () => {
    const bad = "<style>@theme { --color-accent: #eab308; --color-accent-foreground: #ffffff; --color-background: #fff; --color-foreground: #222; }</style>";
    const out = ensureReadable(bad);
    expect(contrastRatio(readTheme(out)["accent-foreground"], "#eab308")).toBeGreaterThanOrEqual(4.5);
    expect(readTheme(out).foreground).toBe("#222");
    const unknown = "<style>@theme { --color-accent: oklch(70% 0.1 20); --color-accent-foreground: #fff; }</style>";
    expect(ensureReadable(unknown)).toBe(unknown);
  });
});
