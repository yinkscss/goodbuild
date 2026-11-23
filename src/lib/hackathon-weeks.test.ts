import { expect, it } from "vitest";
import { risingStars, weeksUntil, type Snapshot } from "./hackathon-weeks";

const snap = (day: string, entryId: string, approvals: number): Snapshot => ({ day, entryId, approvals });
const order = ["a", "b", "c"];

it("has no winners before any week has finished", () => {
  expect(risingStars([snap("2026-11-20", "a", 4)], order)).toEqual([]);
});

it("picks the project with the most new approvals in week 1, counting from zero", () => {
  const rows = [snap("2026-11-26", "a", 5), snap("2026-11-26", "b", 9), snap("2026-11-26", "c", 2)];
  expect(risingStars(rows, order)).toEqual([{ week: 1, entryId: "b", gained: 9 }]);
});

it("measures later weeks against the previous boundary, so a quiet leader can lose", () => {
  const rows = [
    snap("2026-11-26", "a", 20), snap("2026-11-26", "b", 2),
    snap("2026-12-03", "a", 21), snap("2026-12-03", "b", 9), // b gained 7, a gained 1
  ];
  expect(risingStars(rows, order)).toEqual([
    { week: 1, entryId: "a", gained: 20 },
    { week: 2, entryId: "b", gained: 7 },
  ]);
});

it("breaks ties by earlier submission and gives no star for a week with no new approvals", () => {
  const tied = [snap("2026-11-26", "b", 3), snap("2026-11-26", "a", 3)];
  expect(risingStars(tied, order)[0].entryId).toBe("a");
  const flat = [snap("2026-11-26", "a", 3), snap("2026-12-03", "a", 3)];
  expect(risingStars(flat, order).map((r) => r.week)).toEqual([1]);
});

it("uses the next snapshot if the worker missed the boundary day, and skips weeks it can't measure", () => {
  const late = [snap("2026-11-27", "a", 4)];
  expect(risingStars(late, order)).toEqual([{ week: 1, entryId: "a", gained: 4 }]);
  const gap = [snap("2026-12-03", "a", 6)]; // no week 1 snapshot, so week 2 has no baseline
  expect(risingStars(gap, order)).toEqual([{ week: 1, entryId: "a", gained: 6 }]);
});

it("gives Kadpoly six Rising Star weeks to 31 Dec, and the 10 Dec hackathons three (D166)", () => {
  const kadpolyWeeks = weeksUntil(new Date("2026-12-31T23:00:00Z"));
  expect(weeksUntil(new Date("2026-12-10T23:00:00Z")).map((w) => w.n)).toEqual([1, 2, 3]);
  expect(kadpolyWeeks.map((w) => w.n)).toEqual([1, 2, 3, 4, 5, 6]);
  const order = ["a", "b"];
  // a gains 1 a week; b sits still until the last week, then gains 9.
  const days = ["2026-11-26", "2026-12-03", "2026-12-11", "2026-12-18", "2026-12-25", "2027-01-01"];
  const rows: Snapshot[] = days.flatMap((day, i) => [
    { day, entryId: "a", approvals: i + 1 },
    { day, entryId: "b", approvals: i === 5 ? 9 : 0 },
  ]);
  const stars = risingStars(rows, order, kadpolyWeeks);
  expect(stars.map((s) => [s.week, s.entryId])).toEqual([[1, "a"], [2, "a"], [3, "a"], [4, "a"], [5, "a"], [6, "b"]]);
  expect(risingStars(rows, order).map((s) => s.week)).toEqual([1, 2, 3]);
});
