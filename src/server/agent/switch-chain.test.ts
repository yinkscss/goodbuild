// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type Db } from "@/server/db/client";
import { messages, projects } from "@/server/db/schema";
import { signInUser } from "@/server/auth/service";
import { createProjectFromPrompt } from "@/server/projects";
import { listVersions, loadFiles, switchProjectChain } from "./store";

let db: Db;
let projectId: string;

beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: "0xabc", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  const p = await createProjectFromPrompt(db, user.id, { prompt: "A tip jar for our football club", network: "celo-sepolia" });
  projectId = p.id;
});

describe("switchProjectChain", () => {
  it("moves the project and its chain helper to mainnet as a new version, then back", async () => {
    const n = await switchProjectChain(db, projectId, 42220, "Celo mainnet");
    expect(n).toBeGreaterThan(0);
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(p.chainId).toBe(42220);
    const files = await loadFiles(db, projectId);
    expect(files["src/lib/chain.ts"]).toContain("export const chain = celo;");
    expect((await listVersions(db, projectId))[0].summary).toBe("Switched to Celo mainnet");
    const chat = await db.select().from(messages).where(eq(messages.projectId, projectId));
    expect(chat.some((m) => m.role === "system" && m.content.startsWith("Switched this project to Celo mainnet"))).toBe(true);

    expect(await switchProjectChain(db, projectId, 42220, "Celo mainnet")).toBeNull();
    await switchProjectChain(db, projectId, 11142220, "Celo Sepolia testnet");
    expect((await loadFiles(db, projectId))["src/lib/chain.ts"]).toContain("export const chain = celoSepolia;");
  });
});
