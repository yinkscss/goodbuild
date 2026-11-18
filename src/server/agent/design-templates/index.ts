import { readFileSync } from "node:fs";
import path from "node:path";
import { getPageTemplate } from "@/config/page-template-data";

/** The same editable source is seeded into projects and rendered for gallery screenshots. */
export function designTemplateFiles(id: string | null | undefined): Record<string, string> {
  const t = getPageTemplate(id);
  if (!t?.designSeed) return {};
  const hero = t.sections.find((s) => s.type === "hero");
  if (!hero || hero.type !== "hero") throw new Error(`Missing hero content: ${id}`);
  const root = path.join(process.cwd(), "src/server/agent/design-templates/files");
  const source = (name: string) => readFileSync(path.join(root, name), "utf8");
  return {
    "src/App.tsx": source(`${t.designSeed}.tsx.txt`),
    "src/showcase.css": source("base.css.txt") + "\n" + source(`${t.designSeed}.css.txt`),
    "src/lib/templateContent.ts": `// Editable template copy. Keep the supplied composition when changing these words.\nexport const content = ${JSON.stringify({ brand: t.label, headline: hero.title, sub: hero.sub, footer: t.footer }, null, 2)};\n`,
  };
}
