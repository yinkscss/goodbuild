// @vitest-environment node
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type Db } from "@/server/db/client";

let db: Db;
let session: { user: { id: string; wallet: string } } | null = null;
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => undefined }));
vi.mock("@/server/db/client", async (original) => ({ ...(await original<typeof import("@/server/db/client")>()), getDb: async () => db }));
vi.mock("@/server/auth/http", async (original) => {
  const real = await original<typeof import("@/server/auth/http")>();
  const { AuthError } = await import("@/server/auth/errors");
  return {
    ...real,
    requireSession: async () => {
      if (!session) throw new AuthError("unauthenticated");
      return session;
    },
  };
});

import { saveFiles } from "@/server/agent/store";
import { DEFAULT_LIMITS } from "@/server/app-data/limits";
import { ownerApp, putRecord } from "@/server/app-data/store";
import { signInUser } from "@/server/auth/service";
import { appDataEmailIdentities } from "@/server/db/app-data-schema";
import { deployments } from "@/server/db/deploy-schema";
import { createProjectFromPrompt } from "@/server/projects";
import { publishApp } from "@/server/publish/service";
import { GET as adminGet } from "./admin-functions/route";
import { GET as appsGet } from "./apps/route";
import { GET as contractsGet } from "./contracts/route";
import { GET as recordsGet } from "@/app/api/projects/[id]/app-data/records/route";

const abi = [
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address", name: "" }] },
];
const RULES = JSON.stringify({ collections: { bookings: { create: "anyone", read: ["writer", "owner"] }, notes: "private" } });
const BUILT = async () => [{ path: "index.html", mime: "text/html", bytes: new TextEncoder().encode("<p>app</p>") }];
const SECRET_KEYS = /tokenHash|token_hash|codeHash|ipHash|stdJsonInput|std_json|email|sessionToken|constructorArgs|memory/i;

type U = { id: string; wallet: string };
let alice: U;
let bob: U;
let aliceProject: string;
let bobProject: string;

async function seedDeployment(user: U, projectId: string, n: number, name: string, createdAt: Date) {
  await db.insert(deployments).values({
    projectId, userId: user.id, version: 1, runId: `r${n}`, chainId: 11142220, contractName: name,
    address: `0x${n.toString(16).padStart(40, "0")}`, deployer: user.wallet.toLowerCase(), txHash: `0x${n.toString(16).padStart(64, "0")}`,
    blockNumber: n, compilerVersion: "0.8.28", evmVersion: "cancun", sourceHash: "0xSECRETHASH", abi,
    stdJsonInput: { sources: { "A.sol": { content: "SECRET SOURCE" } } }, constructorArgs: "0xSECRETARGS", createdAt,
  });
}

