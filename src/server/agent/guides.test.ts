import { describe, expect, it } from "vitest";

import { GUIDES, guideCatalog, loadGuides } from "./guides";
import { BUILD_TOOLS, PLAN_TOOLS, systemPrompt } from "./prompt";
import { Workspace } from "./workspace";
import { starterFiles } from "./template";

describe("guides", () => {
  it("are listed in the system prompt for both modes", () => {
    for (const mode of ["build", "plan"] as const) {
      const p = systemPrompt(mode);
      for (const g of GUIDES) expect(p).toContain(`- ${g.name}:`);
    }
    expect(guideCatalog().split("\n")).toHaveLength(GUIDES.length);
  });

  it("load by name and report unknown names", () => {
    const r = loadGuides(["landing-page", "nope", "landing-page"]);
    expect(r.loaded).toEqual(["landing-page"]);
    expect(r.text).toContain('<guide name="landing-page">');
    expect(r.text).toMatch(/Unknown guide name\(s\): nope/);
  });

  it("come back from set_plan and read_guide, in plan mode too", () => {
    const ws = new Workspace(starterFiles());
    const plan = ws.execute("set_plan", JSON.stringify({ summary: "Add pages", steps: ["a"], guides: ["pages-and-routing"] }), "build");
    expect(plan.guides).toEqual(["pages-and-routing"]);
    expect(plan.result).toContain("HashRouter");
    const read = ws.execute("read_guide", JSON.stringify({ name: "forms-and-signup" }), "plan");
    expect(read.ok).toBe(true);
    expect(read.result).toContain("app-data guide");
    expect(PLAN_TOOLS.map((t) => t.function.name)).toContain("read_guide");
    expect(BUILD_TOOLS.map((t) => t.function.name)).toContain("read_guide");
  });

  it("only mention tokens the starter defines", () => {
    const html = starterFiles()["public/index.html"];
    const body = GUIDES.find((g) => g.name === "design-tokens")!.body;
    for (const t of ["card", "accent-foreground", "ring", "muted-foreground", "primary-foreground"]) {
      expect(body).toContain(t);
      expect(html).toContain(`--color-${t}:`);
    }
    expect(html).toContain("--font-display:");
    expect(starterFiles()["package.json"]).toContain('"react-router-dom"');
  });

  it("tells generated apps to follow the project's selected Celo chain", () => {
    const prompt = systemPrompt("build");
    const crossChain = GUIDES.find((g) => g.name === "cross-chain")!.body;
    expect(prompt).toContain("target network selected for this project");
    expect(prompt).toContain("New projects default to Celo Sepolia");
    expect(crossChain).toContain("network selected for their project");
    expect(crossChain).not.toContain("Celo Sepolia for now");
  });
});
