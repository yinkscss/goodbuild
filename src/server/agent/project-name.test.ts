// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { projects, usageEvents } from "@/server/db/schema";
import { createProjectFromPrompt } from "@/server/projects";
import type { ModelClient } from "./model";
import { cleanName, nameProject, uniqueName } from "./project-name";

function replying(text: string): ModelClient {
  return {
    async *stream() {
      yield { type: "text", delta: text };
      yield { type: "usage", callId: `call-${text}`, model: "deepseek-flash", inputTokens: 50, outputTokens: 5, cachedInputTokens: 0 };
      yield { type: "done" };
    },
  } as unknown as ModelClient;
}

describe("cleanName", () => {
  it("accepts a short name and strips quotes", () => {
    expect(cleanName('"Ikeja Fan Fund".')).toBe("Ikeja Fan Fund");
    expect(cleanName("Mama's Tip & Save")).toBe("Mama's Tip & Save");
    expect(cleanName("G$ Savings Circle")).toBe("G$ Savings Circle");
  });
  it("rejects anything that isn't a name", () => {
    expect(cleanName("")).toBeNull();
    expect(cleanName("On it. G$ is an ERC-20 on Celo, so the contract takes the token")).toBeNull();
    expect(cleanName("<script>alert(1)</script>")).toBeNull();
    expect(cleanName("https://evil.example")).toBeNull();
  });
});

describe("uniqueName", () => {
  it("numbers a repeat, ignoring case", () => {
    expect(uniqueName("Tip Jar", ["Other"])).toBe("Tip Jar");
    expect(uniqueName("Tip Jar", ["tip jar", "Tip Jar 2"])).toBe("Tip Jar 3");
  });
});

describe("nameProject", () => {
  let db: Db;
  let userId: string;
  beforeEach(async () => {
    db = await createTestDb();
    userId = (await signInUser(db, { wallet: "0x7a3000000000000000000000000000000000e41c", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } })).id;
  });
  const project = async (prompt: string) => (await createProjectFromPrompt(db, userId, { prompt, network: "celo-sepolia" })).id;
  const nameOf = async (id: string) => (await db.select().from(projects).where(eq(projects.id, id)))[0].name;

  it("renames the project, keeps names unique per owner, and counts the call as usage", async () => {
    const a = await project("I would like to build a fund for my club");
    const b = await project("I would like to build a fund for my other club");
    await nameProject(db, replying("Club Fund"), { projectId: a, userId, prompt: "x" });
    await nameProject(db, replying("Club Fund"), { projectId: b, userId, prompt: "y" });
    expect(await nameOf(a)).toBe("Club Fund");
    expect(await nameOf(b)).toBe("Club Fund 2");
    expect(await db.select().from(usageEvents)).toHaveLength(1);
  });

  it("keeps the current name when the reply isn't a name", async () => {
    const a = await project("Tip jar for the coach");
    const before = await nameOf(a);
    await nameProject(db, replying("Sure! Here is a great name for your application, it is"), { projectId: a, userId, prompt: "x" });
    expect(await nameOf(a)).toBe(before);
  });
});
