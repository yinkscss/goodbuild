import { describe, expect, it } from "vitest";
import { smoothPath } from "./metric-card";

describe("smoothPath", () => {
  it("starts at x=0 and ends at the full width", () => {
    const d = smoothPath([1, 2, 3, 4], 300, 180);
    expect(d.startsWith("M0.0 ")).toBe(true);
    expect(d.trim().split(" ").slice(-2)[0]).toBe("300.0");
  });
  it("puts the max at the top padding and the min at the bottom band", () => {
    const d = smoothPath([0, 10], 300, 180, 20);
    expect(d).toMatch(/^M0\.0 150\.0/); // min → 180 - 30
    expect(d).toMatch(/300\.0 20\.0$/); // max → padTop
  });
  it("returns an empty path for fewer than two points", () => {
    expect(smoothPath([5], 300, 180)).toBe("");
  });
});
