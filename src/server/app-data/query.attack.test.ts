// @vitest-environment node
/**
 * The attacker's suite for queries (D78): filters, order and "changed since" on a list. The rule
 * under test: a query only ever compares what the viewer is allowed to see. Same harness as
 * rules.attack.test.ts: real proxy, real handler, real signatures.
 */
import { NextRequest } from "next/server";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { celoSepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signInUser } from "@/server/auth/service";
import { saveFiles } from "@/server/agent/store";
import { createTestDb, type Db } from "@/server/db/client";
import { appDataRecords } from "@/server/db/app-data-schema";
import type { Project } from "@/server/db/schema";
import { createProjectFromPrompt } from "@/server/projects";
import { publishApp } from "@/server/publish/service";
import { proxy } from "@/proxy";
import { APP_SESSION_COOKIE, createRateLimiter, handleAppData, type AppDataDeps } from "./handler";
import { DEFAULT_LIMITS, type AppDataLimits } from "./limits";

const BUILT = async () => [{ path: "index.html", mime: "text/html", bytes: new TextEncoder().encode("<p>app</p>") }];
const RULES = JSON.stringify({ collections: { posts: "public-read", notes: "private" } });

let db: Db;
let ownerId: string;
let deps: AppDataDeps;
let limits: AppDataLimits;

const X = "x-app.localhost:3000";
const V1 = "/__gb/data/v1";

interface CallOptions {
  cookie?: string;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
}

/** A request as a browser or script would send it: proxy first, then wherever the proxy points it. */
async function call(host: string, method: string, path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { host, ...options.headers };
  if (options.cookie) headers.cookie = options.cookie;
  let body: string | undefined = options.body;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers["content-type"] ??= "application/json";
  }
  const request = new NextRequest(`http://${host}${path}`, { method, headers, body });
  const res = proxy(request);
  const rewrite = res.headers.get("x-middleware-rewrite");
  if (!rewrite) {
    // The proxy answered itself, or let the request through to the main site's own routes.
    return res.headers.get("x-middleware-next") ? new Response(null, { status: 299, headers: { "x-passed-to": "main-site" } }) : res;
  }
  const url = new URL(rewrite);
  const data = url.pathname.match(/^\/app-data\/([^/]+)\/(.*)$/);
  if (!data) return new Response(null, { status: 299, headers: { "x-passed-to": url.pathname } });
  const forwarded = new NextRequest(url, { method, headers, body });
  return handleAppData(db, forwarded, { slug: data[1], path: data[2].split("/").map(decodeURIComponent) }, deps);
}

/** What a same-origin page in the app adds to its requests. */
const page = (host: string) => ({ origin: `http://${host}`, "sec-fetch-site": "same-origin" });

function siwe(account: PrivateKeyAccount, host: string, nonce: string, over: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  return createSiweMessage({ address: account.address, chainId: celoSepolia.id, domain: host, uri: `http://${host}`, version: "1", nonce, issuedAt: new Date(), ...over });
}

