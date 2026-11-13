import { describe, expect, it } from "vitest";

describe("visualCheckFailure", () => {
  it("names a credit refusal and a too-large page instead of saying the check couldn't run", async () => {
    const { visualCheckFailure, CHECK_FAILED } = await import("./use-workspace");
    expect(await visualCheckFailure(new Response("{}", { status: 402 }))).toContain("no AI credit");
    expect(await visualCheckFailure(new Response("{}", { status: 413 }))).toContain("too large");
    expect(await visualCheckFailure(new Response("{}", { status: 500 }))).toBe(CHECK_FAILED);
  });
});
