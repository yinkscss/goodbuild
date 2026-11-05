import { describe, expect, it } from "vitest";

import { findSymbol, manifest, readRange, searchCode, selectContext, summarizeFile, symbolsIn, terms } from "./codebase";
import { FIND_CASES, thirtyFileProject } from "./fixtures/thirty-files";
import { contextWithPicks } from "./prompt";

const files = thirtyFileProject();

describe("manifest", () => {
  it("summarises pages, routes, contracts and the theme in one line each", () => {
    expect(summarizeFile("src/App.tsx", files["src/App.tsx"])).toContain("routes / /jar /leaderboard /about /*");
    expect(summarizeFile("src/components/sections/Hero.tsx", files["src/components/sections/Hero.tsx"])).toMatch(/default Hero .*h1 "Buy the club a coffee in G\$".*sections #hero/);
    expect(summarizeFile("contracts/TipJar.sol", files["contracts/TipJar.sol"])).toBe("contract TipJar is ReentrancyGuard · fns tip() · events Tipped");
    expect(summarizeFile("public/index.html", files["public/index.html"])).toContain("color-accent #592e81");
    expect(manifest(files).split("\n")).toHaveLength(Object.keys(files).length);
  });
  it("is cached by content: a changed file gets a new summary", () => {
    const a = summarizeFile("src/pages/X.tsx", "export default function X() { return <h1>Old title</h1>; }");
    const b = summarizeFile("src/pages/X.tsx", "export default function X() { return <h1>New title</h1>; }");
    expect(a).toContain("Old title");
    expect(b).toContain("New title");
  });
});

describe("symbols and search", () => {
  it("indexes components, hooks, routes and contract members", () => {
    const names = symbolsIn("src/lib/useTipJar.ts", files["src/lib/useTipJar.ts"]).map((s) => `${s.kind}:${s.name}`);
    expect(names).toContain("hook:useTipJar");
    const sol = symbolsIn("contracts/TipJar.sol", files["contracts/TipJar.sol"]).map((s) => `${s.kind}:${s.name}`);
    expect(sol).toEqual(expect.arrayContaining(["contract:TipJar", "function:tip", "event:Tipped", "error:ZeroTip"]));
  });
  it("find_symbol returns the definition and its users", () => {
    const r = findSymbol(files, "TipForm");
    expect(r).toMatch(/^src\/components\/TipForm\.tsx:\d+ default TipForm/);
    expect(r).toContain("Used in: src/pages/Jar.tsx");
    expect(findSymbol(files, "/leaderboard")).toContain("src/App.tsx");
    expect(findSymbol(files, "Nope")).toMatch(/^No definition/);
  });
  it("search_code finds literal text and regexes with file:line", () => {
    expect(searchCode(files, { query: "Send tip" })).toMatch(/^src\/components\/TipForm\.tsx:\d+: /m);
    expect(searchCode(files, { query: "Top tip", path: "src/components/" })).toContain("src/components/sections/Stats.tsx");
    expect(searchCode(files, { query: "slice\\(0, \\d+\\)", regex: true })).toContain("src/pages/Leaderboard.tsx");
    expect(searchCode(files, { query: "(", regex: true })).toMatch(/^Error: invalid regex/);
    expect(searchCode(files, { query: "zzzz" })).toMatch(/^No matches/);
  });
  it("read_file ranges are numbered and bounded", () => {
    const r = readRange("a\nb\nc\nd", 2, 3);
    expect(r).toContain("\n2| b\n3| c");
    expect(readRange("a\nb", 5, 9)).toMatch(/^Error/);
    expect(readRange("whole")).toBe("whole");
  });
});

describe("context selection on a 30-file project (HARNESS.md eval 3, offline part)", () => {
  // Measured: this realistic 30-file project is ~28k chars, under the 40k budget, so by default
  // it is sent whole. A 12k budget stands in for a project about three times bigger.
  const SMALL = 12_000;
  it("sends a project that fits the budget whole", () => {
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(30);
    const picks = selectContext(files, "Add a Twitter link to the footer").map((p) => p.path);
    expect(picks).toEqual(expect.arrayContaining(["src/pages/About.tsx", "src/components/sections/Faq.tsx", "src/lib/useTipJar.ts", "src/components/ui/button.tsx"]));
    // Everything except the two data helpers, which the app-data guide documents.
    expect(picks).toHaveLength(Object.keys(files).filter((p) => p !== "src/lib/db.ts" && p !== "src/lib/useDb.ts").length);
  });
  it("over budget: puts the file that needs the change in context for most requests, and one search finds the rest", () => {
    let inContext = 0;
    for (const c of FIND_CASES) {
      const picks = selectContext(files, c.request, { budgetChars: SMALL }).map((p) => p.path);
      if (picks.includes(c.target)) inContext++;
      else {
        // One search_code on the most specific request word must find it.
        const found = terms(c.request).some((t) => searchCode(files, { query: t }).split("\n").some((l) => l.startsWith(`${c.target}:`)));
        expect(found, `${c.request} → ${c.target}`).toBe(true);
      }
    }
    expect(inContext).toBeGreaterThanOrEqual(8);
  });
  it("maps how users name things to file names (404 → NotFound, menu → Layout)", () => {
    expect(selectContext(files, "Make the 404 page friendlier", { budgetChars: SMALL }).map((p) => p.path)).toContain("src/pages/NotFound.tsx");
    expect(selectContext(files, "The menu should close on Escape", { budgetChars: SMALL }).map((p) => p.path)).toContain("src/components/Layout.tsx");
  });
  it("stays within budget and always sends the entry, theme and contracts", () => {
    const { picks, text } = contextWithPicks({ files, request: "Make the hero headline bigger", budgetChars: SMALL });
    const paths = picks.map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(["src/App.tsx", "public/index.html", "contracts/TipJar.sol", "src/components/sections/Hero.tsx"]));
    expect(paths).not.toContain("src/pages/About.tsx");
    expect(paths.some((p) => p.startsWith("src/contracts/"))).toBe(false);
    // Leftover budget goes to small starter pieces, after every own file that matched.
    const firstStarter = picks.findIndex((p) => p.reason === "starter helper");
    expect(firstStarter).toBeGreaterThan(paths.indexOf("src/components/sections/Hero.tsx"));
    expect(picks.reduce((n, p) => n + files[p.path].length, 0)).toBeLessThanOrEqual(SMALL);
    expect(text).toContain("others not shown: find them with find_symbol or search_code");
  });
});