async function nonceFor(host: string): Promise<string> {
  const res = await call(host, "GET", `${V1}/session/nonce`, { headers: page(host) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { nonce: string }).nonce;
}

function cookieFrom(res: Response): string {
  const set = res.headers.getSetCookie().find((c) => c.startsWith(`${APP_SESSION_COOKIE}=`));
  if (!set) throw new Error(`no session cookie: ${res.status}`);
  return set.split(";")[0];
}

const signInBody = async (account: PrivateKeyAccount, host: string, nonce: string) => {
  const message = siwe(account, host, nonce);
  return { message, signature: await account.signMessage({ message }) };
};

async function signIn(account: PrivateKeyAccount, host: string): Promise<string> {
  const res = await call(host, "POST", `${V1}/session`, { headers: page(host), json: await signInBody(account, host, await nonceFor(host)) });
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

const put = (host: string, cookie: string | undefined, collection: string, key: string, value: unknown) =>
  call(host, "PUT", `${V1}/c/${collection}/${key}`, { cookie, headers: page(host), json: { value } });

async function publishedProject(slug: string, rules = RULES): Promise<Project> {
  const project = await createProjectFromPrompt(db, ownerId, { prompt: slug, network: "celo-sepolia" });
  await saveFiles(db, project.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": rules });
  await publishApp(db, project, slug, { build: BUILT });
  return project;
}



const RULES_Q = JSON.stringify({
  collections: {
    bookings: { create: "anyone", read: ["writer", "owner"], public: ["day", "time"], fields: { name: "string", phone: "string", day: "string", time: "string" } },
    scores: { read: ["anyone"], fields: { player: "string", points: "number", won: "boolean" } },
    notes: "private",
  },
});

let app: Project;
let ownerAccount: PrivateKeyAccount;
let alice: PrivateKeyAccount;
let bob: PrivateKeyAccount;
let aliceX: string;
let bobX: string;
let ownerX: string;

type Rec = { key: string; owner: string | null; value: Record<string, unknown>; updatedAt: string };
type Page = { records: Rec[]; nextCursor: string | null; truncated?: boolean };
const list = async (cookie: string | undefined, collection: string, query = "", ip = "203.0.113.9") => {
  const res = await call(X, "GET", `${V1}/c/${collection}${query ? `?${query}` : ""}`, { cookie, headers: { ...page(X), "cf-connecting-ip": ip } });
  return { status: res.status, body: (await res.json()) as Page & { error?: string } };
};
const add = (cookie: string | undefined, collection: string, value: unknown) =>
  call(X, "POST", `${V1}/c/${collection}`, { cookie, headers: { ...page(X), "cf-connecting-ip": "203.0.113.1" }, json: { value } });
const q = (...pairs: Array<[string, string]>) => pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

beforeEach(async () => {
  vi.unstubAllEnvs();
  db = await createTestDb();
  limits = { ...DEFAULT_LIMITS, anonWritesPerIpPerMinute: 1_000, anonWritesPerProjectPerMinute: 1_000 };
  deps = { limits, rate: createRateLimiter(), verifyContractSignature: async () => false };
  ownerAccount = privateKeyToAccount(generatePrivateKey());
  ownerId = (await signInUser(db, { wallet: ownerAccount.address, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } })).id;
  app = await publishedProject("x-app", RULES_Q);
  alice = privateKeyToAccount(generatePrivateKey());
  bob = privateKeyToAccount(generatePrivateKey());
  aliceX = await signIn(alice, X);
  bobX = await signIn(bob, X);
  ownerX = await signIn(ownerAccount, X);
  void app;
});

describe("filters and order on a list the viewer can read", () => {
  beforeEach(async () => {
    await put(X, aliceX, "scores", "a", { player: "Ada", points: 30, won: true });
    await put(X, bobX, "scores", "b", { player: "Bayo", points: 10, won: false });
    await put(X, ownerX, "scores", "c", { player: "Chi", points: 20, won: true });
  });

  it("keeps the records that pass every condition", async () => {
    const r = await list(undefined, "scores", q(["where", 'points~gte~15'], ["where", "won~eq~true"]));
    expect(r.status).toBe(200);
    expect(r.body.records.map((x) => x.value.player).sort()).toEqual(["Ada", "Chi"]);
  });

  it("orders by a field either way, and by time", async () => {
    const asc = await list(undefined, "scores", q(["order", "points"], ["dir", "asc"]));
    expect(asc.body.records.map((x) => x.value.points)).toEqual([10, 20, 30]);
    const desc = await list(undefined, "scores", q(["order", "points"], ["dir", "desc"], ["limit", "2"]));
    expect(desc.body.records.map((x) => x.value.points)).toEqual([30, 20]);
    expect(desc.body.truncated).toBe(true);
    const byTime = await list(undefined, "scores", q(["order", "createdAt"], ["dir", "asc"]));
    expect(byTime.body.records.map((x) => x.value.player)).toEqual(["Ada", "Bayo", "Chi"]);
  });

  it("matches text as text and numbers as numbers, never across types", async () => {
    expect((await list(undefined, "scores", q(["where", "points~eq~10"]))).body.records).toHaveLength(1);
    expect((await list(undefined, "scores", q(["where", 'points~eq~"10"']))).body.records).toHaveLength(0);
    expect((await list(undefined, "scores", q(["where", "player~eq~Ada"]))).body.records).toHaveLength(1);
    expect((await list(undefined, "scores", q(["where", "won~gt~false"]))).body.records).toHaveLength(0);
  });

  it("returns only what changed after `since`, so a live app can poll cheaply", async () => {
    const all = await list(undefined, "scores");
    const newest = Math.max(...all.body.records.map((r) => Date.parse(r.updatedAt)));
    expect((await list(undefined, "scores", q(["since", String(newest)]))).body.records).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 15));
    await put(X, aliceX, "scores", "a", { player: "Ada", points: 31, won: true });
    const changed = await list(undefined, "scores", q(["since", String(newest)]));
    expect(changed.body.records.map((r) => r.value.points)).toEqual([31]);
  });
});

