import { describe, expect, it } from "vitest";

import type { AssetInfo } from "./assets";
import { withLogoIcon } from "./logo-icon";

const HTML = `<!doctype html>
<html>
  <head>
    <title>App</title>
  </head>
  <body></body>
</html>`;

const asset = (name: string, kind: AssetInfo["kind"], mime: AssetInfo["mime"] = "image/png"): AssetInfo => ({
  id: name,
  name,
  kind,
  mime,
  size: 1,
  width: 1,
  height: 1,
  palette: [],
  description: "",
});

describe("withLogoIcon", () => {
  it("makes an uploaded logo the tab icon", () => {
    const out = withLogoIcon(HTML, [asset("brand.png", "logo")]);
    expect(out).toContain(`<link rel="icon" href="/assets/brand.png" data-gb-logo />`);
    expect(out.indexOf("data-gb-logo")).toBeLessThan(out.indexOf("</head>"));
  });

  it("marks an SVG logo's type", () => {
    expect(withLogoIcon(HTML, [asset("mark.svg", "logo", "image/svg+xml")])).toContain(`href="/assets/mark.svg" type="image/svg+xml"`);
  });

  it("does nothing without a logo", () => {
    expect(withLogoIcon(HTML, [asset("photo.jpg", "image", "image/jpeg")])).toBe(HTML);
  });

  it("keeps an icon the app already sets", () => {
    const own = HTML.replace("</head>", `  <link rel="icon" href="/assets/other.png" />\n  </head>`);
    expect(withLogoIcon(own, [asset("brand.png", "logo")])).toBe(own);
  });

  it("follows the newest logo and runs again without adding a second link", () => {
    const first = withLogoIcon(HTML, [asset("old.png", "logo")]);
    const second = withLogoIcon(first, [asset("old.png", "logo"), asset("new.png", "logo")]);
    expect(second).toContain("/assets/new.png");
    expect(second).not.toContain("/assets/old.png");
    expect(second.match(/data-gb-logo/g)).toHaveLength(1);
    expect(withLogoIcon(second, [asset("old.png", "logo"), asset("new.png", "logo")])).toBe(second);
  });

  it("removes its link when the logo is gone", () => {
    const withIcon = withLogoIcon(HTML, [asset("brand.png", "logo")]);
    expect(withLogoIcon(withIcon, [])).toBe(HTML);
  });
});
