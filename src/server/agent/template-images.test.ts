// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PAGE_TEMPLATES } from "@/config/page-template-data";
import { templateBrief } from "@/config/page-templates";
import { pathProblem } from "./checks";
import { selectContext } from "./codebase";
import { Workspace } from "./workspace";
import { loadGuides } from "./guides";
import { TEMPLATE_IMAGE_MODULE, templateImageFiles } from "./template-images";

describe("classic template assets and harness guidance", () => {
  it("ships the same photo bytes the preview uses, without a hosting-origin dependency", () => {
    for (const t of PAGE_TEMPLATES.filter((t) => t.category === "Classic")) {
      const hero = t.sections.find((s) => s.type === "hero");
      const files = templateImageFiles(t.id);
      if (hero?.type !== "hero" || !hero.image) {
        expect(files).toEqual({});
        continue;
      }
      const source = files[TEMPLATE_IMAGE_MODULE];
      const payload = JSON.parse(source.split("export const templateImage = ")[1].replace(/;\n$/, ""));
      expect(payload.alt).toBe(hero.image.alt);
      expect(payload.src).toMatch(/^data:image\/webp;base64,/);
      const bytes = Buffer.from(payload.src.split(",")[1], "base64");
      expect(bytes).toEqual(readFileSync(path.join(process.cwd(), "public", hero.image.src)));
      expect(bytes.length).toBeGreaterThan(10_000);
      expect(bytes.length).toBeLessThan(200_000);
      expect(templateBrief(t)).toContain("templateImage");
    }
  });

  it("keeps encoded photos out of model reads and context while exposing the import API", () => {
    const files = templateImageFiles("classic-stillhouse");
    const ws = new Workspace(files);
    const read = ws.execute("read_file", JSON.stringify({ path: TEMPLATE_IMAGE_MODULE }), "build");
    expect(read.ok).toBe(true);
    expect(read.result).toContain("templateImage");
    expect(read.result).toContain("Sunlit limewash room");
    expect(read.result).not.toContain("data:image/webp;base64,");
    expect(read.result.length).toBeLessThan(1000);
    expect(selectContext(files, "template image", { budgetChars: 1_000_000 })).toEqual([]);
    expect(pathProblem(TEMPLATE_IMAGE_MODULE)).toContain("bundled photograph");
    const edit = ws.execute("edit_file", JSON.stringify({ path: TEMPLATE_IMAGE_MODULE, edits: [{ search: "Original", replace: "Changed" }] }), "build");
    expect(edit.ok).toBe(false);
    expect(edit.result).toContain("bundled photograph");
    expect(ws.files[TEMPLATE_IMAGE_MODULE]).toBe(files[TEMPLATE_IMAGE_MODULE]);
  });

  it("leaves legacy starters and unknown template ids alone", () => {
    for (const id of [null, "tip-jar", "flowdesk", "../outside"]) expect(templateImageFiles(id)).toEqual({});
  });

  it("loads the original classic guides via the existing harness tool", () => {
    const result = loadGuides(["classic-web-design", "restrained-motion"]);
    expect(result.loaded).toEqual(["classic-web-design", "restrained-motion"]);
    expect(result.text).toContain("prefers-reduced-motion");
    expect(result.text).toContain("templateImage.ts");
  });
});
