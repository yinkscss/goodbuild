import { describe, expect, it } from "vitest";

import { AUTO_FIX_LEAD, isInfraError, previewFixPrompt, shouldAutoFix } from "./preview-errors";

const app = { title: "Error", message: "Element type is invalid: expected a string but got: undefined", path: "/src/components/Footer.tsx", line: 12 };

describe("preview auto-fix policy", () => {
  it("fixes an app error once, for the version just built", () => {
    expect(shouldAutoFix({ error: app, version: 3, eligibleVersion: 3, running: false })).toBe(true);
    expect(shouldAutoFix({ error: app, version: 2, eligibleVersion: 3, running: false })).toBe(false);
    expect(shouldAutoFix({ error: app, version: 3, eligibleVersion: null, running: false })).toBe(false);
    expect(shouldAutoFix({ error: app, version: 3, eligibleVersion: 3, running: true })).toBe(false);
  });
  it("never auto-fixes bundler or network failures", () => {
    for (const message of ["TIME_OUT", "Could not fetch dependencies", "Failed to fetch", "Request timed out"]) {
      expect(isInfraError({ title: "Error", message })).toBe(true);
      expect(shouldAutoFix({ error: { title: "Error", message }, version: 1, eligibleVersion: 1, running: false })).toBe(false);
    }
    expect(isInfraError(app)).toBe(false);
  });
  it("marks automatic prompts so they never chain", () => {
    expect(previewFixPrompt(app, true).startsWith(AUTO_FIX_LEAD)).toBe(true);
    expect(previewFixPrompt(app, true)).toContain("src/components/Footer.tsx:12");
    expect(previewFixPrompt(app, false).startsWith(AUTO_FIX_LEAD)).toBe(false);
  });
});
