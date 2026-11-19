/**
 * Hackathon rewards (D130): one fixed pool of 1,000,000 G$, never exceeded.
 * - 700,000 G$ goes to the top 20 published projects by approvals, on a fixed rank table.
 * - 300,000 G$ is shared by approvals: each pays up to 5,000 G$, less when total approvals are
 *   too many for the pool, so the pool can't run out. Rounded down per approval.
 * Everything here is an estimate until the close, when the final rate is known.
 */
export const RESERVE_POOL_GD = 1_000_000;
export const RANK_POOL_GD = 700_000;
export const APPROVAL_POOL_GD = RESERVE_POOL_GD - RANK_POOL_GD;
export const APPROVAL_TOPUP_MAX_GD = 5_000;

/** Prize for rank 1 to 20. Sums to RANK_POOL_GD. */
export const RANK_REWARDS_GD: readonly number[] = [
  175_000, 105_000, 70_000, 42_000, 42_000,
  21_000, 21_000, 21_000, 21_000, 21_000,
  16_100, 16_100, 16_100, 16_100, 16_100, 16_100, 16_100, 16_100, 16_100, 16_100,
];
export const REWARD_SLOTS = RANK_REWARDS_GD.length;

/** G$ paid per approval given the total approvals on published projects. */
export function approvalRateGd(totalApprovals: number): number {
  if (totalApprovals <= 0) return APPROVAL_TOPUP_MAX_GD;
  return Math.floor(Math.min(APPROVAL_TOPUP_MAX_GD, APPROVAL_POOL_GD / totalApprovals));
}

/** Input ties keep the server's submission-time/id order. Ideas never occupy reward slots. */
export function allocateHackathonRewards<
  T extends { liveUrl: string; approvals: number },
>(entries: T[]) {
  const ranked = [...entries].sort(
    (a, b) =>
      Number(Boolean(b.liveUrl)) - Number(Boolean(a.liveUrl)) ||
      b.approvals - a.approvals,
  );
  const rate = approvalRateGd(
    ranked.reduce((sum, e) => sum + (e.liveUrl ? e.approvals : 0), 0),
  );
  let rank = 0;
  return ranked.map((entry) => {
    const position = entry.liveUrl ? ++rank : null;
    const baseGd =
      position !== null && position <= REWARD_SLOTS
        ? RANK_REWARDS_GD[position - 1]
        : 0;
    const topupGd = entry.liveUrl ? entry.approvals * rate : 0;
    return {
      ...entry,
      rank: position,
      baseGd,
      topupGd,
      totalGd: baseGd + topupGd,
    };
  });
}
