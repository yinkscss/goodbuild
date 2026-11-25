import { assetPath, type AssetInfo } from "./assets";

/** Marks the tab-icon link GoodBuild writes, so it can follow the logo (renamed, swapped or removed). */
const MARK = "data-gb-logo";
const OURS = new RegExp(`[ \\t]*<link\\b[^>]*\\b${MARK}\\b[^>]*>\\n?`, "gi");
const ANY_ICON = /<link\b[^>]*\brel=["'](?:shortcut )?icon["'][^>]*>/i;

/**
 * An uploaded logo is the app's tab icon by default (D176). Applied before each build, like the palette, so it
 * isn't an edit. An icon the app already sets (the builder's or the person's own) stays; GoodBuild's own link
 * follows the newest logo and goes when no logo is left, so a removed logo never leaves a broken /assets/ path.
 * `assets` is oldest first, as the store lists them.
 */
export function withLogoIcon(html: string, assets: AssetInfo[]): string {
  const logo = assets.filter((a) => a.kind === "logo" && a.mime.startsWith("image/")).at(-1);
  const without = html.replace(OURS, "");
  if (!logo || ANY_ICON.test(without)) return without;
  const type = logo.mime === "image/svg+xml" ? ` type="image/svg+xml"` : "";
  const link = `<link rel="icon" href="${assetPath(logo.name)}"${type} ${MARK} />`;
  if (!/<\/head>/i.test(without)) return without;
  return without.replace(/([ \t]*)<\/head>/i, (_, indent: string) => `${indent}  ${link}\n${indent}</head>`);
}
