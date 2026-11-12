import { describe, expect, it } from "vitest";

import { HACKATHON, PRIZES } from "./content";

describe("hackathon content", () => {
  it("splits exactly the advertised pool", () => {
    expect(PRIZES.reduce((sum, p) => sum + p.amountGd, 0)).toBe(HACKATHON.poolGd);
  });
});

describe("hackathon credit amounts", () => {
  it("match on the page and on the server", async () => {
    const page = await import("./use-hackathon-claim");
    const server = await import("@/server/hackathon/claim");
    expect([page.START_CREDITS, page.DEPLOY_CREDITS]).toEqual([server.START_CREDITS, server.DEPLOY_CREDITS]);
  });
});
