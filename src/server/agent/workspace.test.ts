import { describe, expect, it } from "vitest";

import { thirtyFileProject } from "./fixtures/thirty-files";
import { Workspace } from "./workspace";

const call = (ws: Workspace, name: string, args: unknown, mode: "build" | "plan" = "build") => ws.execute(name, JSON.stringify(args), mode);

describe("Workspace search tools", () => {
  const ws = new Workspace(thirtyFileProject());
  it("search_code, find_symbol and ranged read_file work and report access for the log", () => {
    const s = call(ws, "search_code", { query: "Top tip" });
    expect(s.result).toContain("src/components/sections/Stats.tsx:");
    expect(s.access).toBe('search_code "Top tip"');
    const f = call(ws, "find_symbol", { name: "useTipJar" }, "plan");
    expect(f.ok).toBe(true);
    expect(f.result).toContain("src/lib/useTipJar.ts");
    const r = call(ws, "read_file", { path: "src/App.tsx", start_line: 1, end_line: 3 });
    expect(r.result).toMatch(/^Lines 1-3 of \d+/);
    expect(r.access).toBe("read_file src/App.tsx:1-3");
    expect(call(ws, "list_files", {}).result).toContain("src/components/sections/Hero.tsx");
  });
});

describe("Workspace naming", () => {
  it("refuses badly named new files but still edits existing ones", () => {
    const ws = new Workspace({ "src/App.tsx": "x", "src/pages/home.tsx": "export default function Home() { return null; }" });
    expect(call(ws, "create_file", { path: "src/pages/about.tsx", content: "x" }).result).toContain("src/pages/About.tsx");
    expect(call(ws, "create_file", { path: "src/pages/home.tsx", content: "y" }).ok).toBe(true);
    expect(call(ws, "rename_file", { from: "src/pages/home.tsx", to: "src/pages/start.tsx" }).result).toContain("PascalCase");
    expect(call(ws, "rename_file", { from: "src/pages/home.tsx", to: "src/pages/Home.tsx" }).ok).toBe(true);
    expect(call(ws, "create_file", { path: "src/assets/index.ts", content: "x" }).result).toMatch(/uploads/);
  });
});
