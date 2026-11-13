// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";

import { createTestDb } from "@/server/db/client";
import { messages, usageEvents } from "@/server/db/schema";
import { signInUser } from "@/server/auth/service";
import { createProjectFromPrompt } from "@/server/projects";
import type { TurnRecord } from "@/lib/turn-types";
import { scriptedModel } from "./fake-model";
import { parseVisualCheck, runVisualCheck } from "./visual-check";

describe("parseVisualCheck", () => {
  it("reads ok and issues, capped, and rejects junk", () => {
    expect(parseVisualCheck('{"ok": true}')).toEqual({ ok: true, issues: [] });
    expect(parseVisualCheck('Sure: {"ok": false, "issues": ["a","b","c","d","e"]}')?.issues).toHaveLength(4);
    expect(parseVisualCheck('{"ok": false, "issues": ["Hero is blank — only a button"]}')?.issues).toEqual(["Hero is blank, only a button"]);
    expect(parseVisualCheck("looks fine")).toBeNull();
    expect(parseVisualCheck('{"issues": []}')).toBeNull();
  });
});

describe("runVisualCheck", () => {
  it("sends the screenshot with the user's request and saves the result on the turn", async () => {
    const db = await createTestDb();
    const user = await signInUser(db, { wallet: "0xabc", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    const p = await createProjectFromPrompt(db, user.id, { prompt: "A landing page for Kola Coffee", network: "celo-sepolia" });
    const record: TurnRecord = { kind: "turn", mode: "build", steps: [], log: [], changes: [], chargedMicro: 10, status: "ready", version: 2 };
    const [turn] = await db.insert(messages).values({ projectId: p.id, role: "assistant", content: "Built it.", status: "done", meta: record as unknown as Record<string, unknown> }).returning();
    const png = new Uint8Array(await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ffffff" } }).png().toBuffer());
    const { client, requests } = scriptedModel([{ text: '{"ok": false, "issues": ["The hero image is an empty box"]}' }]);

    const check = await runVisualCheck({ db, model: client, projectId: p.id, userId: user.id, version: 2, width: 400, png });
    expect(check).toMatchObject({ ok: false, issues: ["The hero image is an empty box"], width: 400 });
    const parts = requests[0].messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts[0].text).toContain("A landing page for Kola Coffee");
    expect(parts.some((x) => x.type === "image")).toBe(true);
    const [saved] = await db.select().from(messages).where(eq(messages.id, turn.id));
    expect((saved.meta as unknown as TurnRecord).visualCheck?.issues).toEqual(["The hero image is an empty box"]);
    expect((await db.select().from(usageEvents)).length).toBe(1);
    // No turn built that version: nothing to attach the check to.
    expect(await runVisualCheck({ db, model: client, projectId: p.id, userId: user.id, version: 9, width: 400, png })).toBeNull();
  });

  it("takes a JPEG, which the preview sends when a page is too big for a PNG", async () => {
    const db = await createTestDb();
    const user = await signInUser(db, { wallet: "0xa1b", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    const p = await createProjectFromPrompt(db, user.id, { prompt: "A photo gallery dApp", network: "celo-sepolia" });
    const record: TurnRecord = { kind: "turn", mode: "build", steps: [], log: [], changes: [], chargedMicro: 0, status: "ready", version: 1 };
    await db.insert(messages).values({ projectId: p.id, role: "assistant", content: "Built.", status: "done", meta: record as unknown as Record<string, unknown> });
    const jpeg = new Uint8Array(await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ffffff" } }).jpeg().toBuffer());
    const { client, requests } = scriptedModel([{ text: '{"ok": true}' }]);
    expect(await runVisualCheck({ db, model: client, projectId: p.id, userId: user.id, version: 1, width: 400, png: jpeg })).toMatchObject({ ok: true });
    const image = (requests[0].messages[0].content as Array<{ type: string; mediaType?: string }>).find((x) => x.type === "image");
    expect(image?.mediaType).toBe("image/jpeg");
  });

  it("retries once on an unusable reply, then gives up without saving", async () => {
    const db = await createTestDb();
    const user = await signInUser(db, { wallet: "0xdef", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    const p = await createProjectFromPrompt(db, user.id, { prompt: "A page", network: "celo-sepolia" });
    const record: TurnRecord = { kind: "turn", mode: "build", steps: [], log: [], changes: [], chargedMicro: 0, status: "ready", version: 1 };
    const [turn] = await db.insert(messages).values({ projectId: p.id, role: "assistant", content: "Built.", status: "done", meta: record as unknown as Record<string, unknown> }).returning();
    const png = new Uint8Array(await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ffffff" } }).png().toBuffer());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const second = scriptedModel([{ text: "" }, { text: '{"ok": true}' }]);
    expect(await runVisualCheck({ db, model: second.client, projectId: p.id, userId: user.id, version: 1, width: 400, png })).toMatchObject({ ok: true });
    expect(second.requests).toHaveLength(2);

    const never = scriptedModel([{ text: "" }, { text: "no json here" }]);
    await db.update(messages).set({ meta: record as unknown as Record<string, unknown> }).where(eq(messages.id, turn.id));
    expect(await runVisualCheck({ db, model: never.client, projectId: p.id, userId: user.id, version: 1, width: 400, png })).toBeNull();
    const [saved] = await db.select().from(messages).where(eq(messages.id, turn.id));
    expect((saved.meta as unknown as TurnRecord).visualCheck).toBeUndefined();
    warn.mockRestore();
  });
});
