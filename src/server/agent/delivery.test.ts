// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MILESTONE_FACTS, deliveryFor, deliveryContext, extendDelivery, milestoneAllows, requestedMilestones, scopeRefusal } from "./delivery";

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

describe("extending a delivery plan after the first message (D153)", () => {
  it("adds the on-chain milestone a portfolio site never asked for, and picks it", () => {
    const plan = { ...deliveryFor("Make me a portfolio site"), completed: 1 };
    expect(plan.milestones.map((m) => m.id)).toEqual(["interface"]);
    const { plan: next, picked, added } = extendDelivery(plan, "Make the tip box take real G$ with a tip jar contract");
    expect(added).toBe(true);
    expect(next.milestones.map((m) => m.id)).toEqual(["interface", "payments"]);
    expect(picked).toBe(1);
    expect(milestoneAllows(next, picked, "create_file", { path: "contracts/TipJar.sol" })).toBe(true);
  });

  it("picks a saved but undelivered milestone the request names, without adding a duplicate", () => {
    const plan = { ...deliveryFor("A staking game where people connect their wallet and stake G$"), completed: 1 };
    const { plan: next, picked, added } = extendDelivery(plan, "Add staking with G$");
    expect(added).toBe(false);
    expect(next.milestones[picked].id).toBe("payments");
  });

  it("leaves an ordinary edit alone", () => {
    const plan = { ...deliveryFor("Make me a portfolio site"), completed: 1 };
    expect(extendDelivery(plan, "Make the heading bigger")).toEqual({ plan, picked: -1, added: false });
  });

  it("keeps contract scope once the on-chain milestone has been delivered", () => {
    const plan = { goal: "x", completed: 2, milestones: [...deliveryFor("tip jar").milestones, ...requestedMilestones("connect wallet")] };
    expect(plan.milestones.map((m) => m.id)).toEqual(["interface", "payments", "wallet"]);
    expect(milestoneAllows(plan, 2, "edit_file", { path: "contracts/TipJar.sol" })).toBe(true);
  });

  it("refuses with how to proceed, and the facts deny any milestone setting", () => {
    const refusal = scopeRefusal(deliveryFor("portfolio"), 0);
    expect(refusal).toContain("Working first interface");
    expect(refusal).toContain("names the on-chain feature");
    expect(MILESTONE_FACTS).toMatch(/no project setting/);
  });
});
