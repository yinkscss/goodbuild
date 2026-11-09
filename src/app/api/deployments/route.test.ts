// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { createProjectFromPrompt } from "@/server/projects";

let db: Db;
let session: { user: { id: string; wallet: string }; chainId: number } | null;

vi.mock("@/server/auth/http", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireSession: async () => {
      if (!session) throw Object.assign(new Error("unauthenticated"), { status: 401 });
      return session;
    },
    errorResponse: (e: unknown) => NextResponse.json({ error: String(e) }, { status: (e as { status?: number }).status ?? 500 }),
  };
});
vi.mock("@/server/db/client", async (orig) => ({ ...(await orig<typeof import("@/server/db/client")>()), getDb: async () => db }));

const A = "0x7a3000000000000000000000000000000000e41c";
const B = "0xabcdef0000000000000000000000000000000002";

async function seed(userId: string, projectId: string, n: number, extra: Partial<typeof deployments.$inferInsert> = {}) {
  await db.insert(deployments).values({
    projectId,
    userId,
    version: 1,
    runId: `run-${n}-${projectId}`,
    chainId: 11142220,
    contractName: `C${n}`,
    address: `0x${n.toString(16).padStart(40, "0")}`,
    deployer: A,
    txHash: `0x${n.toString(16).padStart(64, "0")}`,
    blockNumber: n,
    compilerVersion: "0.8.28",
    evmVersion: "cancun",
    sourceHash: "0x00",
    abi: [],
    ...extra,
  });
}

beforeEach(async () => {
  db = await createTestDb();
  session = null;
});

describe("GET /api/deployments", () => {
  it("rejects a signed-out caller", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns only the caller's deployments, with the project name and verify status", async () => {
    const a = await signInUser(db, { wallet: A, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    const b = await signInUser(db, { wallet: B, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    const pa = await createProjectFromPrompt(db, a.id, { prompt: "a tip jar", network: "celo-sepolia" });
    const pb = await createProjectFromPrompt(db, b.id, { prompt: "someone else", network: "celo-sepolia" });
    await seed(a.id, pa.id, 1, { verifyStatus: "verified", verifyProvider: "sourcify" });
    await seed(a.id, pa.id, 2);
    await seed(b.id, pb.id, 3);

    session = { user: { id: a.id, wallet: A }, chainId: 11142220 };
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deployments: { contractName: string; projectId: string; projectName: string; verifyStatus: string }[] };
    expect(body.deployments.map((d) => d.contractName).sort()).toEqual(["C1", "C2"]);
    expect(body.deployments.every((d) => d.projectId === pa.id && d.projectName === pa.name)).toBe(true);
    expect(body.deployments.find((d) => d.contractName === "C1")?.verifyStatus).toBe("verified");
    expect(JSON.stringify(body)).not.toContain("C3");
  });

  it("returns an empty list for a user with no deployments", async () => {
    const a = await signInUser(db, { wallet: A, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    session = { user: { id: a.id, wallet: A }, chainId: 11142220 };
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toEqual({ deployments: [] });
  });
});
