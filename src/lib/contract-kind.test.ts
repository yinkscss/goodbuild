import { describe, expect, it } from "vitest";
import { inferKind } from "./contract-kind";

describe("inferKind", () => {
  it("prefers the template", () => {
    expect(inferKind({ templateId: "tip-jar", text: "a poll" })).toBe("tips");
  });
  it("infers from text", () => {
    expect(inferKind({ text: "Weekly ajo for 12 friends" })).toBe("savings");
    expect(inferKind({ text: "Ikeja FC tip jar" })).toBe("tips");
    expect(inferKind({ text: "Afrobeats Night Tickets" })).toBe("tickets");
    expect(inferKind({ text: "Library chairs fundraiser with refund" })).toBe("crowdfund");
    expect(inferKind({ text: "Class poll" })).toBe("vote");
    expect(inferKind({ text: "Meetup attendance badges" })).toBe("badges");
    expect(inferKind({ text: "Co-op grain fund" })).toBe("custom");
  });
});
