// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  analyseImage,
  assetFileName,
  assetKey,
  assetManifest,
  assetRefs,
  assetsModule,
  dominantColours,
  sanitizeSvg,
  sniffType,
  visionImage,
  type AssetInfo,
} from "./assets";
import { sanitizeSvgDocument } from "./svg-sanitize";

const enc = (s: string) => new TextEncoder().encode(s);

describe("sniffType", () => {
  it("detects types from the bytes, not the name", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const jpg = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ff0000" } }).webp().toBuffer();
    expect(sniffType(png)).toBe("image/png");
    expect(sniffType(jpg)).toBe("image/jpeg");
    expect(sniffType(webp)).toBe("image/webp");
    expect(sniffType(enc('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("image/svg+xml");
  });
  it("rejects everything else", () => {
    expect(sniffType(enc("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffType(enc("GIF89a...."))).toBeNull();
    expect(sniffType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // %PDF
  });
});

describe("sanitizeSvg", () => {
  const ok = (s: string) => {
    const r = sanitizeSvg(s);
    if (!r.ok) throw new Error(r.error);
    return r.svg;
  };
  it("strips event handlers, doctype and stylesheet PIs, keeps fragments and embedded rasters", () => {
    const svg = ok(
      `<?xml-stylesheet href="https://x/y.css"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><use href="#a"/><image href="data:image/png;base64,AAAA"/><rect fill="url(#g)" onclick='x()'/></svg>`,
    );
    expect(svg).not.toMatch(/onload|onclick|DOCTYPE|xml-stylesheet/);
    expect(svg).toContain('href="#a"');
    expect(svg).toContain("url(#g)");
  });
  it("rejects scripts, entities, foreignObject and external references", () => {
    expect(sanitizeSvg('<svg><script>alert(1)</script></svg>').ok).toBe(false);
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>').ok).toBe(false);
    expect(sanitizeSvg("<svg><foreignObject><div/></foreignObject></svg>").ok).toBe(false);
    expect(sanitizeSvg('<svg><image href="https://evil.example/x.png"/></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg><image xlink:href="file:///etc/passwd"/></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg><style>@import url(https://x/y.css);</style></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg><rect style="fill:url(https://x/p.svg#a)"/></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg><a href="javascript:alert(1)"><rect/></a></svg>').ok).toBe(false);
  });
});

describe("sanitizeSvgDocument (regex pre-check, DOMPurify, post-check)", () => {
  it("keeps a normal logo intact, with its namespace, styles, gradients and text", async () => {
    const { readFile } = await import("node:fs/promises");
    const logo = await readFile("docs/evals/harness/kola-logo.svg", "utf8");
    const r = await sanitizeSvgDocument(logo);
    if (!r.ok) throw new Error(r.error);
    expect(r.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(r.svg).toContain("KOLA");
    const styled = await sanitizeSvgDocument(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient><style>.a{fill:url(#g)}</style></defs><rect class="a" width="10" height="10"/></svg>',
    );
    expect(styled.ok && styled.svg).toContain("linearGradient");
    expect(styled.ok && styled.svg).toContain("viewBox");
    // Still a valid standalone SVG: sharp (librsvg) can render it, xlink included.
    const xlink = await sanitizeSvgDocument('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="4" height="4"><defs><rect id="r" width="4" height="4" fill="#0f766e"/></defs><use xlink:href="#r"/></svg>');
    if (!xlink.ok) throw new Error(xlink.error);
    expect((await analyseImage(new TextEncoder().encode(xlink.svg))).palette[0]).toBe("#0f766e");
    if (styled.ok) expect((await analyseImage(new TextEncoder().encode(styled.svg))).width).toBe(10);
  });
  it("rejects unquoted external references and SVG data URLs in use", async () => {
    expect((await sanitizeSvgDocument('<svg xmlns="http://www.w3.org/2000/svg"><image href=https://evil.example/x.png /></svg>')).ok).toBe(false);
    expect((await sanitizeSvgDocument('<svg xmlns="http://www.w3.org/2000/svg"><use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=#x"/></svg>')).ok).toBe(false);
  });
  it("drops handlers and animation tricks the regex can't see", async () => {
    const r = await sanitizeSvgDocument(
      '<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" to="#x"/><rect width="1" height="1"/></a><g><circle r="1" ONLOAD="x()"/></g></svg>',
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.svg).not.toMatch(/animate|onload/i);
    expect(r.svg).toContain("<circle");
  });
  it("rejects files that aren't SVG once parsed", async () => {
    expect((await sanitizeSvgDocument("<svg><p>not closed")).ok).toBe(false);
  });
});

describe("names and the assets module", () => {
  it("slugs file names and keeps them unique", () => {
    expect(assetFileName("My Logo (final).PNG", "image/png", [])).toBe("my-logo-final.png");
    expect(assetFileName("logo.png", "image/png", ["logo.png", "logo-2.png"])).toBe("logo-3.png");
    expect(assetFileName("Скриншот.jpeg", "image/jpeg", [])).toBe("image.jpg");
    expect(assetFileName("../../etc/passwd", "image/webp", [])).toBe("etc-passwd.webp");
  });
  it("makes camelCase keys that are valid identifiers", () => {
    expect(assetKey("my-logo-final.png")).toBe("myLogoFinal");
    expect(assetKey("2026-poster.jpg")).toBe("a2026Poster");
  });
  const logo: AssetInfo = { id: "1", name: "logo.png", kind: "logo", mime: "image/png", size: 10, width: 512, height: 128, palette: ["#0f766e", "#fde047"], description: "A teal coffee cup mark with the wordmark KOLA. For light backgrounds." };
  const ref: AssetInfo = { id: "2", name: "inspo.png", kind: "reference", mime: "image/png", size: 10, width: 1440, height: 900, palette: ["#111111"], description: "Split hero, dark nav." };
  it("exports shipped assets only, with paths and alt text", () => {
    const mod = assetsModule([logo, ref]);
    expect(mod).toContain('logo: { src: "/assets/logo.png", width: 512, height: 128, alt: "A teal coffee cup mark with the wordmark KOLA" }');
    expect(mod).not.toContain("inspo");
  });
  it("lists every asset with palette and description in the manifest", () => {
    const m = assetManifest([logo, ref]);
    expect(m).toContain("/assets/logo.png (logo, png, 512x128 · palette #0f766e #fde047) → assets.logo");
    expect(m).toContain("inspo.png (design reference, 1440x900");
    expect(m).toContain("NOT shipped");
    expect(assetManifest([])).toBe("");
  });
  it("finds literal asset paths in code", () => {
    expect(assetRefs(`<img src="/assets/logo.png" /> url(/assets/hero-2.webp) "/assets/../x"`)).toEqual(["logo.png", "hero-2.webp"]);
  });
});

describe("image analysis", () => {
  it("reads dimensions and puts the brand colour first, not the white background", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#ffffff"/><rect x="20" y="20" width="110" height="60" fill="#0f766e"/><rect x="140" y="20" width="40" height="60" fill="#fde047"/></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const facts = await analyseImage(png);
    expect(facts.width).toBe(200);
    expect(facts.height).toBe(100);
    expect(facts.palette[0]).toBe("#0f766e");
    const near = (hex: string, target: string) => {
      const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const [a, b] = [c(hex), c(target)];
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 24;
    };
    expect(facts.palette.some((p) => near(p, "#fde047")), facts.palette.join(" ")).toBe(true);
  });
  it("ignores transparent pixels", () => {
    const data = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 255, 255]);
    expect(dominantColours(data, 4)).toEqual(["#0000ff"]);
  });
  it("rasterises SVG for vision calls and caps the size", async () => {
    const svg = enc('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1000"><rect width="4000" height="1000" fill="#592e81"/></svg>');
    const img = await visionImage(svg, "image/svg+xml");
    expect(img.mediaType).toBe("image/png");
    const meta = await sharp(Buffer.from(img.data, "base64")).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1568);
  });
});
