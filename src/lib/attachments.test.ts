import { describe, expect, it } from "vitest";

import { messageAssetIds, pendingAssetIds } from "./attachments";

const user = (createdAt: string, meta: Record<string, unknown> | null = { mode: "build" }) => ({ role: "user", createdAt, meta });
const asset = (id: string, createdAt: string) => ({ id, createdAt });

describe("attachments", () => {
  it("reads the ids a message was sent with, ignoring anything else", () => {
    expect(messageAssetIds({ assetIds: ["a", 3, "b"] })).toEqual(["a", "b"]);
    expect(messageAssetIds({ mode: "build" })).toEqual([]);
    expect(messageAssetIds(null)).toEqual([]);
  });

  it("a file uploaded after the last message waits in the composer", () => {
    const pending = pendingAssetIds([user("2026-01-01T10:00:00Z", { assetIds: [] })], [asset("new", "2026-01-01T10:05:00Z")]);
    expect([...pending]).toEqual(["new"]);
  });

  it("a file sent with a message is no longer pending", () => {
    const messages = [user("2026-01-01T10:00:00Z", { assetIds: ["x"] })];
    expect(pendingAssetIds(messages, [asset("x", "2026-01-01T09:59:00Z")]).size).toBe(0);
  });

  it("files from older projects count as sent once a later message went out", () => {
    const messages = [user("2026-01-01T10:00:00Z")];
    expect(pendingAssetIds(messages, [asset("old", "2026-01-01T09:00:00Z")]).size).toBe(0);
  });

  it("a message that could not carry files (a plan answer) leaves the chip waiting", () => {
    const messages = [user("2026-01-01T10:00:00Z", { assetIds: [] }), user("2026-01-01T10:10:00Z", { mode: "plan" })];
    expect([...pendingAssetIds(messages, [asset("y", "2026-01-01T10:05:00Z")])]).toEqual(["y"]);
  });

  it("with no messages yet, every upload is pending", () => {
    expect(pendingAssetIds([], [asset("a", "2026-01-01T10:00:00Z")]).size).toBe(1);
  });
});
