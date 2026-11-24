import { expect, it } from "vitest";
import { closeOf, eventApi, eventFromPath, eventId, parseEvent, zoneBadge } from "./hackathon-events";

it("reads the hackathon from a page path", () => {
  expect(eventFromPath("/hackathon")).toBe("main");
  expect(eventFromPath("/home/hackathon/vote")).toBe("main");
  expect(eventFromPath("/hackathon/futminna")).toBe("futminna");
  expect(eventFromPath("/home/hackathon/futminna/leaderboard")).toBe("futminna");
  expect(eventFromPath("/hackathon/futminnaish")).toBe("main");
  expect(eventFromPath(null)).toBe("main");
  expect(eventFromPath("/hackathon/kadpoly")).toBe("kadpoly");
  expect(eventFromPath("/home/hackathon/kadpoly/vote")).toBe("kadpoly");
  expect(eventFromPath("/hackathon/kadpolyish")).toBe("main");
});

it("keeps the main hackathon's ids and URLs unchanged", () => {
  expect(eventId("main")).toBe("million-2027");
  expect(parseEvent("nonsense")).toBe("main");
  expect(parseEvent("futminna")).toBe("futminna");
  expect(parseEvent("kadpoly")).toBe("kadpoly");
  expect(eventApi("/api/hackathon/projects", "main")).toBe("/api/hackathon/projects");
  expect(eventApi("/api/hackathon/projects?mine=1", "futminna")).toBe("/api/hackathon/projects?mine=1&event=futminna");
});

it("marks Kadpoly's top 3 as winners and 4 and 5 as the waitlist; FUTMinna's top 5 as the shortlist (D167)", () => {
  expect([1, 3, 4, 5, 6].map((r) => zoneBadge("kadpoly", r))).toEqual(["Top 3", "Top 3", "Waitlist", "Waitlist", null]);
  expect([1, 5, 6].map((r) => zoneBadge("futminna", r))).toEqual(["Shortlist", "Shortlist", null]);
  expect(zoneBadge("main", 1)).toBeNull();
  expect(closeOf("kadpoly").toISOString()).toBe("2026-12-31T23:00:00.000Z");
  expect(closeOf("futminna")).toEqual(closeOf("main"));
});
