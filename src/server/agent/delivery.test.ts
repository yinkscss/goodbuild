// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deliveryFor, deliveryContext, milestoneAllows } from "./delivery";

describe("progressive first delivery", () => {
  it("keeps the complete staking game request while bounding the first milestone", () => {
    const goal = "Make a Tic-tac-toe game that people connect their wallet, stake G$ and play amongst themselves";
    const delivery = deliveryFor(goal);
    expect(delivery.goal).toBe(goal);
    expect(delivery.milestones.map((m) => m.id)).toEqual(["interface", "wallet", "multiplayer", "payments"]);
    expect(deliveryContext(delivery, 0)).toContain("local/demo");
    expect(milestoneAllows(delivery, 0, "create_file", { path: "contracts/Xoxo.sol" })).toBe(false);
    expect(milestoneAllows(delivery, 3, "create_file", { path: "contracts/Xoxo.sol" })).toBe(true);
  });
});
