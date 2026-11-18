import { expect, it } from "vitest";
import {
  allocateHackathonRewards,
  APPROVAL_TOPUP_GD,
  BASE_REWARD_GD,
  RESERVE_POOL_GD,
} from "./hackathon-rewards";
it("shares the reserve across ten published slots and adds uncapped approval top-ups outside it", () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    liveUrl: "https://example.com",
    approvals: 30 - i,
  }));
  const rewards = allocateHackathonRewards(entries);
  expect(rewards.reduce((s, e) => s + e.baseGd, 0)).toBe(RESERVE_POOL_GD);
  expect(rewards[0]).toMatchObject({
    rank: 1,
    baseGd: 100_000,
    topupGd: 1_500_000,
    totalGd: 1_600_000,
  });
  expect(rewards[10]).toMatchObject({
    rank: 11,
    baseGd: 0,
    topupGd: 1_000_000,
  });
  expect(BASE_REWARD_GD).toBe(100_000);
  expect(APPROVAL_TOPUP_GD).toBe(50_000);
});
it("does not give reserve slots to unpublished ideas, and preserves unallocated slots", () => {
  const rewards = allocateHackathonRewards([
    { id: "idea", liveUrl: "", approvals: 0 },
    { id: "live", liveUrl: "https://example.com", approvals: 1 },
  ]);
  expect(rewards.find((e) => e.id === "idea")).toMatchObject({
    rank: null,
    baseGd: 0,
    topupGd: 0,
    totalGd: 0,
  });
  expect(rewards.find((e) => e.id === "live")).toMatchObject({
    rank: 1,
    baseGd: 100_000,
    topupGd: 50_000,
    totalGd: 150_000,
  });
});
it("ranks published apps by approvals and preserves submission order on ties", () => {
  const rewards = allocateHackathonRewards([
    { id: "earlier", liveUrl: "https://a.example", approvals: 2 },
    { id: "leader", liveUrl: "https://b.example", approvals: 3 },
    { id: "later", liveUrl: "https://c.example", approvals: 2 },
  ]);
  expect(rewards.map((e) => [e.id, e.rank])).toEqual([
    ["leader", 1],
    ["earlier", 2],
    ["later", 3],
  ]);
});
