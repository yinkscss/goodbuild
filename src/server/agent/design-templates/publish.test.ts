// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PAGE_TEMPLATES } from "@/config/page-template-data";
import { buildPublishedApp } from "@/server/publish/build";
import { typeCheck } from "../type-check";
import { starterFiles } from "../template";
import { templateImageFiles } from "../template-images";
import { checkApp } from "../checks";
import { designTemplateFiles } from "./index";

describe("publishing the same code the gallery previews", () => {
  it("builds all five actual seed apps with local imagery and no broken imports", async () => {
    for (const t of PAGE_TEMPLATES.filter((t) => t.designSeed)) {
      const files = { ...starterFiles(), ...templateImageFiles(t.id), ...designTemplateFiles(t.id) };
      expect(checkApp(files).errors, t.id).toEqual([]);
      const built = await buildPublishedApp({ files, assets: [], title: t.label, hasUndeployedContracts: false, showBadge: false });
      expect(built.some((f) => f.path === "index.html"), t.id).toBe(true);
      const js = built.filter((f) => f.path.endsWith(".js")).map((f) => Buffer.from(f.bytes).toString()).join("\n");
      expect(js.includes("data:image/webp;base64,"), t.id).toBe(true);
      expect(js.includes("/templates/"), t.id).toBe(false);
      expect(built.some((f) => f.path.endsWith(".css")), t.id).toBe(true);
    }
  }, 120_000);
  it("type-checks all five starter apps against the generated-app runtime", async () => {
    for (const t of PAGE_TEMPLATES.filter((t) => t.designSeed)) {
      const result = await typeCheck({ ...starterFiles(), ...templateImageFiles(t.id), ...designTemplateFiles(t.id) }, { timeoutMs: 90_000 });
      expect(result.ran, `${t.id}: ${result.note}`).toBe(true);
      expect(result.issues, t.id).toEqual([]);
    }
  }, 180_000);

});
