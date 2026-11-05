import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FOOTER_COLUMNS, NAV_LINKS } from "./site-links";

const landingDir = join(process.cwd(), "src/components/landing");
const landingSource = [
  readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8"),
  ...readdirSync(landingDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => readFileSync(join(landingDir, f), "utf8")),
].join("\n");

const internal = [...NAV_LINKS, ...FOOTER_COLUMNS.flatMap((c) => c.links)].filter((l) => l.href.startsWith("/"));

describe("site links", () => {
  it.each(internal)("$label ($href) points at something real", ({ href }) => {
    if (href.startsWith("/#")) expect(landingSource).toContain(`id="${href.slice(2)}"`);
    else expect(existsSync(join(process.cwd(), "src/app", href, "page.tsx"))).toBe(true);
  });
});
