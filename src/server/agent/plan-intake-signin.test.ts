// @vitest-environment node
import { describe, expect, it } from "vitest";
import { INTAKE_PROMPT, buildableSignIn, parseIntake } from "./plan-intake";

describe("the planner only offers sign-in GoodBuild can build (D162)", () => {
  it("turns a username and password option into an email code", () => {
    expect(buildableSignIn("Yes, with a username and password")).toBe("Yes, with an email code");
    expect(buildableSignIn("Log in with Google")).toBe("Yes, with an email code");
    expect(buildableSignIn("With their wallet")).toBe("With their wallet");
    expect(buildableSignIn("No sign-in")).toBe("No sign-in");
  });

  it("applies to the questions the planner sends", () => {
    const intake = parseIntake(
      JSON.stringify({
        summary: "A savings goals app.",
        questions: [
          { question: "Should people sign in?", options: [{ label: "Yes, with a username and password", recommended: true }, { label: "No sign-in" }] },
          { question: "How big are goals?", options: [{ label: "Up to 1,000 G$" }, { label: "Any size" }] },
        ],
        recommended_palette: "forest",
      }),
      "a G$ savings goals app for students",
    );
    const signIn = intake?.questions.find((q) => q.question === "Should people sign in?");
    expect(signIn?.options.map((o) => o.label)).toEqual(["Yes, with an email code", "No sign-in"]);
  });

  it("tells the planner so", () => {
    expect(INTAKE_PROMPT).toMatch(/Never offer a username and password/);
  });
});
