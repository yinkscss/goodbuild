import { describe, expect, it } from "vitest";
import { PROMPT_MAX_LENGTH, canSubmitPrompt, isSubmitShortcut, normalisePrompt, rowsForContent } from "./prompt";

describe("rowsForContent", () => {
  it("never goes below 2 rows", () => {
    expect(rowsForContent(0, 28)).toBe(2);
    expect(rowsForContent(28, 28)).toBe(2);
  });
  it("grows with content", () => {
    expect(rowsForContent(84, 28)).toBe(3);
    expect(rowsForContent(85, 28)).toBe(4);
  });
  it("caps at 8 rows", () => {
    expect(rowsForContent(28 * 20, 28)).toBe(8);
  });
  it("falls back to the minimum on bad input", () => {
    expect(rowsForContent(NaN, 28)).toBe(2);
    expect(rowsForContent(100, 0)).toBe(2);
  });
});

describe("isSubmitShortcut", () => {
  const base = { key: "Enter", metaKey: false, ctrlKey: false };
  it("submits on Cmd+Enter and Ctrl+Enter", () => {
    expect(isSubmitShortcut({ ...base, metaKey: true })).toBe(true);
    expect(isSubmitShortcut({ ...base, ctrlKey: true })).toBe(true);
  });
  it("submits on plain Enter but not Shift+Enter", () => {
    expect(isSubmitShortcut(base)).toBe(true);
    expect(isSubmitShortcut({ ...base, shiftKey: true })).toBe(false);
  });
  it("ignores other keys", () => {
    expect(isSubmitShortcut({ ...base, key: "a", metaKey: true })).toBe(false);
  });
  it("ignores IME composition", () => {
    expect(isSubmitShortcut({ ...base, metaKey: true, isComposing: true })).toBe(false);
  });
});

describe("canSubmitPrompt", () => {
  it("requires non-whitespace text", () => {
    expect(canSubmitPrompt("")).toBe(false);
    expect(canSubmitPrompt("   \n ")).toBe(false);
    expect(canSubmitPrompt("tip jar")).toBe(true);
  });
  it("respects disabled and the length cap", () => {
    expect(canSubmitPrompt("tip jar", true)).toBe(false);
    expect(canSubmitPrompt("x".repeat(PROMPT_MAX_LENGTH + 1))).toBe(false);
  });
});

describe("normalisePrompt", () => {
  it("trims and collapses runs of blank lines", () => {
    expect(normalisePrompt("  a\n\n\n\nb  ")).toBe("a\n\nb");
  });
});
