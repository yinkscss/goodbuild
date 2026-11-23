// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { flowstateVoters } from "@/server/db/hackathon-schema";
import {
  approveEntry,
  getParticipant,
  joinEvent,
  listEntries,
  ownEntry,
  participantCsv,
  saveEntry,
  saveParticipant,
  voteStatus,
} from "./community";
import { snapshotRanks, previousRanks } from "./ranks";

// The FUTMinna hackathon (D160): same tables, its own entries, approvals, leaderboard and signups.
let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  // Submissions and approvals close at CLAIMS_CLOSE (10 Dec), so the clock is pinned before it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});
const wallet = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}` as `0x${string}`;
async function voter(email: string | null = "student@example.com") {
  const u = (await db.insert(users).values({ wallet: wallet(), email }).returning())[0];
  await db.insert(flowstateVoters).values({ userId: u.id, votedAt: new Date(), txHash: "0xabc" });
  return u;
}
const project = (title: string, liveUrl = "https://app.example.com") => ({ alias: "Builder", title, pitch: "A G$ game", liveUrl, sourceUrl: "" });

it("keeps FUTMinna entries off the main leaderboard and the other way round", async () => {
  const student = await voter();
  const builder = await voter();
  await saveParticipant(db, builder, { email: "b@example.com" });
  const futminna = await saveEntry(db, student, project("Campus G$ game"), "futminna");
  const main = await saveEntry(db, builder, project("Main app"));
  expect((await listEntries(db, "futminna")).map((e) => e.id)).toEqual([futminna.id]);
  expect((await listEntries(db)).map((e) => e.id)).toEqual([main.id]);
  expect(await ownEntry(db, student.id, "futminna")).toMatchObject({ id: futminna.id });
  expect(await ownEntry(db, student.id)).toBeNull();
});

it("signs a student up for FUTMinna with their login email when they submit there first", async () => {
  const student = await voter("me@student.example");
  await saveEntry(db, student, project("Quiz"), "futminna");
  expect(await getParticipant(db, student.id, "futminna")).toMatchObject({ email: "me@student.example", flowstate: "voted" });
  expect(await getParticipant(db, student.id)).toBeNull();
  expect(await participantCsv(db, "futminna")).toContain("me@student.example");
  expect(await participantCsv(db)).not.toContain("me@student.example");
});

it("joins FUTMinna with the email from the main signup, and does nothing without any email", async () => {
  const builder = await voter(null);
  expect(await joinEvent(db, builder, "futminna")).toBeNull();
  await saveParticipant(db, builder, { email: "contact@example.com" });
  expect(await joinEvent(db, builder, "futminna")).toMatchObject({ email: "contact@example.com" });
  // Repeat calls keep the one row.
  expect((await joinEvent(db, builder, "futminna"))?.id).toBe((await getParticipant(db, builder.id, "futminna"))?.id);
});

it("lets a builder enter one hackathon only", async () => {
  const student = await voter();
  await saveParticipant(db, student, { email: "s@example.com" });
  await saveEntry(db, student, project("First"), "futminna");
  // Editing it in FUTMinna is fine.
  await expect(saveEntry(db, student, project("First, renamed"), "futminna")).resolves.toMatchObject({ title: "First, renamed" });
  await expect(saveEntry(db, student, project("Second"))).rejects.toThrow(/already entered in another hackathon/);
  expect(await listEntries(db)).toHaveLength(0);
});

it("gives every verified person 3 approvals in each hackathon, counted separately", async () => {
  const student = await voter();
  const builder = await voter();
  await saveParticipant(db, builder, { email: "b@example.com" });
  const campus = await saveEntry(db, student, project("Campus"), "futminna");
  const main = await saveEntry(db, builder, project("Main"));
  const fan = await voter();
  const root = wallet();
  const readRoot = async (w: string) => (w === fan.wallet ? root : wallet());
  for (let i = 0; i < 3; i++) await approveEntry(db, fan, campus.id, readRoot, new Date(), "futminna");
  await expect(approveEntry(db, fan, campus.id, readRoot, new Date(), "futminna")).rejects.toThrow(/all 3/);
  // The main hackathon's approvals are untouched.
  await expect(approveEntry(db, fan, main.id, readRoot)).resolves.toMatchObject({ used: 1 });
  // A FUTMinna project can't be approved through the main hackathon, or the other way round.
  await expect(approveEntry(db, fan, campus.id, readRoot)).rejects.toThrow(/not found/);
  expect((await voteStatus(db, fan, readRoot, "futminna")).used).toBe(3);
  expect((await voteStatus(db, fan, readRoot)).used).toBe(1);
  expect((await listEntries(db, "futminna"))[0].approvals).toBe(3);
});

it("records rank snapshots per hackathon", async () => {
  const student = await voter();
  const builder = await voter();
  await saveParticipant(db, builder, { email: "b@example.com" });
  const campus = await saveEntry(db, student, project("Campus"), "futminna");
  await saveEntry(db, builder, project("Main"));
  const yesterday = new Date("2026-11-20T12:00:00Z");
  await snapshotRanks(db, yesterday, "futminna");
  const today = new Date("2026-11-21T12:00:00Z");
  expect([...(await previousRanks(db, today, "futminna")).entries()]).toEqual([[campus.id, 1]]);
  expect((await previousRanks(db, today)).size).toBe(0);
});

// Kadpoly (D166): a third hackathon on the same tables, with its own close on 31 Dec.
it("keeps Kadpoly separate from FUTMinna: one entry per builder, separate approvals", async () => {
  const student = await voter();
  await saveParticipant(db, student, { email: "s@example.com" });
  const kad = await saveEntry(db, student, project("Kad game"), "kadpoly");
  await expect(saveEntry(db, student, project("Other"), "futminna")).rejects.toThrow(/already entered in another hackathon/);
  expect((await listEntries(db, "kadpoly")).map((e) => e.id)).toEqual([kad.id]);
  expect(await listEntries(db, "futminna")).toHaveLength(0);
  const fan = await voter();
  const root = wallet();
  const readRoot = async (w: string) => (w === fan.wallet ? root : wallet());
  await approveEntry(db, fan, kad.id, readRoot, new Date(), "kadpoly");
  expect((await voteStatus(db, fan, readRoot, "kadpoly")).used).toBe(1);
  expect((await voteStatus(db, fan, readRoot, "futminna")).used).toBe(0);
});

it("keeps Kadpoly open after the main close on 10 Dec, until the end of 31 Dec", async () => {
  const student = await voter();
  await saveParticipant(db, student, { email: "s@example.com" });
  const kad = await saveEntry(db, student, project("Kad game"), "kadpoly");
  const fan = await voter();
  const root = wallet();
  const readRoot = async (w: string) => (w === fan.wallet ? root : wallet());
  const dec20 = new Date("2026-12-20T12:00:00Z");
  await expect(approveEntry(db, fan, kad.id, readRoot, dec20, "futminna")).rejects.toThrow(/closed/);
  await expect(approveEntry(db, fan, kad.id, readRoot, dec20, "kadpoly")).resolves.toMatchObject({ used: 1 });
  await expect(approveEntry(db, fan, kad.id, readRoot, new Date("2026-12-31T23:00:00Z"), "kadpoly")).rejects.toThrow(/closed/);
  vi.setSystemTime(dec20);
  await expect(saveEntry(db, student, project("Kad game v2"), "kadpoly")).resolves.toMatchObject({ title: "Kad game v2" });
  expect((await snapshotRanks(db, dec20, "kadpoly")).written).toBe(1);
  expect((await snapshotRanks(db, dec20, "futminna")).written).toBe(0);
});
