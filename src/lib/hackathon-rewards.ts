/** Confirmed by the owner: top-ups are funded separately from the shared reserve. */
export const RESERVE_POOL_GD = 1_000_000;
export const REWARD_SLOTS = 10;
export const BASE_REWARD_GD = RESERVE_POOL_GD / REWARD_SLOTS;
export const APPROVAL_TOPUP_GD = 50_000;

/** Input ties keep the server's submission-time/id order. Ideas never occupy reward slots. */
export function allocateHackathonRewards<
  T extends { liveUrl: string; approvals: number },
>(entries: T[]) {
  let rank = 0;
  return [...entries]
    .sort(
      (a, b) =>
        Number(Boolean(b.liveUrl)) - Number(Boolean(a.liveUrl)) ||
        b.approvals - a.approvals,
    )
    .map((entry) => {
      const position = entry.liveUrl ? ++rank : null;
      const baseGd =
        position !== null && position <= REWARD_SLOTS ? BASE_REWARD_GD : 0;
      const topupGd = entry.liveUrl ? entry.approvals * APPROVAL_TOPUP_GD : 0;
      return {
        ...entry,
        rank: position,
        baseGd,
        topupGd,
        totalGd: baseGd + topupGd,
      };
    });
}
