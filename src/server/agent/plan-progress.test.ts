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
  it("gives a headline, the builder's list of what works, and what comes later", () => {
    expect(milestoneOutcome({ id: "interface", checked: true, later: ["wallet", "payments"], works: ["Add and remove goals"] })).toEqual({
      headline: "Your app's screens are built. Try it in the preview.",
      works: ["Add and remove goals"],
      later: "Connect a wallet, payments on Celo come next. Payments are off until then.",
    });
    expect(milestoneOutcome({ id: "wallet", checked: false, later: [] })).toEqual({ headline: "Connecting a wallet works. GoodBuild will try it again in a browser on your next change.", works: [] });
    expect(milestoneOutcome({ id: "payments", checked: true, later: [] }).later).toBe("To take real payments, deploy your contract and sign from your wallet.");
  });
});

describe("the builder's list of what works (D163)", () => {
  it("strips list markers but keeps numbers that belong to the words", async () => {
    const { Workspace } = await import("./workspace");
    const out = new Workspace({}).execute("suggest_next", JSON.stringify({ suggestions: ["Next"], works: ["2. See every tip", "3D maze gameplay", "24-hour history"] }), "build");
    expect(out.works).toEqual(["See every tip", "3D maze gameplay", "24-hour history"]);
  });
});

describe("forgetting what GoodBuild remembers (D163)", () => {
  it("removes one decision and keeps the rest", () => {
    expect(withoutDecision({ summary: "s", decisions: ["Brand colour #0f766e", "Tips at least 5 G$"], upTo: 9 }, "Tips at least 5 G$")).toEqual({ summary: "s", decisions: ["Brand colour #0f766e"], upTo: 9 });
    expect(withoutDecision(null, "x")).toBeNull();
  });
});
