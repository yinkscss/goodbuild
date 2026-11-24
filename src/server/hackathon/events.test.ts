// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  flowstateVoters,
  hackathonApprovals,
  hackathonEntries,
  hackathonParticipants,
  hackathonRankSnapshots,
} from "@/server/db/hackathon-schema";
import { approveEntry, getParticipant, listEntries, saveEntry, saveParticipant, voteStatus } from "./community";
import { snapshotRanks, weeklyStars } from "./ranks";

// D170: the FUTMinna and Kadpoly hackathons merged into the main one, closing 31 Dec.
let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});
const MAIN = "million-2027";
const wallet = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}` as `0x${string}`;
async function person(email: string | null = "p@example.com") {
  return (await db.insert(users).values({ wallet: wallet(), email }).returning())[0];
}
async function voter(email: string | null = "v@example.com") {
  const u = await person(email);
  await db.insert(flowstateVoters).values({ userId: u.id, votedAt: new Date(), txHash: "0xabc" });
  return u;
}
const project = (title: string, liveUrl = "https://app.example.com") => ({ alias: "Builder", title, pitch: "A G$ game", liveUrl, sourceUrl: "" });
const entryRow = (hackathon: string, userId: string, title: string) => ({ hackathon, userId, ...project(title) });

/** Runs migration 0035 again on the seeded rows: the test database already ran it while empty. */
async function runMerge() {
  const file = readFileSync(join(process.cwd(), "drizzle/0035_merge_hackathons.sql"), "utf8");
  for (const statement of file.split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
}

it("moves campus signups, projects, approvals and ranks into the one hackathon", async () => {
  // Signed up for main and FUTMinna; voted only on the FUTMinna signup.
  const both = await person();
  const bothMain = (await db.insert(hackathonParticipants).values({ hackathon: MAIN, userId: both.id, email: "main@example.com" }).returning())[0];
  await db.insert(hackathonParticipants).values({ hackathon: "futminna-2026", userId: both.id, email: "campus@example.com", flowstate: "voted", flowstateTxHash: "0xvote" });
  // Kadpoly only, signed up on Kadpoly and then FUTMinna: the earlier one stays.
  const campusOnly = await person();
  await db.insert(hackathonParticipants).values({ hackathon: "kadpoly-2026", userId: campusOnly.id, email: "kad@example.com", createdAt: new Date("2026-11-23T10:00:00Z") });
  await db.insert(hackathonParticipants).values({ hackathon: "futminna-2026", userId: campusOnly.id, email: "fut@example.com", createdAt: new Date("2026-11-23T11:00:00Z") });

  const kad = (await db.insert(hackathonEntries).values({ ...entryRow("kadpoly-2026", campusOnly.id, "Kad game"), createdAt: new Date("2026-11-23T12:00:00Z") }).returning())[0];
  const main = (await db.insert(hackathonEntries).values({ ...entryRow(MAIN, both.id, "Main app"), createdAt: new Date("2026-11-24T12:00:00Z") }).returning())[0];
  // One person used 3 approvals in main and 3 in Kadpoly.
  const root = "0xfan";
  for (let i = 0; i < 3; i++) await db.insert(hackathonApprovals).values([{ entryId: main.id, goodidRoot: root }, { entryId: kad.id, goodidRoot: root }]);
  await db.insert(hackathonRankSnapshots).values({ hackathon: "kadpoly-2026", day: "2026-11-24", entryId: kad.id, rank: 1, approvals: 3 });

  await runMerge();
  await runMerge(); // safe to run twice

  const rows = await db.select().from(hackathonParticipants);
  expect(rows.every((r) => r.hackathon === MAIN)).toBe(true);
  expect(rows).toHaveLength(2);
  expect(await getParticipant(db, both.id)).toMatchObject({ id: bothMain.id, email: "main@example.com", flowstate: "voted", flowstateTxHash: "0xvote" });
  expect(await getParticipant(db, campusOnly.id)).toMatchObject({ email: "kad@example.com" });

  // Tied on approvals, so the earlier submission (Kadpoly's) ranks first.
  expect((await listEntries(db)).map((e) => [e.title, e.approvals])).toEqual([
    ["Kad game", 3],
    ["Main app", 3],
  ]);
  const snaps = await db.select().from(hackathonRankSnapshots).where(eq(hackathonRankSnapshots.entryId, kad.id));
  expect(snaps.map((s) => s.hackathon)).toEqual([MAIN]);
});

it("keeps over-cap approvals from the merge but allows no new ones, and never shows more than 3 used", async () => {
  const a = await voter();
  const b = await voter();
  const one = (await db.insert(hackathonEntries).values(entryRow("futminna-2026", a.id, "One")).returning())[0];
  const two = (await db.insert(hackathonEntries).values(entryRow(MAIN, b.id, "Two")).returning())[0];
  const fan = await voter();
  const root = wallet();
  for (let i = 0; i < 3; i++) await db.insert(hackathonApprovals).values([{ entryId: one.id, goodidRoot: root.toLowerCase() }, { entryId: two.id, goodidRoot: root.toLowerCase() }]);
  await runMerge();
  const readRoot = async (w: string) => (w === fan.wallet ? root : wallet());
  const status = await voteStatus(db, fan, readRoot);
  expect(status.used).toBe(3);
  expect(status.entryIds).toHaveLength(6);
  await expect(approveEntry(db, fan, one.id, readRoot)).rejects.toThrow(/all 3/);
});

it("stops a merge that would give a builder two projects", async () => {
  const u = await person();
  await db.insert(hackathonEntries).values(entryRow(MAIN, u.id, "Main"));
  await db.insert(hackathonEntries).values(entryRow("kadpoly-2026", u.id, "Kad"));
  await expect(runMerge()).rejects.toThrow(/more than one hackathon/);
});

it("keeps entries and approvals open until the end of 31 Dec WAT", async () => {
  const builder = await voter();
  await saveParticipant(db, builder, { email: "b@example.com" });
  const fan = await voter();
  const root = wallet();
  const readRoot = async (w: string) => (w === fan.wallet ? root : wallet());
  const dec20 = new Date("2026-12-20T12:00:00Z");
  vi.setSystemTime(dec20);
  const entry = await saveEntry(db, builder, project("Late app"));
  await expect(approveEntry(db, fan, entry.id, readRoot, dec20)).resolves.toMatchObject({ used: 1 });
  expect((await snapshotRanks(db, dec20)).written).toBe(1);
  await expect(approveEntry(db, fan, entry.id, readRoot, new Date("2026-12-31T23:00:00Z"))).rejects.toThrow(/closed/);
  vi.setSystemTime(new Date("2026-12-31T23:00:00Z"));
  await expect(saveEntry(db, builder, project("Too late"))).rejects.toThrow(/closed/);
});

it("awards Rising Star for week 4 (11 to 17 Dec)", async () => {
  const builder = await voter();
  await saveParticipant(db, builder, { email: "b@example.com" });
  const entry = await saveEntry(db, builder, project("App"));
  await db.insert(hackathonRankSnapshots).values([
    { hackathon: MAIN, day: "2026-11-26", entryId: entry.id, rank: 1, approvals: 0 },
    { hackathon: MAIN, day: "2026-12-03", entryId: entry.id, rank: 1, approvals: 0 },
    { hackathon: MAIN, day: "2026-12-11", entryId: entry.id, rank: 1, approvals: 0 },
    { hackathon: MAIN, day: "2026-12-18", entryId: entry.id, rank: 1, approvals: 4 },
  ]);
  expect(await weeklyStars(db)).toEqual([{ week: 4, entryId: entry.id, gained: 4 }]);
});
