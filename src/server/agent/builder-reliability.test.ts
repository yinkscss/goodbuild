// @vitest-environment node
import { describe, expect, it } from "vitest";
import { plainToolFailure, tidyReply } from "./runner";

describe("plain words for people who don't code (D162)", () => {
  it("removes empty code boxes and em dashes from replies", () => {
    expect(tidyReply("Done — it works.\n\n```\n\n```\n\nNext: add a chart.")).toBe("Done, it works.\n\nNext: add a chart.");
    expect(tidyReply("Here is the address:\n```\n0xabc\n```")).toBe("Here is the address:\n```\n0xabc\n```");
    // Two blocks side by side stay two blocks.
    const two = "```\na\n```\n```\nb\n```";
    expect(tidyReply(two)).toBe(two);
  });

  it("explains a tool that didn't work without the technical error", () => {
    expect(plainToolFailure("Error in src/components/WalletCard.tsx: Edit 3: \"search\" text was not found.")).toBe("didn't work the first time, so the builder tries another way");
    expect(plainToolFailure("Refused by the server: this build is scoped to the \"Wallet connection\" milestone")).toBe("not part of this step, so it was skipped");
    expect(plainToolFailure('Error: "left-pad" isn\'t on the allowed list: recharts.')).toBe("that package isn't available, so the builder uses another way");
  });
});
