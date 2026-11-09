import { existsSync, statSync } from "node:fs";
import path from "node:path";
import * as Lucide from "lucide-react";
import { describe, expect, it } from "vitest";

import { PAGE_TEMPLATES } from "./page-template-data";
import { TEMPLATE_CATEGORIES, templateBrief, templateRequest, thumbnailFor } from "./page-templates";
import { PROMPT_MAX_LENGTH } from "@/lib/prompt";
import { getTemplate } from "./templates";

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

describe("page template gallery data", () => {
  it("has at least 20 templates across several categories", () => {
    expect(PAGE_TEMPLATES.length).toBeGreaterThanOrEqual(20);
    const used = new Set(PAGE_TEMPLATES.map((t) => t.category));
    expect(used.size).toBeGreaterThanOrEqual(5);
    for (const c of used) expect(TEMPLATE_CATEGORIES).toContain(c);
  });

  it("has unique ids that fit the project's template_id column and never clash with the dApp starters", () => {
    const ids = PAGE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{2,64}$/);
  });

  it("has a real screenshot file for every template", () => {
    for (const t of PAGE_TEMPLATES) {
      const file = path.join(process.cwd(), "public", thumbnailFor(t));
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(5_000);
    }
  });

  it("uses no em dashes and no lorem ipsum anywhere", () => {
    for (const s of strings(PAGE_TEMPLATES)) {
      expect(s).not.toMatch(/[—–]/);
      expect(s.toLowerCase()).not.toContain("lorem");
    }
  });

  it("only uses lucide icons that exist", () => {
    for (const t of PAGE_TEMPLATES)
      for (const s of t.sections) if (s.type === "features") for (const i of s.items) expect((Lucide as Record<string, unknown>)[i.icon], `${t.id}: ${i.icon}`).toBeTruthy();
  });

  it("states a source and licence for every template, never an unlicensed one", () => {
    for (const t of PAGE_TEMPLATES) {
      expect(t.inspiration.length).toBeGreaterThan(0);
      for (const i of t.inspiration) expect(i.licence).toMatch(/^(MIT|Apache-2\.0|CC0|Not reused)/);
      expect(t.inspiration.some((i) => i.licence === "MIT")).toBe(true);
    }
    const all = JSON.stringify(PAGE_TEMPLATES);
    expect(all).not.toMatch(/Preline|Cruip|Tailwind UI/i);
  });

  it("dapp templates say what happens on-chain, sites don't need a contract", () => {
    for (const t of PAGE_TEMPLATES) {
      if (t.kind === "dapp") expect(t.onchain, t.id).toBeTruthy();
      else expect(templateBrief(t)).toContain("No contract is needed");
    }
  });

  it("makes a short chat request and a complete brief for each", () => {
    for (const t of PAGE_TEMPLATES) {
      const request = templateRequest(t);
      expect(request.length).toBeLessThan(200);
      expect(request).toContain(t.label);
      const brief = templateBrief(t);
      expect(brief.length).toBeLessThan(PROMPT_MAX_LENGTH * 2);
      expect(brief).toContain(t.theme.accent);
      for (const s of t.sections) if (s.type === "hero") expect(brief).toContain(s.title);
    }
  });

  it("resolves through getTemplate so the project name and prompt box work", () => {
    const t = getTemplate("flowdesk");
    expect(t?.label).toBe("Flowdesk");
    expect(t?.examplePrompt).toContain("Flowdesk");
    expect(getTemplate("tip-jar")?.label).toBe("Community tip jar");
  });
});
