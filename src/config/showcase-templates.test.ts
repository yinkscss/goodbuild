import { describe, expect, it } from "vitest";
import { PAGE_TEMPLATES } from "./page-template-data";
import { templateBrief } from "./page-templates";

const ids = ["classic-halo", "classic-elsewhere", "classic-frame-archive", "classic-signal-form", "classic-nocturne"];

describe("the five art-directed templates", () => {
  it("leads the library with exactly five distinct runnable designs", () => {
    expect(PAGE_TEMPLATES.slice(0, 5).map((t) => t.id)).toEqual(ids);
    const seeded = PAGE_TEMPLATES.filter((t) => "designSeed" in t);
    expect(seeded.map((t) => t.id)).toEqual(ids);
    for (const t of seeded) {
      expect(t.category).toBe("Classic");
      expect(templateBrief(t)).toContain("art-directed-web");
      expect(templateBrief(t)).toContain("already seeded");
      expect(templateBrief(t)).not.toContain("Load classic-web-design");
      expect(templateBrief(t)).not.toContain("Top bar:");
      expect(templateBrief(t)).not.toContain("Hero (centred");
    }
  });
});
