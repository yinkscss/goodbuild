import { expect, it } from "vitest";
import { HACKATHON, HACKATHON_CLOSE } from "./hackathon-events";
import { weeksUntil } from "./hackathon-weeks";

it("runs one hackathon under the main id, closing at the end of 31 Dec WAT (D170)", () => {
  expect(HACKATHON.id).toBe("million-2027");
  expect(HACKATHON.zone).toBe(20);
  expect(HACKATHON_CLOSE.toISOString()).toBe("2026-12-31T23:00:00.000Z");
});

it("has six Rising Star weeks to the close", () => {
  expect(weeksUntil(HACKATHON_CLOSE).map((w) => w.n)).toEqual([1, 2, 3, 4, 5, 6]);
});
