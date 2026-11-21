import { describe, expect, it } from "vitest";

import { requestedMilestones } from "@/server/agent/delivery";
import { CHECKING_STEP, plainStep, planStepText } from "./plain-steps";
import { milestoneName, plainError, plainMilestoneTitle } from "./plain-words";

const step = (label: string, detail?: string) => plainStep({ id: "x", label, detail });

describe("plain step words (D164)", () => {
  it("says what is being made, and keeps the file apart", () => {
    expect(step("Writing GoalCard.tsx")).toEqual({ text: "Building the goal card", file: "GoalCard.tsx" });
    expect(step("Writing App.tsx")?.text).toBe("Building the main screen");
    expect(step("Writing index.css")?.text).toBe("Choosing colours and layout");
    expect(step("Writing useGoals.ts")?.text).toBe("Making goals work");
    expect(step("Writing useWallet.ts")?.text).toBe("Connecting the wallet");
    expect(step("Writing SettingsPage.tsx")?.text).toBe("Building the settings screen");
    expect(step("Writing SavingsGoals.sol")?.text).toBe("Writing your contract");
    expect(step("Writing SavingsGoals.t.sol")?.text).toBe("Writing checks for your app");
    expect(step("Deleting Hero.tsx")?.text).toBe("Tidying up");
    expect(step("Adding wagmi")?.text).toBe("Adding a building block");
    expect(step("Adding the minipay kit")?.text).toBe("Adding minipay support");
  });

  it("never shows a file extension in the words, for any label the builder makes", () => {
    const labels = [
      "Writing App.tsx", "Writing main.tsx", "Writing GoalList.tsx", "Writing useGoals.ts", "Writing chain.ts", "Writing theme.ts",
      "Writing index.css", "Writing package.json", "Writing spec.md", "Writing logo.svg", "Writing format.ts", "Writing Tip.sol",
      "Deleting Hero.tsx", "Renaming utils.ts", "Adding framer-motion", "Compiling with solc 0.8.28", "Compiling contracts",
      "Testing contracts", "Checking types", "Checking the app", "Opening the app", "Looking at the page", "Fixing what it saw",
      "Fixing errors (attempt 2 of 3)", "Auto-fix: fixed", "Auto-fix: failed", "Planning the app", "Writing the contracts",
    ];
    for (const label of labels) {
      const text = step(label)?.text ?? "";
      expect(text, label).not.toMatch(/\.(tsx?|jsx?|sol|css|json|md|svg)\b/);
      expect(text, label).not.toMatch(/error|solc|auto-fix/i);
    }
  });

  it("hides guide reads and the plan step, and says how the fixes went", () => {
    expect(step("Reading the visual-design guide")).toBeNull();
    expect(plainStep({ id: "plan", label: "Plan" })).toBeNull();
    expect(step("Fixing errors (attempt 1 of 3)")?.text).toBe("Fixing a small thing it found");
    expect(step("Auto-fix: fixed", "Fixed 3 errors on attempt 1 of 3")?.text).toBe("Fixed 3 problems by itself");
    expect(step("Auto-fix: failed", "Failed after 2 attempts: 1 error left")?.text).toBe("1 problem still needs a fix");
  });

  it("drops a spec step's route or contract name", () => {
    expect(planStepText("/goals: add and list goals")).toBe("Add and list goals");
    expect(planStepText("SavingsGoals: holds each saver's G$")).toBe("Holds each saver's G$");
    expect(planStepText("Build the deposit page")).toBe("Build the deposit page");
    expect(CHECKING_STEP).toMatch(/phone and a computer/);
  });
});

describe("plain words (D164)", () => {
  it("never shows a raw error", () => {
    expect(plainError("TypeError: fetch failed (cause: ECONNRESET)")).toMatch(/^We lost the connection/);
    expect(plainError("The AI provider has no valid API key. Set ANTHROPIC_API_KEY in .env.local")).toMatch(/^The AI that writes your app/);
    expect(plainError("This build was interrupted and couldn't continue: the saved progress no longer matches this build's steps. Retry to run it again.")).toMatch(/couldn't pick up where it left off/);
    expect(plainError("relation \"projects\" does not exist")).toMatch(/^Something went wrong on our side/);
    expect(plainError(undefined)).toMatch(/Your files are saved/);
    const paused = "This build paused because your credits ran low. What it made so far is saved.";
    expect(plainError(paused)).toBe(paused);
    for (const raw of ["ECONNRESET", "deadline exceeded", "429 Too Many Requests", "Cannot read properties of undefined"]) expect(plainError(raw)).not.toContain(raw);
  });

  it("names each milestone so the name, sent as a request, picks that milestone", () => {
    for (const id of ["wallet", "multiplayer", "integrations", "payments"]) {
      expect(requestedMilestones(milestoneName(id)).map((m) => m.id)).toContain(id);
    }
    expect(plainMilestoneTitle("Working first interface (needs verification)")).toBe("Your app's screens");
    expect(plainMilestoneTitle("On-chain features and payments")).toBe("Payments on Celo");
  });
});
