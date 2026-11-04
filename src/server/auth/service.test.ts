// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type Db } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import { SESSION_ROTATE_AFTER_SECONDS, SESSION_TTL_SECONDS } from "./config";
import { issueSession, resolveSession, revokeSession, signInUser } from "./service";
import { readNonceToken, signNonceToken } from "./tokens";

const WALLET = "0xAbCdEf0000000000000000000000000000000001";
const yes = { ageOk: true, notUsPerson: true };

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe("signInUser", () => {
  it("requires both attestations on first sign-in", async () => {
    await expect(signInUser(db, { wallet: WALLET, walletKind: "external" })).rejects.toMatchObject({
      code: "attestation_required",
    });
    await expect(
      signInUser(db, { wallet: WALLET, walletKind: "external", attestation: { ageOk: true, notUsPerson: false } }),
    ).rejects.toMatchObject({ code: "attestation_required" });
  });

  it("creates the user keyed by lowercased wallet and remembers the attestation", async () => {
    const first = await signInUser(db, { wallet: WALLET, walletKind: "embedded", attestation: yes });
    expect(first.wallet).toBe(WALLET.toLowerCase());
    expect(first.ageOk && first.countryOk).toBe(true);
    const again = await signInUser(db, { wallet: WALLET.toLowerCase(), walletKind: "embedded" });
    expect(again.id).toBe(first.id);
  });
});

describe("sessions", () => {
  it("issues a session that resolves to the user", async () => {
    const user = await signInUser(db, { wallet: WALLET, walletKind: "external", attestation: yes });
    const now = new Date("2026-11-04T09:00:00Z");
    const s = await issueSession(db, user, 11142220, now);
    const resolved = await resolveSession(db, s.token, new Date(now.getTime() + 60_000));
    expect(resolved?.user.id).toBe(user.id);
    expect(resolved?.chainId).toBe(11142220);
    expect(resolved?.rotated).toBeUndefined();
  });

  it("rejects tampered and unknown tokens", async () => {
    expect(await resolveSession(db, "not.a.token")).toBeNull();
    expect(await resolveSession(db, undefined)).toBeNull();
  });

  it("revoked sessions stop working (sign-out)", async () => {
    const user = await signInUser(db, { wallet: WALLET, walletKind: "external", attestation: yes });
    const s = await issueSession(db, user, 11142220);
    await revokeSession(db, s.token);
    expect(await resolveSession(db, s.token)).toBeNull();
  });

  it("rotates after a day: old session revoked, new one valid", async () => {
    const user = await signInUser(db, { wallet: WALLET, walletKind: "external", attestation: yes });
    const t0 = new Date("2026-11-04T09:00:00Z");
    const s = await issueSession(db, user, 11142220, t0);
    const later = new Date(t0.getTime() + (SESSION_ROTATE_AFTER_SECONDS + 60) * 1000);
    const resolved = await resolveSession(db, s.token, later);
    expect(resolved?.rotated).toBeDefined();
    const [old] = await db.select().from(sessions).where(eq(sessions.id, s.sessionId));
    expect(old.revokedAt).not.toBeNull();
    expect(await resolveSession(db, s.token, later)).toBeNull();
    expect((await resolveSession(db, resolved!.rotated!.token, later))?.user.id).toBe(user.id);
  });

  it("expires after 7 days", async () => {
    const user = await signInUser(db, { wallet: WALLET, walletKind: "external", attestation: yes });
    const t0 = new Date("2026-11-04T09:00:00Z");
    const s = await issueSession(db, user, 11142220, t0);
    expect(await resolveSession(db, s.token, new Date(t0.getTime() + (SESSION_TTL_SECONDS + 1) * 1000))).toBeNull();
  });
});

describe("nonce tokens", () => {
  it("round-trip and expire after 5 minutes", async () => {
    const t0 = Date.parse("2026-11-04T09:00:00Z");
    const token = await signNonceToken("nonce123", t0);
    expect(await readNonceToken(token, t0 + 60_000)).toBe("nonce123");
    expect(await readNonceToken(token, t0 + 6 * 60_000)).toBeNull();
    expect(await readNonceToken(undefined)).toBeNull();
  });
});
