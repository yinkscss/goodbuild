// @vitest-environment node
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb } from "@/server/db/client";
import { projects, turnJobs, versions } from "@/server/db/schema";
import { publications } from "@/server/db/publish-schema";
import { deployments } from "@/server/db/deploy-schema";
import { signInUser } from "@/server/auth/service";
import { createProjectFromPrompt } from "@/server/projects";
import { errorCause, formatFunnel, funnelReport, weeksStart } from "./funnel";

const SECRET = "SECRET-PROMPT-errand app for my cousin Tunde";

describe("funnel report (D177)", () => {
  it("counts each week's projects through version, publish and deploy, and groups errors by cause without any text", async () => {
    const db = await createTestDb();
    const a = await signInUser(db, { wallet: "0xa1", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    const b = await signInUser(db, { wallet: "0xb2", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    const mk = async (owner: string, at: string) => {
      const p = await createProjectFromPrompt(db, owner, { prompt: SECRET, network: "celo-sepolia" });
      await db.update(projects).set({ createdAt: new Date(at) }).where(eq(projects.id, p.id));
      return p.id;
    };
    // Week of 16 Nov: three projects; one got a version, was published and deployed.
    const p1 = await mk(a.id, "2026-11-18T10:00:00Z");
    const p2 = await mk(a.id, "2026-11-20T10:00:00Z");
    await mk(b.id, "2026-11-22T23:00:00Z");
    // Week of 23 Nov: one project, no version.
    const p4 = await mk(b.id, "2026-11-24T08:00:00Z");
    await db.insert(versions).values({ projectId: p1, number: 1, summary: SECRET, files: { "App.tsx": SECRET } });
    await db.insert(publications).values({ projectId: p1, slug: "errand", versionNumber: 1, publishedAt: new Date("2026-11-26T00:00:00Z") });
    await db.insert(deployments).values({ projectId: p1, userId: a.id, version: 1, runId: "r", chainId: 11142220, contractName: "C", address: "0x1", deployer: "0xa1", txHash: "0xt", blockNumber: 1, compilerVersion: "0.8", evmVersion: "paris", sourceHash: "h", abi: [] });
    const job = (projectId: string, userId: string, error: string, at: string) => ({ projectId, userId, mode: "build", prompt: SECRET, userMessageId: crypto.randomUUID(), funding: "free" as const, status: "error", error: `${error} ${SECRET}`, createdAt: new Date(at) });
    await db.insert(turnJobs).values([
      job(p2, a.id, "The AI provider account is out of funds (DeepSeek, 402): Insufficient Balance", "2026-11-23T12:10:00Z"),
      job(p2, a.id, "The AI provider account is out of funds (DeepSeek, 402): Insufficient Balance", "2026-11-23T12:20:00Z"),
      job(p4, b.id, "fetch failed", "2026-11-24T09:00:00Z"),
    ]);

    const report = await funnelReport(db, { weeks: 2, now: new Date("2026-11-25T12:00:00Z") });
    expect(report.from).toBe("2026-11-16");
    expect(report.weeks).toEqual([
      { week: "2026-11-16", started: 3, gotVersion: 1, published: 1, deployed: 1 },
      { week: "2026-11-23", started: 1, gotVersion: 0, published: 0, deployed: 0 },
    ]);
    expect(report.errors).toEqual([
      { week: "2026-11-23", cause: "ai_account_empty", jobs: 2, projects: 1, people: 1 },
      { week: "2026-11-23", cause: "connection", jobs: 1, projects: 1, people: 1 },
    ]);
    const out = formatFunnel(report) + JSON.stringify(report);
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain("Tunde");
  });

  it("buckets error messages like plainError does", () => {
    expect(errorCause("This build paused because your credits ran low. What it made so far is saved.")).toBe("credits");
    expect(errorCause("The AI provider is overloaded (529)")).toBe("ai_unavailable");
    expect(errorCause("This build was stopped because it stalled. The credit set aside for it has been returned. Retry to run it again.")).toBe("stalled");
    expect(errorCause("The build failed to start. Retry to run it again.")).toBe("interrupted");
    expect(errorCause(null)).toBe("other");
  });

  it("starts the window on a Monday", () => {
    expect(weeksStart(new Date("2026-11-25T12:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-11-23");
    expect(weeksStart(new Date("2026-11-23T00:00:00Z"), 2).toISOString().slice(0, 10)).toBe("2026-11-16");
  });
});
