import { describe, expect, it } from "vitest";

import { PRIZES } from "./content";

describe("hackathon content", () => {
  it("offers base rewards and approval top-ups without podium positions", () => {
    expect(PRIZES.map(p => p.id)).toEqual(["reserve", "base", "approvals"]);
  });
});

describe("hackathon credit amounts", () => {
  it("match on the page and on the server", async () => {
    const page = await import("./use-hackathon-claim");
    const server = await import("@/server/hackathon/claim");
    expect([page.START_CREDITS, page.DEPLOY_CREDITS]).toEqual([server.START_CREDITS, server.DEPLOY_CREDITS]);
  });
});