describe("a query never shows more than the plain list does", () => {
  beforeEach(async () => {
    await add(undefined, "bookings", { name: "Ada Obi", phone: "0803 111 1111", day: "Mon", time: "10:00" });
    await add(undefined, "bookings", { name: "Bayo", phone: "0803 222 2222", day: "Tue", time: "11:00" });
    await put(X, aliceX, "notes", "n1", { text: "alice secret" });
    await put(X, bobX, "notes", "n1", { text: "bob secret" });
  });

  it("can't filter or order by a field the viewer can't read (no guessing a hidden name or phone)", async () => {
    const guess = await list(undefined, "bookings", q(["where", "name~eq~Ada Obi"]));
    const miss = await list(undefined, "bookings", q(["where", "name~eq~Nobody"]));
    expect(guess.status).toBe(200);
    expect(guess.body.records).toEqual([]);
    expect(guess.body).toEqual(miss.body); // a hit and a miss look the same
    expect((await list(undefined, "bookings", q(["where", "phone~gte~0"]))).body.records).toEqual([]);
    const sorted = await list(undefined, "bookings", q(["order", "phone"]));
    expect(sorted.body.records.every((r) => !("phone" in r.value) && !("name" in r.value))).toBe(true);
  });

  it("filters on the public fields, and still shows only those", async () => {
    const r = await list(undefined, "bookings", q(["where", "day~eq~Mon"]));
    expect(r.body.records).toHaveLength(1);
    expect(r.body.records[0].value).toEqual({ day: "Mon", time: "10:00" });
    expect(r.body.records[0].owner).toBeNull();
  });

  it("lets the owner filter on every field, since the owner reads whole records", async () => {
    const r = await list(ownerX, "bookings", q(["where", "name~eq~Ada Obi"]));
    expect(r.body.records.map((x) => x.value.phone)).toEqual(["0803 111 1111"]);
  });

  it("keeps a private collection to its writer, with or without a query", async () => {
    const r = await list(aliceX, "notes", q(["where", "text~gte~a"], ["order", "text"]));
    expect(r.body.records.map((x) => x.value.text)).toEqual(["alice secret"]);
    expect((await list(bobX, "notes", q(["where", 'text~eq~alice secret']))).body.records).toEqual([]);
    expect((await list(undefined, "notes", q(["where", "text~eq~x"]))).status).toBe(401);
  });

  it("can't reach the owner's view of a record through since or owner", async () => {
    const r = await list(undefined, "bookings", q(["since", "0"], ["owner", alice.address]));
    expect(r.body.records).toEqual([]);
    const all = await list(undefined, "bookings", q(["since", "0"]));
    expect(all.body.records.every((x) => x.owner === null && !("name" in x.value))).toBe(true);
  });
});

describe("bad queries and abuse", () => {
  it.each([
    ["an unknown comparison", q(["where", "points~like~1"])],
    ["a bad field name", q(["where", "po ints~eq~1"])],
    ["no value", q(["where", "points~eq~"])],
    ["a value that isn't plain", q(["where", 'points~eq~{"a":1}'])],
    ["five filters", q(...Array.from({ length: 5 }, (): [string, string] => ["where", "points~eq~1"]))],
    ["a bad direction", q(["order", "points"], ["dir", "up"])],
    ["a bad order field", q(["order", "a;b"])],
    ["a bad since", q(["since", "yesterday"])],
    ["a cursor with a query", q(["where", "points~eq~1"], ["cursor", "5"])],
  ])("refuses %s with a clear error", async (_name, query) => {
    const r = await list(undefined, "scores", query);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/invalid_query|invalid_cursor/);
  });

  it("counts query reads against their own limit", async () => {
    limits.queriesPerIpPerMinute = 3;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await list(undefined, "scores", q(["order", "points"]), "198.51.100.7")).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    // A plain list from the same address still works: only queries are slowed.
    expect((await list(undefined, "scores", "", "198.51.100.7")).status).toBe(200);
  });

  it("reads no more than the newest 500 records, and says so", async () => {
    const rows = Array.from({ length: 520 }, (_, i) => ({
      projectId: app.id,
      collection: "scores",
      ownerWallet: `0x${i.toString(16).padStart(40, "0")}`,
      key: "k",
      value: JSON.stringify({ player: "P" + i, points: i, won: false }),
      isPublic: true,
      access: { read: ["anyone"], public: [] },
      sizeBytes: 40,
    }));
    await db.insert(appDataRecords).values(rows as never);
    const r = await list(undefined, "scores", q(["order", "points"], ["dir", "desc"], ["limit", "100"]));
    expect(r.status).toBe(200);
    expect(r.body.truncated).toBe(true);
    expect(r.body.records).toHaveLength(100);
    // The top score of the newest 500 records, not of all 520.
    expect(r.body.records[0].value.points).toBe(519);
  });
});
