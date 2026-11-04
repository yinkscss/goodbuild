import { describe, expect, it } from "vitest";
import { approach, tiltFromPointer } from "./tilt";

const rect = { left: 100, top: 50, width: 200, height: 100 };

describe("tiltFromPointer", () => {
  it("is level at the centre", () => {
    expect(tiltFromPointer(200, 100, rect)).toEqual({ rx: 0, ry: 0 });
  });
  it("leans toward the cursor and reaches ±max at the edges", () => {
    expect(tiltFromPointer(300, 50, rect, 6)).toEqual({ rx: 6, ry: 6 });
    expect(tiltFromPointer(100, 150, rect, 6)).toEqual({ rx: -6, ry: -6 });
  });
  it("clamps outside the box", () => {
    expect(tiltFromPointer(9999, -9999, rect, 4)).toEqual({ rx: 4, ry: 4 });
  });
  it("returns level for an empty box", () => {
    expect(tiltFromPointer(1, 1, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ rx: 0, ry: 0 });
  });
});

describe("approach", () => {
  it("moves part of the way and snaps when close", () => {
    expect(approach(0, 10, 0.5)).toBe(5);
    expect(approach(9.995, 10)).toBe(10);
  });
});
