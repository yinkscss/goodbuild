import { expect, it } from "vitest";
import { eventApi, eventFromPath, eventId, parseEvent } from "./hackathon-events";

it("reads the hackathon from a page path", () => {
  expect(eventFromPath("/hackathon")).toBe("main");
  expect(eventFromPath("/home/hackathon/vote")).toBe("main");
  expect(eventFromPath("/hackathon/futminna")).toBe("futminna");
  expect(eventFromPath("/home/hackathon/futminna/leaderboard")).toBe("futminna");
  expect(eventFromPath("/hackathon/futminnaish")).toBe("main");
  expect(eventFromPath(null)).toBe("main");
});

it("keeps the main hackathon's ids and URLs unchanged", () => {
  expect(eventId("main")).toBe("million-2027");
  expect(parseEvent("nonsense")).toBe("main");
  expect(parseEvent("futminna")).toBe("futminna");
  expect(eventApi("/api/hackathon/projects", "main")).toBe("/api/hackathon/projects");
  expect(eventApi("/api/hackathon/projects?mine=1", "futminna")).toBe("/api/hackathon/projects?mine=1&event=futminna");
});
