// @vitest-environment node
import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  approveEntry,
  listEntries,
  saveEntry,
  saveParticipant,
  participantCsv,
} from "./community";
let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});
const wallet = () =>
  `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}` as `0x${string}`;
async function user() {
  const u = (
    await db.insert(users).values({ wallet: wallet() }).returning()
  )[0];
  await saveParticipant(db, u, { email: "builder@example.com" });
  return u;
}
it("keeps signup email before verification and exports safely without exposing it publicly", async () => {
  const u = await user();
  await saveParticipant(db, u, { email: "builder@example.com" });
  await saveEntry(db, u, {
    alias: "=HYPERLINK(1)",
    title: "A public good",
    pitch: "My idea",
    liveUrl: "",
    sourceUrl: "",
  });
  expect(await participantCsv(db)).toContain("builder@example.com");
  expect(await participantCsv(db)).toContain("'=HYPERLINK(1)");
  const entries = await listEntries(db);
  expect(entries).toHaveLength(1);
  expect(JSON.stringify(entries)).not.toContain("builder@example.com");
});
it("counts one approval per human per published entry, including linked wallets", async () => {
  const owner = await user();
  const voter = await user();
  const linked = await user();
  const root = wallet();
  const entry = await saveEntry(db, owner, {
    alias: "Builder",
    title: "App",
    pitch: "A useful app",
    liveUrl: "https://example.com",
    sourceUrl: "",
  });
  await approveEntry(db, voter, entry.id, async (w) =>
    w === owner.wallet ? null : root,
  );
  await approveEntry(db, linked, entry.id, async (w) =>
    w === owner.wallet ? null : root,
  );
  expect((await listEntries(db))[0].approvals).toBe(1);
  await expect(
    approveEntry(db, owner, entry.id, async () => root),
  ).rejects.toThrow(/own/);
  await expect(
    approveEntry(db, await user(), entry.id, async () => null),
  ).rejects.toThrow(/verify/i);
});
it("rejects approvals for ideas and unsafe links; an owner can update their entry", async () => {
  const u = await user();
  const voter = await user();
  await expect(
    saveEntry(db, u, {
      alias: "A",
      title: "B",
      pitch: "C",
      liveUrl: "javascript:alert(1)",
      sourceUrl: "",
    }),
  ).rejects.toThrow();
  const e = await saveEntry(db, u, {
    alias: "A",
    title: "B",
    pitch: "C",
    liveUrl: "",
    sourceUrl: "",
  });
  await expect(
    approveEntry(db, voter, e.id, async () => wallet()),
  ).rejects.toThrow(/publish/i);
  const updated = await saveEntry(db, u, {
    alias: "A",
    title: "Updated",
    pitch: "C",
    liveUrl: "https://example.com",
    sourceUrl: "",
  });
  expect(updated.id).toBe(e.id);
  expect(await listEntries(db)).toHaveLength(1);
});

it("requires contact details even for direct API submissions", async () => {
  const u = (
    await db.insert(users).values({ wallet: wallet() }).returning()
  )[0];
  await expect(
    saveEntry(db, u, {
      alias: "A",
      title: "B",
      pitch: "C",
      liveUrl: "",
      sourceUrl: "",
    }),
  ).rejects.toThrow(/email/);
});
it("blocks linked-wallet self approvals even when the owner has no cached verification", async () => {
  const owner = await user();
  const linked = await user();
  const root = wallet();
  const entry = await saveEntry(db, owner, {
    alias: "A",
    title: "B",
    pitch: "C",
    liveUrl: "https://example.com",
    sourceUrl: "",
  });
  await expect(
    approveEntry(db, linked, entry.id, async () => root),
  ).rejects.toThrow(/own/);
});
it("persists optional skip without requiring a FlowState vote", async () => {
  const u = await user();
  await saveParticipant(db, u, {
    email: "builder@example.com",
    flowstate: "skipped",
  });
  expect(await participantCsv(db)).toContain('"skipped"');
});

it("exports every signup rather than the admin report’s 500-row preview", async () => {
  const accounts = await db
    .insert(users)
    .values(Array.from({ length: 501 }, () => ({ wallet: wallet() })))
    .returning();
  const { hackathonParticipants } =
    await import("@/server/db/hackathon-schema");
  const { HACKATHON_ID } = await import("./claim");
  await db.insert(hackathonParticipants).values(
    accounts.map((u, i) => ({
      hackathon: HACKATHON_ID,
      userId: u.id,
      email: `builder${i}@example.com`,
    })),
  );
  expect((await participantCsv(db)).split("\r\n")).toHaveLength(502);
});

it("closes approvals at the deadline before querying identity", async () => {
  const { CLAIMS_CLOSE } = await import("./claim");
  const u = await user();
  await expect(
    approveEntry(
      db,
      u,
      randomUUID(),
      async () => {
        throw new Error("should not call chain");
      },
      CLAIMS_CLOSE,
    ),
  ).rejects.toThrow("Approvals are closed");
});
it("does not let a link visit or skip erase a server-confirmed FlowState vote", async () => {
  const u = await user();
  const { hackathonParticipants } =
    await import("@/server/db/hackathon-schema");
  const { eq } = await import("drizzle-orm");
  await db
    .update(hackathonParticipants)
    .set({ flowstate: "voted", flowstateTxHash: "0x" + "a".repeat(64) })
    .where(eq(hackathonParticipants.userId, u.id));
  const saved = await saveParticipant(db, u, {
    email: "builder@example.com",
    flowstate: "skipped",
  });
  expect(saved.flowstate).toBe("voted");
  const { participantInput } = await import("./community");
  expect(
    participantInput.safeParse({
      email: "builder@example.com",
      flowstate: "voted",
    }).success,
  ).toBe(false);
});
