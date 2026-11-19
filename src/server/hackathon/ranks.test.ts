// @vitest-environment node
import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { hackathonApprovals, hackathonEntries } from "@/server/db/hackathon-schema";
import { HACKATHON_ID } from "./claim";
import { previousRanks, snapshotRanks, watDay, withRankMoves } from "./ranks";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

async function entry(title: string, live = true) {
  const [u] = await db.insert(users).values({ wallet: `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}` }).returning();
  const [e] = await db
    .insert(hackathonEntries)
    .values({ hackathon: HACKATHON_ID, userId: u.id, alias: title, title, pitch: "p", liveUrl: live ? "https://example.com" : "", sourceUrl: "" })
    .returning();
  return e;
}
async function approve(entryId: string, n: number) {
  for (let i = 0; i < n; i++) await db.insert(hackathonApprovals).values({ entryId, goodidRoot: `0xroot${randomUUID()}` });
}
const at = (iso: string) => new Date(iso);

it("works out the West Africa date, which runs an hour ahead of UTC", () => {
  expect(watDay(at("2026-11-19T22:59:00Z"))).toBe("2026-11-19");
  expect(watDay(at("2026-11-19T23:00:00Z"))).toBe("2026-11-20");
});

it("snapshots published projects once a day and never changes the first one", async () => {
  const a = await entry("a");
  await entry("idea", false);
  await approve(a.id, 2);
  const first = await snapshotRanks(db, at("2026-11-20T00:30:00Z"));
  expect(first).toEqual({ day: "2026-11-20", written: 1 });
  await approve(a.id, 5);
  expect(await snapshotRanks(db, at("2026-11-20T10:00:00Z"))).toEqual({ day: "2026-11-20", written: 0 });
});

it("reports no previous ranks until a day has passed", async () => {
  const a = await entry("a");
  await snapshotRanks(db, at("2026-11-20T08:00:00Z"));
  expect((await previousRanks(db, at("2026-11-20T20:00:00Z"))).size).toBe(0);
  expect((await previousRanks(db, at("2026-11-21T08:00:00Z"))).get(a.id)).toBe(1);
});

it("gives each project its rank from the latest earlier day, so a climber can be told apart", async () => {
  const a = await entry("a");
  const b = await entry("b");
  await approve(a.id, 3);
  await approve(b.id, 1);
  await snapshotRanks(db, at("2026-11-20T08:00:00Z")); // a #1, b #2
  await approve(b.id, 5); // b overtakes a
  await snapshotRanks(db, at("2026-11-21T08:00:00Z")); // b #1, a #2
  const moves = await withRankMoves(db, [{ id: a.id }, { id: b.id }], at("2026-11-21T20:00:00Z"));
  expect(moves.find((m) => m.id === a.id)?.prevRank).toBe(1);
  expect(moves.find((m) => m.id === b.id)?.prevRank).toBe(2);
});

it("leaves projects that are new since the snapshot without a previous rank", async () => {
  const a = await entry("a");
  await snapshotRanks(db, at("2026-11-20T08:00:00Z"));
  const fresh = await entry("fresh");
  const moves = await withRankMoves(db, [{ id: a.id }, { id: fresh.id }], at("2026-11-21T08:00:00Z"));
  expect(moves.find((m) => m.id === fresh.id)?.prevRank).toBeNull();
});

it("stops snapshotting after the day that holds the final ranking", async () => {
  await entry("a");
  expect((await snapshotRanks(db, at("2026-12-10T23:30:00Z"))).written).toBe(1); // 11 Dec WAT: the final ranking
  expect(await snapshotRanks(db, at("2026-12-11T23:30:00Z"))).toEqual({ day: "2026-12-12", written: 0 });
  expect(await db.select().from(hackathonEntries).where(eq(hackathonEntries.hackathon, HACKATHON_ID))).toHaveLength(1);
});
