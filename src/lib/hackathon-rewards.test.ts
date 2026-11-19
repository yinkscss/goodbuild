import { expect, it } from "vitest";
import {
  allocateHackathonRewards,
  approvalRateGd,
  APPROVAL_POOL_GD,
  APPROVAL_TOPUP_MAX_GD,
  RANK_POOL_GD,
  RANK_REWARDS_GD,
  RESERVE_POOL_GD,
} from "./hackathon-rewards";

const live = (id: string, approvals: number) => ({ id, liveUrl: "https://example.com", approvals });

it("rank prizes sum to the rank pool and the pools sum to 1,000,000 G$", () => {
  expect(RANK_REWARDS_GD).toHaveLength(20);
  expect(RANK_REWARDS_GD.reduce((a, b) => a + b, 0)).toBe(RANK_POOL_GD);
  expect(RANK_POOL_GD + APPROVAL_POOL_GD).toBe(RESERVE_POOL_GD);
});

it("pays the full 5,000 G$ per approval while the pool covers it", () => {
  expect(approvalRateGd(0)).toBe(APPROVAL_TOPUP_MAX_GD);
  expect(approvalRateGd(60)).toBe(5_000);
  expect(approvalRateGd(120)).toBe(2_500);
});

it("never pays more than 1,000,000 G$ in total, however many approvals there are", () => {
  for (const approvalsEach of [0, 1, 3, 50, 400]) {
    const entries = Array.from({ length: 30 }, (_, i) => live(String(i), approvalsEach + (i % 3)));
    const total = allocateHackathonRewards(entries).reduce((s, e) => s + e.totalGd, 0);
    expect(total).toBeLessThanOrEqual(RESERVE_POOL_GD);
  }
});

it("gives rank prizes to the top 20 only and approval money to every published project", () => {
  const rewards = allocateHackathonRewards(Array.from({ length: 22 }, (_, i) => live(String(i), 22 - i)));
  expect(rewards[0]).toMatchObject({ rank: 1, baseGd: 175_000 });
  expect(rewards[19]).toMatchObject({ rank: 20, baseGd: 16_100 });
  expect(rewards[20]).toMatchObject({ rank: 21, baseGd: 0 });
  expect(rewards[21].topupGd).toBeGreaterThan(0);
});

it("does not give rank prizes or approval money to unpublished ideas, and leaves unused slots unpaid", () => {
  const rewards = allocateHackathonRewards([
    { id: "idea", liveUrl: "", approvals: 5 },
    live("live", 1),
  ]);
  expect(rewards.find((e) => e.id === "idea")).toMatchObject({ rank: null, baseGd: 0, topupGd: 0, totalGd: 0 });
  expect(rewards.find((e) => e.id === "live")).toMatchObject({ rank: 1, baseGd: 175_000, topupGd: 5_000, totalGd: 180_000 });
});

it("ranks published apps by approvals and preserves submission order on ties", () => {
  const rewards = allocateHackathonRewards([live("earlier", 2), live("leader", 3), live("later", 2)]);
  expect(rewards.map((e) => [e.id, e.rank])).toEqual([
    ["leader", 1],
    ["earlier", 2],
    ["later", 3],
  ]);
});
