import { describe, expect, it } from "vitest";

import { creditState, formatGd, greetingFor, projectStatusMeta, relativeTime } from "./home";

const at = (h: number) => new Date(2026, 10, 4, h, 0, 0);

describe("greetingFor", () => {
  it("follows the local clock", () => {
    expect(greetingFor(at(3))).toBe("Up late");
    expect(greetingFor(at(8))).toBe("Good morning");
    expect(greetingFor(at(13))).toBe("Good afternoon");
    expect(greetingFor(at(19))).toBe("Good evening");
  });
});

describe("relativeTime", () => {
  const now = new Date(2026, 10, 4, 15, 0, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it("covers minutes, hours, days and weeks", () => {
    expect(relativeTime(ago(10_000), now)).toBe("Just now");
    expect(relativeTime(ago(12 * 60_000), now)).toBe("12 min ago");
    expect(relativeTime(ago(2 * 3_600_000), now)).toBe("2h ago");
    expect(relativeTime(new Date(2026, 10, 3, 9, 0), now)).toBe("Yesterday");
    expect(relativeTime(new Date(2026, 10, 1, 9, 0), now)).toBe("3 days ago");
    expect(relativeTime(new Date(2026, 9, 26, 9, 0), now)).toBe("Last week");
    expect(relativeTime(new Date(2026, 9, 1, 9, 0), now)).toBe("1 Oct");
  });
  it("never goes negative for clock skew", () => {
    expect(relativeTime(new Date(now.getTime() + 60_000), now)).toBe("Just now");
  });
});

describe("projectStatusMeta", () => {
  it("maps statuses to labels and design-system tones", () => {
    expect(projectStatusMeta("deployed", 11142220)).toEqual({ label: "Deployed · Celo Sepolia", tone: "success" });
    expect(projectStatusMeta("needs_fix", 11142220).tone).toBe("warning");
    expect(projectStatusMeta("draft", 11142220)).toEqual({ label: "Draft", tone: "pink" });
    expect(projectStatusMeta("unknown", 42220).label).toBe("Draft");
  });
});

describe("creditState", () => {
  it("preview until the ledger is live, then ok / low (≤10) / empty (0)", () => {
    expect(creditState(null)).toBe("preview");
    expect(creditState(120)).toBe("ok");
    expect(creditState(10)).toBe("low");
    expect(creditState(0.5)).toBe("low");
    expect(creditState(0)).toBe("empty");
    expect(creditState(-1)).toBe("empty");
  });
});

describe("formatting", () => {
  it("formats G$ and USD amounts", () => {
    expect(formatGd(120)).toBe("120 G$");
    expect(formatGd(12_500)).toBe("12.5K G$");
    expect(formatGd(2_480_000)).toBe("2.48M G$");
  });
});
