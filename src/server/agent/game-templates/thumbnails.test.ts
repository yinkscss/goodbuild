// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GAME_TEMPLATES, GAME_TEMPLATE_ART, gameTemplateStarters } from "./index";

describe("game template thumbnails", () => {
  it("point only at art that exists, so the picker never shows a broken image", () => {
    for (const starter of gameTemplateStarters()) {
      if (starter.thumbnail) expect(existsSync(join(process.cwd(), "public", starter.thumbnail)), starter.thumbnail).toBe(true);
    }
    for (const id of GAME_TEMPLATE_ART) expect(GAME_TEMPLATES.some((t) => t.id === id), id).toBe(true);
  });

  it("leave a template without art to the picker's icon", () => {
    const art = gameTemplateStarters().filter((s) => s.thumbnail).length;
    expect(art).toBe(GAME_TEMPLATE_ART.size);
    expect(gameTemplateStarters().find((s) => s.id === "crane-stack")?.thumbnail).toBeUndefined();
  });
});
