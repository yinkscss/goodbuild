import { describe, expect, it } from "vitest";

import { HACKATHON, PRIZES } from "./content";

describe("hackathon content", () => {
  it("splits exactly the advertised pool", () => {
    expect(PRIZES.reduce((sum, p) => sum + p.amountGd, 0)).toBe(HACKATHON.poolGd);
  });
});
