/**
 * Renders every page template to HTML, screenshots it with headless Chrome and writes
 * public/templates/<id>.png. The thumbnail is therefore a real render of the same spec the
 * build brief is made from (src/config/page-templates.ts).
 *
 *   pnpm tsx scripts/render-templates.tsx [--only id,id] [--html-only]
 *
 * Needs Google Chrome (CHROME_PATH to override). HTML goes to $TMPDIR/gb-templates/.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as Lucide from "lucide-react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";

import { PAGE_TEMPLATES } from "../src/config/page-template-data";
import type { HeroArt, PageTemplate, Section } from "../src/config/page-templates";

const h = React.createElement;
const W = 1280;
const H = 800;

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const C = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>>)[name];
  if (!C) throw new Error(`Unknown lucide icon "${name}"`);
  return h(C, { size, strokeWidth: 1.75 });
}

function css(t: PageTemplate): string {
  const { bg, fg, muted, card, accent, accentFg } = t.theme;
  const fonts = {
    sans: `ui-sans-serif, -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`,
    serif: `ui-serif, "New York", Georgia, "Times New Roman", serif`,
    mono: `ui-monospace, "SF Mono", Menlo, monospace`,
  };
  const heading = t.font === "sans" ? fonts.sans : fonts[t.font];
  return `
*{box-sizing:border-box;margin:0}
:root{--bg:${bg};--fg:${fg};--muted:${muted};--card:${card};--a:${accent};--af:${accentFg}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 ${fonts.sans};width:${W}px;min-height:${H}px;overflow:hidden}
.links .on{color:var(--fg);font-weight:600}
.ptitle{padding:34px 0 6px}.ptitle h1{font-size:44px}
h1,h2,h3,.brand{font-family:${heading}}
.nav{display:flex;align-items:center;justify-content:space-between;padding:22px 64px}
.brand{font-weight:700;font-size:19px;letter-spacing:-.01em}
.links{display:flex;gap:30px;color:var(--muted);font-size:14px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 22px;border-radius:999px;background:var(--a);color:var(--af);font-weight:600;font-size:14px}
.btn.ghost{background:transparent;color:var(--fg);box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--fg) 22%,transparent)}
.page{padding:0 64px}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--a);font-weight:700;margin-bottom:16px}
h1{font-size:54px;line-height:1.04;letter-spacing:-.025em;font-weight:700}
h2{font-size:30px;letter-spacing:-.02em;margin-bottom:18px}
.sub{color:var(--muted);font-size:18px;line-height:1.5;margin:18px 0 28px;max-width:520px}
.hero{display:grid;grid-template-columns:1.1fr 1fr;gap:48px;align-items:center;padding:34px 0 40px}
.hero.center{grid-template-columns:1fr;text-align:center;justify-items:center;padding-top:44px}
.hero.center h1{max-width:880px;font-size:58px}
.hero.center .sub{margin-left:auto;margin-right:auto;max-width:620px}
.row{display:flex;gap:12px}
.center .row{justify-content:center}
.note{margin-top:16px;font-size:13px;color:var(--muted)}
.sec{padding:26px 0}
.grid{display:grid;gap:16px}
.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}.g2{grid-template-columns:repeat(2,1fr)}
.card{background:var(--card);border-radius:18px;padding:22px;box-shadow:0 1px 2px rgba(0,0,0,.05),0 12px 30px -18px rgba(0,0,0,.25)}
.card h3{font-size:17px;margin:10px 0 4px}.card p{color:var(--muted);font-size:14px}
.ico{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--a) 16%,transparent);color:var(--a)}
.stats{display:flex;gap:64px;padding:20px 0;justify-content:center}
.stat b{display:block;font-size:34px;letter-spacing:-.02em;color:var(--a)}.stat span{color:var(--muted);font-size:14px}
.thumb{height:92px;border-radius:12px;margin-bottom:12px}
.meta{font-size:12px;color:var(--a);font-weight:600;margin-top:8px}
.price{font-size:32px;font-weight:700;margin:6px 0}.price small{font-size:13px;color:var(--muted);font-weight:500}
.hi{box-shadow:0 0 0 2px var(--a),0 18px 40px -20px rgba(0,0,0,.4)}
.pts{list-style:none;padding:0;margin-top:10px;color:var(--muted);font-size:14px}.pts li{padding:3px 0}
.pts li:before{content:"";display:inline-block;width:7px;height:7px;border-radius:9px;background:var(--a);margin-right:9px}
.logos{display:flex;gap:44px;justify-content:center;align-items:center;color:var(--muted);font-weight:700;padding:16px 0;font-size:16px;opacity:.8}
.logos small{font-weight:500;font-size:13px}
.list .r{display:flex;justify-content:space-between;gap:20px;padding:12px 18px;background:var(--card);border-radius:14px;margin-bottom:8px}
.list .r span:nth-child(2){color:var(--muted);flex:1;padding-left:18px}.list .r span:last-child{color:var(--a);font-weight:600}
.form{display:flex;gap:10px;margin-top:6px}.field{flex:1;max-width:340px;background:var(--card);border-radius:999px;padding:12px 20px;color:var(--muted);font-size:14px;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fg) 12%,transparent)}
.quote{background:var(--card);border-radius:20px;padding:26px 32px;font-size:22px;line-height:1.35;letter-spacing:-.01em}.quote small{display:block;margin-top:10px;font-size:14px;color:var(--muted)}
.faq .q{background:var(--card);border-radius:14px;padding:14px 18px;margin-bottom:8px;font-weight:600}.faq .q p{font-weight:400;color:var(--muted);font-size:14px;margin-top:4px}
.cta{background:var(--a);color:var(--af);border-radius:24px;padding:36px;text-align:center}.cta h2{margin-bottom:8px}.cta .btn{background:var(--af);color:var(--a);margin-top:12px}
.step b{display:grid;place-items:center;width:30px;height:30px;border-radius:99px;background:var(--a);color:var(--af);font-size:14px;margin-bottom:10px}
.art{position:relative;height:340px;border-radius:24px;overflow:hidden;background:var(--card);box-shadow:0 20px 50px -24px rgba(0,0,0,.35)}
.bar{position:absolute;bottom:0;width:36px;border-radius:8px 8px 0 0;background:color-mix(in srgb,var(--a) 70%,transparent)}
.ln{position:absolute;left:24px;right:24px;height:10px;border-radius:6px;background:color-mix(in srgb,var(--fg) 14%,transparent)}
.orb{position:absolute;left:50%;top:50%;width:290px;height:290px;margin:-145px 0 0 -145px;border-radius:50%;background:radial-gradient(circle at 35% 30%,color-mix(in srgb,var(--a) 85%,#fff),var(--a) 40%,color-mix(in srgb,var(--a) 20%,var(--bg)) 75%);filter:blur(1px)}
.tile{position:absolute;border-radius:16px}
.phone{position:absolute;left:50%;top:22px;width:190px;height:420px;margin-left:-95px;border-radius:32px;background:var(--fg);padding:8px}
.phone i{display:block;height:100%;border-radius:25px;background:var(--bg);padding:18px 14px}
.code{font:13px/1.8 ui-monospace,Menlo,monospace;padding:22px;color:var(--fg)}
.code .k{color:var(--a)}.code .c{color:var(--muted)}
`;
}

function gradient(i: number, t: PageTemplate): string {
  const hue = [0, 40, 80, 320, 200, 120][i % 6];
  return `linear-gradient(${120 + i * 25}deg,color-mix(in srgb,${t.theme.accent} ${70 - i * 6}%,#fff),hsl(${(hue + 20 * i) % 360} 70% 62%))`;
}

function Art({ kind, t }: { kind: HeroArt; t: PageTemplate }) {
  const bars = [38, 56, 44, 72, 60, 88, 76, 100];
  if (kind === "dashboard")
    return h("div", { className: "art" },
      h("div", { className: "ln", style: { top: 24, width: 120 } }),
      h("div", { style: { position: "absolute", top: 54, left: 24, right: 24, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 } },
        [0, 1, 2].map((i) => h("div", { key: i, style: { height: 70, borderRadius: 14, background: `color-mix(in srgb,${t.theme.accent} ${14 + i * 10}%,transparent)` } }))),
      bars.map((b, i) => h("div", { key: i, className: "bar", style: { left: 24 + i * 52, height: b * 1.5 } })));
  if (kind === "chart")
    return h("div", { className: "art" },
      h("svg", { viewBox: "0 0 400 340", width: "100%", height: "100%", preserveAspectRatio: "none" },
        h("defs", null, h("linearGradient", { id: "g", x1: 0, y1: 0, x2: 0, y2: 1 }, h("stop", { offset: "0", stopColor: t.theme.accent, stopOpacity: 0.45 }), h("stop", { offset: "1", stopColor: t.theme.accent, stopOpacity: 0 }))),
        h("path", { d: "M0 260 C40 240 60 270 100 220 S160 180 200 190 S260 120 300 130 S360 60 400 40 L400 340 L0 340Z", fill: "url(#g)" }),
        h("path", { d: "M0 260 C40 240 60 270 100 220 S160 180 200 190 S260 120 300 130 S360 60 400 40", fill: "none", stroke: t.theme.accent, strokeWidth: 3, strokeLinecap: "round" })));
  if (kind === "code")
    return h("div", { className: "art" },
      h("div", { className: "code" },
        h("div", { className: "c" }, "$ shipkit ship"),
        h("div", null, h("span", { className: "k" }, "build "), "compiled in 14s"),
        h("div", null, h("span", { className: "k" }, "test  "), "128 passed"),
        h("div", null, h("span", { className: "k" }, "ship  "), "live on 24 edge regions"),
        h("div", { className: "c" }, "https://app.example.com"),
        h("div", { style: { marginTop: 14 } }, h("span", { className: "k" }, "export const "), "config = {"),
        h("div", null, "  framework: ", h("span", { className: "k" }, '"auto"'), ","),
        h("div", null, "  regions: [", h("span", { className: "k" }, '"lagos"'), ", ", h("span", { className: "k" }, '"nairobi"'), "],"),
        h("div", null, "}")));
  if (kind === "phone")
    return h("div", { className: "art", style: { background: "transparent", boxShadow: "none" } },
      h("div", { className: "phone" }, h("i", null,
        h("div", { className: "ln", style: { top: 40, left: 20, width: 70 } }),
        h("div", { style: { marginTop: 36, fontSize: 30, fontWeight: 700, color: t.theme.fg } }, "$128.40"),
        h("div", { style: { marginTop: 8, height: 54, borderRadius: 14, background: t.theme.accent } }),
        [0, 1, 2].map((i) => h("div", { key: i, style: { marginTop: 10, height: 36, borderRadius: 10, background: t.theme.card } })))));
  if (kind === "mint" || kind === "tiles")
    return h("div", { className: "art", style: { background: "transparent", boxShadow: "none" } },
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 } },
        Array.from({ length: 6 }, (_, i) => h("div", { key: i, style: { aspectRatio: "1", borderRadius: kind === "mint" ? 20 : 12, background: gradient(i, t), position: "relative" } },
          kind === "mint" ? h("div", { style: { position: "absolute", left: "30%", top: "28%", width: "40%", height: "40%", borderRadius: "50%", background: "rgba(255,255,255,.55)" } }) : null))));
  if (kind === "orb") return h("div", { className: "art", style: { background: "transparent", boxShadow: "none" } }, h("div", { className: "orb" }));
  if (kind === "portrait")
    return h("div", { className: "art", style: { height: 300 } },
      h("div", { style: { position: "absolute", inset: 0, background: gradient(1, t) } }),
      h("div", { style: { position: "absolute", left: "50%", top: 60, marginLeft: -50, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,.85)" } }),
      h("div", { style: { position: "absolute", left: "50%", top: 150, marginLeft: -90, width: 180, height: 200, borderRadius: "90px 90px 0 0", background: "rgba(255,255,255,.7)" } }));
  return null;
}

function Block({ s, t }: { s: Section; t: PageTemplate }) {
  switch (s.type) {
    case "hero": {
      const text = h("div", null,
        s.eyebrow ? h("div", { className: "eyebrow" }, s.eyebrow) : null,
        h("h1", null, s.title),
        h("p", { className: "sub" }, s.sub),
        h("div", { className: "row" }, h("span", { className: "btn" }, s.cta), s.cta2 ? h("span", { className: "btn ghost" }, s.cta2) : null),
        s.note ? h("div", { className: "note" }, s.note) : null);
      return h("div", { className: `hero ${s.variant}` }, text, s.variant === "split" && s.art && s.art !== "none" ? h(Art, { kind: s.art, t }) : null,
        s.variant === "center" && s.art && s.art !== "none" ? h("div", { style: { width: 360, marginTop: 8 } }, h(Art, { kind: s.art, t })) : null);
    }
    case "logos": return h("div", { className: "logos" }, h("small", null, s.label), s.items.map((i) => h("span", { key: i }, i)));
    case "features": return h("div", { className: "sec" }, h("h2", null, s.title), h("div", { className: "grid g3" }, s.items.map((i) => h("div", { key: i.title, className: "card" }, h("div", { className: "ico" }, h(Icon, { name: i.icon })), h("h3", null, i.title), h("p", null, i.text)))));
    case "stats": return h("div", { className: "stats" }, s.items.map((i) => h("div", { key: i.label, className: "stat" }, h("b", null, i.value), h("span", null, i.label))));
    case "steps": return h("div", { className: "sec" }, h("h2", null, s.title), h("div", { className: "grid g3" }, s.items.map((i, k) => h("div", { key: i.title, className: "card step" }, h("b", null, k + 1), h("h3", null, i.title), h("p", null, i.text)))));
    case "cards": return h("div", { className: "sec" }, h("h2", null, s.title), h("div", { className: `grid ${s.items.length > 3 ? "g4" : "g3"}` }, s.items.map((i, k) => h("div", { key: i.title, className: "card" }, h("div", { className: "thumb", style: { background: gradient(k, t) } }), h("h3", null, i.title), h("p", null, i.text), i.meta ? h("div", { className: "meta" }, i.meta) : null))));
    case "pricing": return h("div", { className: "sec" }, h("h2", null, s.title), h("div", { className: `grid ${s.items.length === 2 ? "g2" : "g3"}` }, s.items.map((i) => h("div", { key: i.name, className: `card ${i.highlight ? "hi" : ""}` }, h("div", { style: { fontWeight: 600 } }, i.name), h("div", { className: "price" }, i.price, " ", i.note ? h("small", null, i.note) : null), h("ul", { className: "pts" }, i.points.map((p) => h("li", { key: p }, p)))))));
    case "quote": return h("div", { className: "sec" }, h("div", { className: "quote" }, `“${s.text}”`, h("small", null, s.who)));
    case "faq": return h("div", { className: "sec faq" }, h("h2", null, "Questions"), s.items.map((i) => h("div", { key: i.q, className: "q" }, i.q, h("p", null, i.a))));
    case "form": return h("div", { className: "sec" }, h("h2", null, s.title), s.sub ? h("p", { className: "sub", style: { margin: "0 0 14px" } }, s.sub) : null, h("div", { className: "form" }, h("div", { className: "field" }, s.placeholder), h("span", { className: "btn" }, s.button)));
    case "list": return h("div", { className: "sec list" }, h("h2", null, s.title), s.rows.map((r) => h("div", { key: r.left, className: "r" }, h("span", null, r.left), h("span", null, r.mid ?? ""), h("span", null, r.right ?? ""))));
    case "cta": return h("div", { className: "sec" }, h("div", { className: "cta" }, h("h2", null, s.title), s.sub ? h("p", null, s.sub) : null, h("span", { className: "btn" }, s.button)));
  }
}

/** page 0 is Home; 1.. are t.pages. */
export function renderTemplateHtml(t: PageTemplate, page = 0): string {
  const extra = page > 0 ? t.pages![page - 1] : null;
  const sections = extra ? extra.sections : t.sections;
  const body = renderToStaticMarkup(
    h("div", null,
      h("div", { className: "nav" }, h("span", { className: "brand" }, t.nav.brand), h("div", { className: "links" }, t.nav.links.map((l) => h("span", { key: l, className: extra && l.toLowerCase() === extra.name.toLowerCase() ? "on" : "" }, l))), h("span", { className: "btn" }, t.nav.cta)),
      h("div", { className: "page" }, extra ? h("div", { className: "ptitle" }, h("h1", null, extra.name)) : null, sections.map((s, i) => h(Block, { key: i, s, t })))),
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>${t.label}</title><style>${css(t)}</style></head><body>${body}<script>document.documentElement.dataset.h=String(document.body.scrollHeight)</script></body></html>`;
}

function chromePath(): string {
  return process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  const htmlOnly = args.includes("--html-only");
  const dir = path.join(process.env.TMPDIR ?? tmpdir(), "gb-templates");
  const out = path.join(process.cwd(), "public", "templates");
  mkdirSync(dir, { recursive: true });
  mkdirSync(out, { recursive: true });
  const slidesFile = path.join(process.cwd(), "src", "config", "page-template-data", "slides.json");
  const slides: Record<string, number> = existsSync(slidesFile) ? JSON.parse(readFileSync(slidesFile, "utf8")) : {};
  for (const t of PAGE_TEMPLATES.filter((x) => !only || only.includes(x.id))) {
    // Slide order: Home, Home scrolled (only when the page is long), then each extra page.
    const shots: Array<{ page: number; lower: boolean }> = [{ page: 0, lower: false }];
    let n = 0;
    for (let page = 0; page <= (t.pages?.length ?? 0); page++) {
      const file = path.join(dir, `${t.id}-${page}.html`);
      writeFileSync(file, renderTemplateHtml(t, page));
      if (htmlOnly) continue;
      const dom = execFileSync(chromePath(), ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${W},${H}`, "--virtual-time-budget=2000", "--dump-dom", `file://${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const height = Math.max(H, Number(/data-h="(\d+)"/.exec(dom)?.[1] ?? H));
      const raw = path.join(dir, `${t.id}-${page}.raw.png`);
      execFileSync(chromePath(), ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${W},${height}`, `--screenshot=${raw}`, `file://${file}`], { stdio: "ignore" });
      const save = async (top: number) => {
        n += 1;
        const name = n === 1 ? `${t.id}.png` : `${t.id}-${n}.png`;
        await sharp(raw).extract({ left: 0, top, width: W, height: H }).resize(960, 600).png({ palette: true, quality: 88, compressionLevel: 9 }).toFile(path.join(out, name));
      };
      await save(0);
      if (page === 0 && height > 1000) await save(Math.min(H, height - H));
    }
    void shots;
    if (!htmlOnly) {
      slides[t.id] = n;
      console.log("rendered", t.id, n, "slides");
    }
  }
  if (!htmlOnly) writeFileSync(slidesFile, JSON.stringify(slides, null, 2) + "\n");
}

if (process.argv[1]?.endsWith("render-templates.tsx")) void main();
