// @vitest-environment node
/**
 * The attacker's suite for per-app rules (D34): forms sent without sign-in, the owner role, public
 * fields, unique values and saved grants. Same harness as attack.test.ts: real proxy, real handler.
 */
import { eq } from "drizzle-orm";
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
const get = (host: string, cookie: string | undefined, path: string) => call(host, "GET", `${V1}/${path}`, { cookie, headers: page(host) });
const errorCode = async (res: Response) => ((await res.json()) as { error: string }).error;

async function publishedProject(slug: string, rules = RULES): Promise<Project> {
  const project = await createProjectFromPrompt(db, ownerId, { prompt: slug, network: "celo-sepolia" });
  await saveFiles(db, project.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": rules });
  await publishApp(db, project, slug, { build: BUILT });
  return project;
}



const SALON = JSON.stringify({
  collections: {
    bookings: { create: "anyone", read: ["writer", "owner"], delete: ["writer", "owner"], update: [], public: ["day", "time"], fields: { name: "string", phone: "string", day: "string", time: "string" }, unique: ["day", "time"] },
    notes: "private",
    menu: { create: "owner", read: ["anyone"] },
    members: { read: ["signed-in"] },
  },
});

let salon: Project;
let ownerAccount: PrivateKeyAccount;
let alice: PrivateKeyAccount;
let aliceX: string;
let ownerX: string;

const booking = (name: string, day = "Mon", time = "10:00") => ({ name, phone: "0803 000 0000", day, time });
const add = (cookie: string | undefined, collection: string, value: unknown, ip = "203.0.113.1") =>
  call(X, "POST", `${V1}/c/${collection}`, { cookie, headers: { ...page(X), "cf-connecting-ip": ip }, json: { value } });
type Rec = { key: string; owner: string | null; value: Record<string, unknown> };
const recs = async (res: Response) => ((await res.json()) as { records: Rec[] }).records;

beforeEach(async () => {
  vi.unstubAllEnvs();
  db = await createTestDb();
  limits = { ...DEFAULT_LIMITS, anonWritesPerIpPerMinute: 1_000, anonWritesPerProjectPerMinute: 1_000 };
  deps = { limits, rate: createRateLimiter(), verifyContractSignature: async () => false };
  ownerAccount = privateKeyToAccount(generatePrivateKey());
  const owner = await signInUser(db, { wallet: ownerAccount.address, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  ownerId = owner.id;
  salon = await publishedProject("x-app", SALON);
  alice = privateKeyToAccount(generatePrivateKey());
  aliceX = await signIn(alice, X);
  ownerX = await signIn(ownerAccount, X);
});

describe("a form sent without signing in", () => {
  it("takes a booking with no wallet, and the visitor sees their own in full", async () => {
    const res = await add(undefined, "bookings", booking("Ada"));
    expect(res.status).toBe(200);
    const anon = cookieFrom(res);
    const mine = await recs(await get(X, anon, "c/bookings"));
    expect(mine).toHaveLength(1);
    expect(mine[0].value.name).toBe("Ada");
    expect(mine[0].owner).toMatch(/^anon:[0-9a-f-]{36}$/);
    // The visitor's id isn't the cookie's secret.
    expect(anon).not.toContain(mine[0].owner!.slice(5));
    expect(((await (await get(X, anon, "session")).json()) as { wallet: string | null }).wallet).toBeNull();
  });

  it("shows strangers and other visitors only the public fields, and never who booked", async () => {
    await add(undefined, "bookings", booking("Ada"));
    const other = cookieFrom(await add(undefined, "bookings", booking("Bola", "Tue")));
    for (const cookie of [undefined, aliceX, other]) {
      const seen = await recs(await get(X, cookie, "c/bookings"));
      const ada = seen.find((r) => r.value.day === "Mon")!;
      expect(ada).toEqual(expect.objectContaining({ owner: null, value: { day: "Mon", time: "10:00" } }));
    }
  });

  it("lets the owner read every booking in full, on the app itself", async () => {
    await add(undefined, "bookings", booking("Ada"));
    const seen = await recs(await get(X, ownerX, "c/bookings"));
    expect(seen[0].value).toEqual(booking("Ada"));
    expect(seen[0].owner).toMatch(/^anon:/);
    expect(((await (await get(X, ownerX, "session")).json()) as { owner: boolean }).owner).toBe(true);
    expect(((await (await get(X, aliceX, "session")).json()) as { owner: boolean }).owner).toBe(false);
  });

  it("doesn't let the owner filter or a direct lookup reveal who booked", async () => {
    await add(undefined, "bookings", booking("Ada"));
    const [full] = await recs(await get(X, ownerX, "c/bookings"));
    expect(await recs(await get(X, aliceX, `c/bookings?owner=${full.owner}`))).toEqual([]);
    expect((await get(X, aliceX, `c/bookings/${full.key}?owner=${full.owner}`)).status).toBe(404);
    expect((await get(X, undefined, `c/bookings/${full.key}?owner=${full.owner}`)).status).toBe(404);
    expect((await get(X, ownerX, `c/bookings/${full.key}?owner=${full.owner}`)).status).toBe(200);
  });

  it("refuses a second booking of the same slot, even when both arrive at once", async () => {
    expect((await add(undefined, "bookings", booking("Ada"))).status).toBe(200);
    const again = await add(undefined, "bookings", booking("Bola"));
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe("duplicate");
    const both = await Promise.all([add(undefined, "bookings", booking("C", "Wed")), add(undefined, "bookings", booking("D", "Wed"))]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("refuses fields the rule doesn't name, and wrong types", async () => {
    expect((await add(undefined, "bookings", { ...booking("Ada"), admin: true })).status).toBe(400);
    expect((await add(undefined, "bookings", { ...booking("Ada"), phone: 803 })).status).toBe(400);
    expect((await add(undefined, "bookings", "just text")).status).toBe(400);
  });

  it("can't be edited once sent, when the rule says update: []", async () => {
    const res = await add(undefined, "bookings", booking("Ada"));
    const anon = cookieFrom(res);
    const { key } = (await res.json()) as { key: string };
    expect((await put(X, anon, "bookings", key, booking("Ada", "Fri"))).status).toBe(403);
  });

  it("caps entries from visitors who didn't sign in, below the app's total", async () => {
    limits.maxAnonRowsPerProject = 2;
    expect((await add(undefined, "bookings", booking("A", "Mon"))).status).toBe(200);
    expect((await add(undefined, "bookings", booking("B", "Tue"))).status).toBe(200);
    const full = await add(undefined, "bookings", booking("C", "Wed"));
    expect(full.status).toBe(507);
    expect(await errorCode(full)).toBe("anon_quota_exceeded");
    // A signed-in member can still save their own things.
    expect((await put(X, aliceX, "notes", "k", "mine")).status).toBe(200);
  });

  it("rate-limits anonymous writes per IP", async () => {
    limits.anonWritesPerIpPerMinute = 2;
    expect((await add(undefined, "bookings", booking("A", "Mon"), "198.51.100.9")).status).toBe(200);
    expect((await add(undefined, "bookings", booking("B", "Tue"), "198.51.100.9")).status).toBe(200);
    expect((await add(undefined, "bookings", booking("C", "Wed"), "198.51.100.9")).status).toBe(429);
    expect((await add(undefined, "bookings", booking("D", "Thu"), "198.51.100.10")).status).toBe(200);
  });
});

describe("roles", () => {
  it("an anonymous visitor isn't signed in", async () => {
    const anon = cookieFrom(await add(undefined, "bookings", booking("Ada")));
    expect((await put(X, anon, "notes", "k", "x")).status).toBe(401);
    expect((await put(X, anon, "members", "k", "x")).status).toBe(401);
    expect((await get(X, anon, "c/members")).status).toBe(200);
    expect(await recs(await get(X, anon, "c/members"))).toEqual([]);
  });

  it("signed-in readers see each other's records, visitors without sign-in don't", async () => {
    await put(X, aliceX, "members", "me", { name: "Alice" });
    const bobX = await signIn(privateKeyToAccount(generatePrivateKey()), X);
    expect((await recs(await get(X, bobX, "c/members")))[0].value).toEqual({ name: "Alice" });
    expect((await get(X, undefined, "c/members")).status).toBe(401);
  });

  it("only the owner adds to an owner-only collection", async () => {
    expect((await add(aliceX, "menu", { dish: "jollof" })).status).toBe(403);
    expect((await add(undefined, "menu", { dish: "jollof" })).status).toBe(401);
    expect((await add(ownerX, "menu", { dish: "jollof" })).status).toBe(200);
    expect((await recs(await get(X, undefined, "c/menu")))[0].value).toEqual({ dish: "jollof" });
  });

  it("lets the owner delete a visitor's booking, and no one else", async () => {
    await add(undefined, "bookings", booking("Ada"));
    const [full] = await recs(await get(X, ownerX, "c/bookings"));
    expect((await call(X, "DELETE", `${V1}/c/bookings/${full.key}?owner=${full.owner}`, { cookie: aliceX, headers: page(X) })).status).toBe(404);
    expect(await recs(await get(X, ownerX, "c/bookings"))).toHaveLength(1);
    expect((await call(X, "DELETE", `${V1}/c/bookings/${full.key}?owner=${full.owner}`, { cookie: ownerX, headers: page(X) })).status).toBe(200);
    expect(await recs(await get(X, ownerX, "c/bookings"))).toEqual([]);
  });

  it("the owner of another app is nobody here", async () => {
    const strangerAccount = privateKeyToAccount(generatePrivateKey());
    const stranger = await signInUser(db, { wallet: strangerAccount.address, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    const theirs = await createProjectFromPrompt(db, stranger.id, { prompt: "y", network: "celo-sepolia" });
    await saveFiles(db, theirs.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": SALON });
    await publishApp(db, theirs, "y-app", { build: BUILT });
    await add(undefined, "bookings", booking("Ada"));
    const strangerX = await signIn(strangerAccount, X);
    expect((await recs(await get(X, strangerX, "c/bookings")))[0].owner).toBeNull();
  });
});

describe("saved grants", () => {
  it("loosening a rule doesn't expose what was saved under the tighter one", async () => {
    await put(X, aliceX, "notes", "old", { text: "private diary" });
    const open = JSON.stringify({ collections: { ...JSON.parse(SALON).collections, notes: { read: ["anyone", "owner"] } } });
    await saveFiles(db, salon.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": open });
    await publishApp(db, salon, "x-app", { build: BUILT });
    expect(await recs(await get(X, undefined, "c/notes"))).toEqual([]);
    expect(await recs(await get(X, ownerX, "c/notes"))).toEqual([]);
    expect((await recs(await get(X, aliceX, "c/notes")))[0].value).toEqual({ text: "private diary" });
    await put(X, aliceX, "notes", "new", { text: "meant for everyone" });
    expect((await recs(await get(X, undefined, "c/notes"))).map((r) => r.key)).toEqual(["new"]);
  });

  it("records from before per-app rules stay with their writer, even where the owner now reads", async () => {
    await put(X, aliceX, "bookings-old", "k", { text: "x" });
    await db.update(appDataRecords).set({ access: null, isPublic: false }).where(eq(appDataRecords.collection, "bookings-old"));
    const later = JSON.stringify({ collections: { ...JSON.parse(SALON).collections, "bookings-old": { read: ["writer", "owner"] } } });
    await saveFiles(db, salon.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": later });
    await publishApp(db, salon, "x-app", { build: BUILT });
    expect(await recs(await get(X, ownerX, "c/bookings-old"))).toEqual([]);
    expect(await recs(await get(X, aliceX, "c/bookings-old"))).toHaveLength(1);
  });

  it("a stricter rule applies to existing records at once", async () => {
    await add(undefined, "bookings", booking("Ada"));
    const strict = JSON.stringify({ collections: { ...JSON.parse(SALON).collections, bookings: { create: "anyone", read: ["writer"] } } });
    await saveFiles(db, salon.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": strict });
    await publishApp(db, salon, "x-app", { build: BUILT });
    expect(await recs(await get(X, ownerX, "c/bookings"))).toEqual([]);
    expect((await get(X, undefined, "c/bookings")).status).toBe(401);
  });
});
