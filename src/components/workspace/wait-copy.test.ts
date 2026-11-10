import { describe, expect, it } from "vitest";

import { formatClock } from "@/components/ui/wait";
import { firstWaitCopy } from "./first-wait";
import { plainStepLabel } from "./turn-view";

describe("wait copy", () => {
  it("walks the first wait through plain stages and names the queue", () => {
    expect(firstWaitCopy(0)).toBe("Getting started…");
    expect(firstWaitCopy(5)).toBe("Setting up your project");
    expect(firstWaitCopy(12)).toBe("Lining up your first build");
    expect(firstWaitCopy(12, 1)).toBe("Another build is running. You're next in line.");
    expect(firstWaitCopy(12, 3)).toBe("3 builds are ahead of yours.");
    expect(firstWaitCopy(50)).toBe("Taking longer than usual.");
  });

  it("puts technical step names in plain words and leaves others alone", () => {
    expect(plainStepLabel("Writing SavingsCircle.sol")).toBe("Writing your contract");
    expect(plainStepLabel("Compiling with solc 0.8.28")).toBe("Building your contract");
    expect(plainStepLabel("Fixing errors (attempt 2 of 3)")).toBe("Fixing a problem (try 2 of 3)");
    expect(plainStepLabel("Writing App.tsx")).toBe("Writing App.tsx");
  });

  it("formats the clock", () => {
    expect(formatClock(83)).toBe("1:23");
    expect(formatClock(4)).toBe("0:04");
  });
});
