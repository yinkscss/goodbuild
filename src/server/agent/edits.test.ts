import { describe, expect, it } from "vitest";

import { applyEdits, diffStat, unifiedDiff } from "./edits";

const file = `export function App() {
  return (
    <main>
      <h1>Tip jar</h1>
      <Button>Send tip</Button>
    </main>
  );
}
`;

describe("applyEdits", () => {
  it("applies an exact, unique edit", () => {
    const r = applyEdits(file, [{ search: "<h1>Tip jar</h1>", replace: "<h1>Ikeja FC tip jar</h1>" }]);
    expect(r).toMatchObject({ ok: true, fuzzy: false });
    expect(r.ok && r.content).toContain("Ikeja FC tip jar");
  });

  it("applies several edits in order", () => {
    const r = applyEdits(file, [
      { search: "Tip jar", replace: "Kit fund" },
      { search: "Send tip", replace: "Chip in" },
    ]);
    expect(r.ok && r.content).toContain("Kit fund");
    expect(r.ok && r.content).toContain("Chip in");
  });

  it("refuses ambiguous matches", () => {
    const r = applyEdits("a\nx\na\n", [{ search: "a", replace: "b" }]);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/matches 2 places/);
  });

  it("falls back to whitespace-tolerant matching and keeps indentation", () => {
    const r = applyEdits(file, [
      { search: "<h1>Tip jar</h1>\n<Button>Send tip</Button>", replace: "<h1>Tips</h1>\n<Button>Tip</Button>" },
    ]);
    expect(r).toMatchObject({ ok: true, fuzzy: true });
    expect(r.ok && r.content).toContain("      <h1>Tips</h1>\n      <Button>Tip</Button>");
  });

  it("reports missing text so the model can re-read the file", () => {
    const r = applyEdits(file, [{ search: "<footer>", replace: "" }]);
    expect(!r.ok && r.error).toMatch(/not found/);
  });

  it("rejects empty search", () => {
    expect(applyEdits(file, [{ search: "", replace: "x" }]).ok).toBe(false);
  });

  it("treats $ in replacements literally", () => {
    const r = applyEdits("price", [{ search: "price", replace: "50 G$ and $& $1" }]);
    expect(r.ok && r.content).toBe("50 G$ and $& $1");
  });
});

describe("diffs", () => {
  it("counts added and removed lines", () => {
    expect(diffStat("a\nb\n", "a\nc\nd\n")).toEqual({ added: 2, removed: 1 });
    expect(diffStat("", "x\ny\n")).toEqual({ added: 2, removed: 0 });
  });
  it("produces a unified diff body", () => {
    const d = unifiedDiff("src/App.tsx", "a\nb\n", "a\nc\n");
    expect(d).toContain("-b");
    expect(d).toContain("+c");
  });
});

describe("applyEdits not-found hint", () => {
  it("shows the real nearby lines so the model can retry in one step", () => {
    const file = "import a from 'a';\nexport function useCircle() {\n  const x = 1;\n  return x;\n}\n";
    const r = applyEdits(file, [{ search: "export function useCircle() {\n  const y = 2;", replace: "x" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("not found");
      expect(r.error).toContain("const x = 1;");
    }
  });
});
