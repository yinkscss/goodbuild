import "server-only";

import { sanitizeSvg } from "./assets";

type Purifier = { sanitize: (dirty: string, cfg: Record<string, unknown>) => string; removed: unknown[] };
let purifier: Promise<Purifier> | null = null;

/** DOMPurify on a jsdom window, created once (jsdom is heavy; loaded on the first SVG). */
function getPurifier(): Promise<Purifier> {
  purifier ??= (async () => {
    const [{ JSDOM }, { default: createDOMPurify }] = await Promise.all([import("jsdom"), import("dompurify")]);
    const { window } = new JSDOM("");
    return createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]) as unknown as Purifier;
  })();
  return purifier;
}

/**
 * Three passes, so one mistake doesn't let anything through (P17):
 * 1. the regex pre-checks in sanitizeSvg (scripts, entities, foreignObject, external refs, also
 *    unquoted attributes), which reject outright;
 * 2. DOMPurify with its SVG profile, parsing as XML in the SVG namespace, which drops anything
 *    not on its allowlist (event handlers, unknown elements, javascript: URLs);
 * 3. the same checks again on DOMPurify's serialized output, where every attribute is quoted.
 */
export async function sanitizeSvgDocument(text: string): Promise<{ ok: true; svg: string } | { ok: false; error: string }> {
  const first = sanitizeSvg(text);
  if (!first.ok) return first;
  const purify = await getPurifier();
  // HTML parsing, not XML: DOMPurify's XML mode is case-sensitive and drops camelCase SVG tags
  // such as linearGradient (measured). The HTML parser's foreign-content rules keep SVG case.
  const cleaned = purify
    .sanitize(first.svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      // <use> is common in exported logos (Figma, Illustrator). DOMPurify drops it by default;
      // it is safe here because the post-check below only allows #fragment hrefs.
      ADD_TAGS: ["use"],
      FORBID_TAGS: ["foreignObject", "script", "iframe", "embed", "object", "animate", "set", "animateMotion", "animateTransform"],
    })
    .trim();
  // Exactly one <svg> root and nothing around it (HTML parsing would otherwise let stray markup through).
  if (!/^<svg[\s>][\s\S]*<\/svg>$/i.test(cleaned) || (cleaned.match(/<svg[\s>]/gi)?.length ?? 0) !== (cleaned.match(/<\/svg>/gi)?.length ?? 0) || /<\/svg>[\s\S]*<svg[\s>]/i.test(cleaned.replace(/<svg[\s>][\s\S]*$/, (m) => m.slice(0, m.lastIndexOf("</svg>"))))) {
    return { ok: false, error: "That SVG couldn't be read. Export it again as plain SVG or PNG." };
  }
  // A standalone SVG file needs its namespaces declared (the HTML serializer drops them).
  let svg = /^<svg[^>]*\sxmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(cleaned) ? cleaned : cleaned.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (/\sxlink:/.test(svg) && !/\sxmlns:xlink=/.test(svg)) svg = svg.replace(/^<svg/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  const last = sanitizeSvg(svg);
  if (!last.ok) return last;
  return { ok: true, svg: last.svg };
}
