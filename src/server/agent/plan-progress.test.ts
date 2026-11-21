import { describe, expect, it } from "vitest";

import { withoutDecision } from "./memory";
import { milestoneOutcome, planStepFor } from "./runner";

describe("where the build is on its plan (D163)", () => {
  const spec = ["SavingsGoals: holds each saver's G$", "Home: shows every goal", "/goals/new: add a goal"];
  it("matches a file to the plan step its name belongs to", () => {
    expect(planStepFor(spec, "contracts/SavingsGoals.sol")).toBe(0);
    expect(planStepFor(spec, "src/pages/HomePage.tsx")).toBe(1);
    expect(planStepFor(spec, "src/components/GoalForm.tsx")).toBe(2);
    expect(planStepFor(["Lay out the savings goals screen", "Add, edit and remove goals"], "src/GoalCard.tsx")).toBe(0);
  });

  it("leaves the step alone when nothing matches", () => {
    expect(planStepFor(spec, "src/index.css")).toBeUndefined();
    expect(planStepFor(spec, "src/App.tsx")).toBeUndefined();
    expect(planStepFor([], "src/GoalCard.tsx")).toBeUndefined();
  });
});

describe("a milestone's end in plain words (D163)", () => {
  it("says what works, what doesn't yet, and the next step", () => {
    expect(milestoneOutcome({ id: "interface", checked: true, later: ["wallet", "payments"] })).toEqual({
      works: "Your app's screens are built.",
      notYet: "Still to come: connect a wallet, payments on Celo. Payments stay switched off until then.",
      next: "Connect a wallet",
    });
    expect(milestoneOutcome({ id: "wallet", checked: false, later: [] }).works).toBe("Connecting a wallet works, and GoodBuild will try it again in a browser on your next change.");
    expect(milestoneOutcome({ id: "payments", checked: true, later: [] })).toEqual({ works: "Payments on Celo are built.", notYet: "To take real payments, deploy your contract and sign from your wallet.", next: "Deploy your contract" });
  });
});

describe("forgetting what GoodBuild remembers (D163)", () => {
  it("removes one decision and keeps the rest", () => {
    expect(withoutDecision({ summary: "s", decisions: ["Brand colour #0f766e", "Tips at least 5 G$"], upTo: 9 }, "Tips at least 5 G$")).toEqual({ summary: "s", decisions: ["Brand colour #0f766e"], upTo: 9 });
    expect(withoutDecision(null, "x")).toBeNull();
  });
});
