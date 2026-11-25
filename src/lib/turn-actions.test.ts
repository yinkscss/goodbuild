import { describe, expect, it } from "vitest";

import { actionFromText, keepsScope } from "./turn-actions";
import { CONTINUE_PROMPT, FIX_PROMPT, previewFixPrompt } from "./preview-errors";
import { SKIP_PLAN_TEXT, START_BUILDING_TEXT } from "./plan";
import { firstIntent } from "./first-intent";

describe("actionFromText (old clients, D173)", () => {
  it("recognises the app's own button texts", () => {
    expect(actionFromText(START_BUILDING_TEXT)).toBe("start_building");
    expect(actionFromText(SKIP_PLAN_TEXT)).toBe("skip_questions");
    expect(actionFromText(CONTINUE_PROMPT)).toBe("resume");
    expect(actionFromText(FIX_PROMPT)).toBe("repair");
    expect(actionFromText(`${FIX_PROMPT}\n\nThe preview shows this error. Fix it:\nTypeError`)).toBe("repair");
    expect(actionFromText(previewFixPrompt({ title: "TypeError", message: "x is undefined", path: "/src/App.tsx", line: 3 }, false))).toBe("repair");
    expect(actionFromText(previewFixPrompt({ title: "TypeError", message: "x is undefined" }, true))).toBe("repair");
    expect(actionFromText("Fix these visual problems the preview check found on a phone (390px wide):\n- The button overlaps")).toBe("repair");
    expect(actionFromText("The deploy to Celo was stopped because the contract holds other people's money")).toBe("repair");
    expect(actionFromText("Add saved data to this app (GoodBuild's built-in backend, with wallet sign-in): scores")).toBe("add_saved_data");
  });

  it("leaves the person's own words alone", () => {
    for (const text of ["start building a quiz game", "Fix the colours of the header", "Continue", "Add a wallet button", "", undefined]) expect(actionFromText(text)).toBeUndefined();
  });

  it("keeps scope only for repairs and resumes", () => {
    expect(keepsScope("repair")).toBe(true);
    expect(keepsScope("resume")).toBe(true);
    expect(keepsScope("start_building")).toBe(false);
    expect(keepsScope(undefined)).toBe(false);
  });
});

describe("firstIntent (D173)", () => {
  it("offers ideas when the message asks what to build or names nothing", () => {
    for (const text of ["What could I build using G$?", "which app should we make with gooddollar", "give me some ideas", "ideas?", "i need to make a good dollar dapp", "Hello", "hey, I want an app on celo"]) expect(firstIntent(text), text).toBe("ideas");
  });

  it("builds anything concrete, even short or phrased as a question", () => {
    for (const text of ["a quiz game", "Can you build a tic tac toe game?", "A G$ tip jar for my blog", "savings circle for my friends", "How do I deploy?", "chat", "What is the price of G$?"]) expect(firstIntent(text), text).toBe("build");
  });
});
