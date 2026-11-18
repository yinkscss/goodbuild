import { expect, it } from "vitest";
import { buildLadder, leagueFor } from "./hackathon-ladder";

const live = (id: string, approvals: number) => ({ id, liveUrl: "https://example.com", approvals });
const many = (n: number) => Array.from({ length: n }, (_, i) => live(`p${i}`, 100 - i));

it("assigns leagues by approvals", () => {
  expect([4, 5, 14, 15, 29, 30].map(leagueFor)).toEqual([null, "Bronze", "Bronze", "Silver", "Silver", "Gold"]);
});

it("ranks only published projects and marks the top 20 as the prize zone", () => {
  const { rows } = buildLadder([...many(22), { id: "idea", liveUrl: "", approvals: 500 }]);
  expect(rows).toHaveLength(22);
  expect(rows.some((r) => r.entry.id === "idea")).toBe(false);
  expect(rows[19].inPrizeZone).toBe(true);
  expect(rows[20].inPrizeZone).toBe(false);
});

it("counts how many approvals a project outside the zone needs, counting ties", () => {
  const entries = many(21); // p20 has 80 approvals; p19 holds rank 20 with 81 and was submitted earlier
  const { mine, gapToPrizeZone } = buildLadder(entries, "p20");
  expect(mine?.entry.rank).toBe(21);
  expect(gapToPrizeZone).toBe(2); // 81 only ties p19, who wins ties by submitting earlier, so 82 is needed
});

it("reports 0 when already in the zone and null without a project", () => {
  expect(buildLadder(many(5), "p1").gapToPrizeZone).toBe(0);
  expect(buildLadder(many(5)).gapToPrizeZone).toBeNull();
  expect(buildLadder(many(5), "nobody").mine).toBeNull();
});

it("works out places moved from the previous snapshot, and treats a missing one as no move", () => {
  const entries = [
    { ...live("climber", 50), prevRank: 3 },
    { ...live("slider", 40), prevRank: 1 },
    { ...live("steady", 30), prevRank: 3 },
    live("fresh", 10),
  ];
  const { rows } = buildLadder(entries);
  const moved = Object.fromEntries(rows.map((r) => [r.entry.id, r.moved]));
  expect(moved).toEqual({ climber: 2, slider: -1, steady: 0, fresh: 0 });
  expect(buildLadder([{ ...live("x", 3), stars: [1, 3] }]).rows[0].stars).toEqual([1, 3]);
});
