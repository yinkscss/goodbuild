import { readFileSync } from "node:fs";
import path from "node:path";

import { getPageTemplate } from "@/config/page-template-data";

import { TEMPLATE_IMAGE_MODULE } from "@/config/page-templates";
export { TEMPLATE_IMAGE_MODULE } from "@/config/page-templates";

/** Seed the actual photo into the app, so neither Sandpack nor publishing needs our origin. */
export function templateImageFiles(templateId: string | null | undefined): Record<string, string> {
  const template = getPageTemplate(templateId);
  const hero = template?.sections.find((s) => s.type === "hero" && s.image);
  if (!hero || hero.type !== "hero" || !hero.image) return {};
  // This path comes only from the server-owned catalogue, never a user-supplied URL.
  const bytes = readFileSync(path.join(process.cwd(), "public", hero.image.src));
  const image = { src: `data:image/webp;base64,${bytes.toString("base64")}`, alt: hero.image.alt, width: 1200, height: 675 };
  return { [TEMPLATE_IMAGE_MODULE]: `// Original GoodBuild generated photograph, bundled for preview and publishing.\nexport const templateImage = ${JSON.stringify(image)};\n` };
}
