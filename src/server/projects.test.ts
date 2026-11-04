// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type Db } from "@/server/db/client";
import { signInUser } from "@/server/auth/service";
import { chainIdFor, createProjectFromPrompt, getOwnedProject, listProjects, nameFromPrompt } from "./projects";
import { isBlockedRegion, countryFrom } from "./geo";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const yes = { ageOk: true, notUsPerson: true };

describe("projects", () => {
  it("creates a project with the prompt queued as the first message", async () => {
    const user = await signInUser(db, { wallet: "0x1", walletKind: "external", attestation: yes });
    const p = await createProjectFromPrompt(db, user.id, { prompt: "A tip jar for our club", network: "celo-sepolia" });
    const owned = await getOwnedProject(db, p.id, user.id);
    expect(owned?.project.chainId).toBe(11142220);
    expect(owned?.messages).toHaveLength(1);
    expect(owned?.messages[0]).toMatchObject({ role: "user", content: "A tip jar for our club", status: "queued" });
    expect(await listProjects(db, user.id)).toHaveLength(1);
  });

  it("hides projects from other users", async () => {
    const a = await signInUser(db, { wallet: "0xa", walletKind: "external", attestation: yes });
    const b = await signInUser(db, { wallet: "0xb", walletKind: "external", attestation: yes });
    const p = await createProjectFromPrompt(db, a.id, { prompt: "Mine", network: "celo-sepolia" });
    expect(await getOwnedProject(db, p.id, b.id)).toBeNull();
    expect(await getOwnedProject(db, "not-a-uuid", a.id)).toBeNull();
  });

  it("names projects from the template or the prompt", () => {
    expect(nameFromPrompt("anything", "tip-jar")).toBe("Community tip jar");
    expect(nameFromPrompt("A weekly G$ savings circle for 12 members")).toBe("Weekly G$ savings circle");
    expect(nameFromPrompt("!!!")).toBe("Untitled build");
    expect(nameFromPrompt("Ikeja FC tip jar that splits G$ 70/30")).toBe("Ikeja FC tip jar");
    expect(nameFromPrompt("Co-op grain fund: members pool G$ to buy maize")).toBe("Co-op grain fund");
    expect(nameFromPrompt("A class poll for our 400-level excursion")).toBe("Class poll");
  });

  it("only targets mainnet when the flag allows it", () => {
    expect(chainIdFor("celo", false)).toBe(11142220);
    expect(chainIdFor("celo", true)).toBe(42220);
    expect(chainIdFor("celo-sepolia", true)).toBe(11142220);
  });
});

describe("geo", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("blocks US and sanctioned regions from host headers", () => {
    expect(isBlockedRegion(h({ "x-vercel-ip-country": "US" }))).toBe(true);
    expect(isBlockedRegion(h({ "cf-ipcountry": "ir" }))).toBe(true);
    expect(isBlockedRegion(h({ "x-vercel-ip-country": "NG" }))).toBe(false);
  });
  it("does nothing without a header", () => {
    expect(isBlockedRegion(h({}))).toBe(false);
    expect(countryFrom(h({ "cf-ipcountry": "XX1" }))).toBeNull();
  });
});
