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
import { putRecord, ownerApp } from "@/server/app-data/store";
import { DEFAULT_LIMITS } from "@/server/app-data/limits";
import { signInUser } from "@/server/auth/service";
import type { Project } from "@/server/db/schema";
import { createProjectFromPrompt } from "@/server/projects";
import { publishApp } from "@/server/publish/service";
import { DELETE, GET } from "./route";

const RULES = JSON.stringify({
  collections: {
    bookings: { create: "anyone", read: ["writer", "owner"], public: ["day"], fields: { name: "string", day: "string" }, unique: ["day"] },
    notes: "private",
  },
});
const BUILT = async () => [{ path: "index.html", mime: "text/html", bytes: new TextEncoder().encode("<p>app</p>") }];

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const call = (method: "GET" | "DELETE", id: string, query = "") => (method === "GET" ? GET : DELETE)(new Request(`http://localhost:3000/api/projects/${id}/app-data/records${query}`, { method }), ctx(id));

let project: Project;
let owner: { id: string; wallet: string };
let stranger: { id: string; wallet: string };

beforeEach(async () => {
  db = await createTestDb();
  const sign = async () => {
    const u = await signInUser(db, { wallet: privateKeyToAccount(generatePrivateKey()).address, walletKind: "embedded", attestation: { ageOk: true, notUsPerson: true } });
    return { id: u.id, wallet: u.wallet };
  };
  owner = await sign();
  stranger = await sign();
  project = await createProjectFromPrompt(db, owner.id, { prompt: "salon", network: "celo-sepolia" });
  await saveFiles(db, project.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": RULES });
  await publishApp(db, project, "salon", { build: BUILT });
  const app = (await ownerApp(db, project.id, owner.wallet))!;
  const anon = { subject: "anon:11111111-1111-4111-8111-111111111111", signedIn: false, isOwner: false };
  await putRecord(db, app, { collection: "bookings", owner: anon.subject, key: "b1", json: JSON.stringify({ name: "=HYPERLINK(\"http://x\")", day: "Mon" }) }, DEFAULT_LIMITS, new Date(), anon);
  const wallet = { subject: "0x" + "a".repeat(40), signedIn: true, isOwner: false };
  await putRecord(db, app, { collection: "notes", owner: wallet.subject, key: "n1", json: JSON.stringify("private diary") }, DEFAULT_LIMITS, new Date(), wallet);
});

describe("the owner's view of what visitors sent", () => {
  it("shows the owner, signed in to GoodBuild with an email wallet, every booking in full", async () => {
    session = { user: owner };
    const res = await call("GET", project.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collections: string[]; records: Array<{ value: unknown }> };
    expect(body.collections).toEqual(["bookings"]);
    expect(body.records[0].value).toEqual({ name: '=HYPERLINK("http://x")', day: "Mon" });
  });

  it("never offers collections the owner can't read, even when asked by name", async () => {
    session = { user: owner };
    const body = (await (await call("GET", project.id, "?collection=notes")).json()) as { collection: string; records: Array<{ value: unknown }> };
    expect(body.collection).toBe("bookings");
    expect(JSON.stringify(body)).not.toContain("private diary");
  });

  it("refuses someone else's project, and anyone signed out", async () => {
    session = { user: stranger };
    expect((await call("GET", project.id)).status).toBe(404);
    expect((await call("DELETE", project.id, "?collection=bookings&owner=anon:11111111-1111-4111-8111-111111111111&key=b1")).status).toBe(404);
    session = null;
    expect((await call("GET", project.id)).status).toBe(401);
  });

  it("downloads a CSV that a spreadsheet won't run as a formula", async () => {
    session = { user: owner };
    const res = await call("GET", project.id, "?collection=bookings&format=csv");
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toBe("saved,from,name,day");
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(",visitor,");
  });

  it("lets the owner delete a spam entry", async () => {
    session = { user: owner };
    expect((await call("DELETE", project.id, "?collection=bookings&owner=anon:11111111-1111-4111-8111-111111111111&key=b1")).status).toBe(200);
    expect(((await (await call("GET", project.id)).json()) as { records: unknown[] }).records).toEqual([]);
  });
});