beforeEach(async () => {
  db = await createTestDb();
  const sign = async (): Promise<U> => {
    const u = await signInUser(db, { wallet: privateKeyToAccount(generatePrivateKey()).address, walletKind: "embedded", attestation: { ageOk: true, notUsPerson: true } });
    return { id: u.id, wallet: u.wallet };
  };
  alice = await sign();
  bob = await sign();
  const pa = await createProjectFromPrompt(db, alice.id, { prompt: "alice salon", network: "celo-sepolia" });
  const pb = await createProjectFromPrompt(db, bob.id, { prompt: "bob shop", network: "celo-sepolia" });
  aliceProject = pa.id;
  bobProject = pb.id;
  await saveFiles(db, pa.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": RULES });
  await publishApp(db, pa, "alice-salon", { build: BUILT });
  const app = (await ownerApp(db, pa.id, alice.wallet))!;
  const anon = { subject: "anon:11111111-1111-4111-8111-111111111111", signedIn: false, isOwner: false };
  await putRecord(db, app, { collection: "bookings", owner: anon.subject, key: "b1", json: JSON.stringify({ day: "Mon" }) }, DEFAULT_LIMITS, new Date(), anon);
  const w = { subject: "0x" + "a".repeat(40), signedIn: true, isOwner: false };
  await putRecord(db, app, { collection: "notes", owner: w.subject, key: "n1", json: JSON.stringify("private diary") }, DEFAULT_LIMITS, new Date(), w);
  await db.insert(appDataEmailIdentities).values({ projectId: pa.id, email: "visitor@example.com", subject: "email:33333333-3333-4333-8333-333333333333" });
  await seedDeployment(alice, aliceProject, 1, "Jar", new Date("2026-11-01"));
  await seedDeployment(alice, aliceProject, 2, "Jar", new Date("2026-11-05"));
  await seedDeployment(bob, bobProject, 3, "BobShop", new Date("2026-11-02"));
});

const routes = { apps: appsGet, contracts: contractsGet, admin: adminGet } as const;

describe("every account route", () => {
  it.each(Object.keys(routes))("%s refuses anyone signed out", async (key) => {
    session = null;
    expect((await routes[key as keyof typeof routes]()).status).toBe(401);
  });

  it("shows each user only their own rows", async () => {
    session = { user: alice };
    const apps = JSON.stringify(await (await appsGet()).json());
    const contracts = JSON.stringify(await (await contractsGet()).json());
    const admin = JSON.stringify(await (await adminGet()).json());
    for (const body of [apps, contracts, admin]) {
      expect(body).not.toContain("BobShop");
      expect(body).not.toContain(bobProject);
      expect(body).not.toContain(bob.wallet);
    }
    session = { user: bob };
    for (const res of [await appsGet(), await contractsGet(), await adminGet()]) {
      const body = JSON.stringify(await res.json());
      expect(body).not.toContain(aliceProject);
      expect(body).not.toContain("alice");
    }
  });

  it("returns nothing for a user with no projects", async () => {
    const carol = await signInUser(db, { wallet: privateKeyToAccount(generatePrivateKey()).address, walletKind: "embedded", attestation: { ageOk: true, notUsPerson: true } });
    session = { user: { id: carol.id, wallet: carol.wallet } };
    expect(await (await appsGet()).json()).toEqual({ apps: [] });
    expect(await (await contractsGet()).json()).toEqual({ contracts: [] });
  });

  it("does not trust a deployment row whose user differs from the project owner", async () => {
    await seedDeployment(bob, aliceProject, 9, "Planted", new Date("2026-11-06"));
    session = { user: alice };
    expect(JSON.stringify(await (await contractsGet()).json())).not.toContain("Planted");
    session = { user: bob };
    expect(JSON.stringify(await (await contractsGet()).json())).not.toContain("Planted");
  });
});

describe("what the responses contain", () => {
  it("marks the newest deploy Live and the older one Replaced, with the project totals", async () => {
    session = { user: alice };
    const { contracts } = (await (await contractsGet()).json()) as { contracts: Array<{ live: boolean; createdAt: string }> };
    expect(contracts.map((c) => c.live)).toEqual([true, false]);
    const { apps } = (await (await appsGet()).json()) as { apps: Array<{ slug: string; live: boolean; contracts: number; dataRecords: number }> };
    expect(apps[0]).toMatchObject({ slug: "alice-salon", live: true, contracts: 1, dataRecords: 2 });
  });

  it("lists admin functions of live contracts only", async () => {
    session = { user: alice };
    const { contracts } = (await (await adminGet()).json()) as { contracts: Array<{ hasOwner: boolean; functions: Array<{ name: string }> }> };
    expect(contracts).toHaveLength(1);
    expect(contracts[0].hasOwner).toBe(true);
    expect(contracts[0].functions.map((f) => f.name)).toEqual(["pause"]);
  });

  it("never carries hashes, tokens, emails, stored source or constructor arguments", async () => {
    session = { user: alice };
    for (const res of [await appsGet(), await contractsGet(), await adminGet()]) {
      const text = JSON.stringify(await res.json());
      expect(text).not.toMatch(SECRET_KEYS);
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain("visitor@example.com");
    }
  });
});

describe("the Data tab's records route", () => {
  const call = (id: string, query = "") => recordsGet(new Request(`http://localhost:3000/api/projects/${id}/app-data/records${query}`), { params: Promise.resolve({ id }) } as never);

  it("refuses another user's project", async () => {
    session = { user: bob };
    expect((await call(aliceProject)).status).toBe(404);
  });

  it("hides private collections and visitor emails from the owner", async () => {
    session = { user: alice };
    const text = JSON.stringify(await (await call(aliceProject, "?collection=notes")).json());
    expect(text).not.toContain("private diary");
    expect(text).not.toContain("visitor@example.com");
    expect(text).not.toMatch(SECRET_KEYS);
  });
});
