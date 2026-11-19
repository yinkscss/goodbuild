// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { buildSponsorships, projects, turnJobs, usageEvents, users } from "@/server/db/schema";
import type { Db } from "@/server/db/client";
import { startTurn } from "@/server/jobs/jobs";
import { recordUsage } from "@/server/agent/store";
import { MIGRATIONS, testBackends, type TestDatabase } from "./test-backends";

const ENV = { FREE_POLICY: "legacy", FIRST_DELIVERY_MICRO: "1000000", BUILD_SPONSOR_BUDGET_MICRO: "1500000" };
const identity = (root: string) => ({ readIdentity: async () => ({ root: root as `0x${string}`, expiresAt: new Date("2099-01-01") }) });
describe.each(testBackends())("build sponsorship on $name", (backend) => {
  let database: TestDatabase, db: Db;
  beforeEach(async () => { database = await backend.open(); db = database.db; await database.migrate(MIGRATIONS); });
  afterEach(async () => { await database.close(); });
  async function person() {
    const wallet = `0x${randomUUID().replaceAll("-", "")}00000000`;
    const [user] = await db.insert(users).values({ wallet, verifiedAt: new Date(), goodidRoot: wallet }).returning();
    const [project] = await db.insert(projects).values({ ownerId: user.id, chainId: 11142220, name: "First app" }).returning();
    return { userId: user.id, projectId: project.id, wallet };
  }
  async function start(p: Awaited<ReturnType<typeof person>>, root = p.wallet) {
    return startTurn(db, { userId: p.userId, projectId: p.projectId, mode: "build", prompt: "A local game" }, ENV, identity(root));
  }
  it("never allocates the same person's first delivery twice", async () => {
    const a = await person(), b = await person();
    const results = backend.realConcurrency ? await Promise.all([start(a), start(b, a.wallet)]) : [await start(a), await start(b, a.wallet)];
    expect(results.filter((r) => "job" in r && r.job.funding === "platform")).toHaveLength(1);
    expect(await db.select().from(buildSponsorships)).toHaveLength(1);
  });
  it("counts prior-month active reservations and releases unused funding at completion", async () => {
    const a = await person(), b = await person();
    const first = await start(a);
    if (!("job" in first)) throw new Error("No first grant");
    await db.update(buildSponsorships).set({ createdAt: sql`date_trunc('month', now()) - interval '1 day'` }).where(eq(buildSponsorships.jobId, first.job.id));
    const refused = await start(b);
    expect("job" in refused && refused.job.funding).not.toBe("platform");
    await db.update(turnJobs).set({ status: "done", finishedAt: new Date() }).where(eq(turnJobs.id, first.job.id));
    const next = await start(await person());
    expect("job" in next && next.job.funding).toBe("platform");
  });
  it("reconciles duplicate usage without debiting the user or losing actual spend", async () => {
    const p = await person();
    const result = await start(p);
    if (!("job" in result)) throw new Error("No grant");
    const args = { userId: p.userId, projectId: p.projectId, jobId: result.job.id, messageId: null, funding: "platform" as const, callId: "idempotent", model: "deepseek-flash", inputTokens: 100, outputTokens: 100, cachedInputTokens: 0 };
    const first = await db.transaction((tx) => recordUsage(tx as unknown as Db, args));
    await db.transaction((tx) => recordUsage(tx as unknown as Db, args));
    expect((await db.select().from(buildSponsorships))[0].spentMicro).toBe(first.chargedMicro);
    expect(await db.select().from(usageEvents)).toHaveLength(1);
  });
  it("preserves first-delivery eligibility keys when the project is deleted", async () => {
    const p = await person();
    const grant = await start(p);
    if (!("job" in grant)) throw new Error("No grant");
    await db.update(turnJobs).set({ status: "done" }).where(eq(turnJobs.id, grant.job.id));
    await db.delete(projects).where(eq(projects.id, p.projectId));
    expect(await db.select().from(buildSponsorships)).toHaveLength(1);
    const linked = await person();
    const second = await start(linked, p.wallet);
    expect("job" in second && second.job.funding).not.toBe("platform");
  });
});
