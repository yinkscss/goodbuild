// @vitest-environment node
/**
 * The attacker's suite for the dealer (D141): a dealt hand or role is read by its player alone. Not by
 * other players, not by the host who asked for the deal, not by the app's owner, and not through any
 * lookup, filter, order or "since" query. Same harness as attack.test.ts: real proxy, real handler.
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
import { appDataDeals, appDataRecords } from "@/server/db/app-data-schema";
import type { Project } from "@/server/db/schema";
import { createProjectFromPrompt } from "@/server/projects";
import { publishApp } from "@/server/publish/service";
import { proxy } from "@/proxy";
import { APP_SESSION_COOKIE, createRateLimiter, handleAppData, type AppDataDeps } from "./handler";
import { ownerApp, ownerCollections, ownerRecords } from "./store";
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



const GAME = JSON.stringify({ collections: { hands: "dealt", rooms: "public-read", notes: "private" } });
const ROLES = ["saboteur", "crew", "crew", "crew", "crew", "medic"];
const DECK = Array.from({ length: 52 }, (_, i) => "c" + i);

let game: Project;
let ownerAccount: PrivateKeyAccount;
let host: PrivateKeyAccount;
let players: PrivateKeyAccount[];
let hostX: string;
let ownerX: string;
let cookies: string[];

type Rec = { key: string; owner: string | null; value: { deal?: string; room?: string; items?: string[] } };
type Receipt = { id: string; room: string; host: string; players: string[]; hands: number[]; drawn: number[]; stock: number };
const recs = async (res: Response) => ((await res.json()) as { records: Rec[] }).records;
const post = (cookie: string | undefined, path: string, json: unknown, ip = "203.0.113.1") => call(X, "POST", `${V1}/${path}`, { cookie, headers: { ...page(X), "cf-connecting-ip": ip }, json });
const wallets = () => players.map((p) => p.address.toLowerCase());

async function dealt(json: Record<string, unknown> = {}): Promise<Receipt> {
  const res = await post(hostX, "deal/hands", { room: "ABCDE", players: wallets(), deck: ROLES, hand: 1, ...json });
  expect(res.status).toBe(200);
  return (await res.json()) as Receipt;
}

/** Everything a viewer can get out of the dealt collection, by every route and query the API has. */
async function everythingSeenBy(cookie: string | undefined, deal: Receipt): Promise<Rec[]> {
  const seen: Rec[] = [];
  const paths = [
    "c/hands",
    "c/hands?limit=100",
    "c/hands?order=createdAt&dir=asc",
    "c/hands?order=items",
    "c/hands?since=0",
    `c/hands?where=deal~eq~${encodeURIComponent(JSON.stringify(deal.id))}`,
    `c/hands?where=room~eq~${encodeURIComponent(JSON.stringify("ABCDE"))}`,
    `c/hands?where=items~ne~${encodeURIComponent(JSON.stringify("x"))}`,
    ...wallets().flatMap((w) => [`c/hands?owner=${w}`, `c/hands?owner=${w}&since=0`, `c/hands?owner=${w}&where=deal~eq~${encodeURIComponent(JSON.stringify(deal.id))}`]),
  ];
  for (const path of paths) {
    const res = await get(X, cookie, path);
    if (res.status === 200) seen.push(...(await recs(res)));
  }
  for (const w of wallets()) {
    const res = await get(X, cookie, `c/hands/${deal.id}?owner=${w}`);
    if (res.status === 200) seen.push((await res.json()) as Rec);
  }
  return seen;
}

beforeEach(async () => {
  vi.unstubAllEnvs();
  db = await createTestDb();
  limits = { ...DEFAULT_LIMITS };
  deps = { limits, rate: createRateLimiter(), verifyContractSignature: async () => false };
  ownerAccount = privateKeyToAccount(generatePrivateKey());
  const owner = await signInUser(db, { wallet: ownerAccount.address, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  ownerId = owner.id;
  game = await publishedProject("x-app", GAME);
  host = privateKeyToAccount(generatePrivateKey());
  players = Array.from({ length: 4 }, () => privateKeyToAccount(generatePrivateKey()));
  hostX = await signIn(host, X);
  ownerX = await signIn(ownerAccount, X);
  cookies = [];
  for (const p of players) cookies.push(await signIn(p, X));
});

describe("dealing", () => {
  it("gives every player their share, keeps the rest as the stock, and tells the host only the counts", async () => {
    const deal = await dealt();
    expect(deal).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), room: "ABCDE", host: host.address.toLowerCase(), players: wallets(), hands: [1, 1, 1, 1], drawn: [0, 0, 0, 0], stock: 2 });
    expect(JSON.stringify(deal)).not.toMatch(/saboteur|crew|medic/);
    const hands: string[] = [];
    for (const cookie of cookies) {
      const mine = await recs(await get(X, cookie, "c/hands"));
      expect(mine).toHaveLength(1);
      expect(mine[0].key).toBe(deal.id);
      expect(mine[0].value.items).toHaveLength(1);
      hands.push(...mine[0].value.items!);
    }
    // The hands and the stock are the deck, each item once.
    const [row] = await db.select().from(appDataDeals).where(eq(appDataDeals.id, deal.id));
    expect([...hands, ...row.stock].sort()).toEqual([...ROLES].sort());
  });

  it("shuffles: the same deck doesn't come out the same way", async () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const deal = await dealt({ deck: DECK, hand: 5 });
      const mine = await recs(await get(X, cookies[0], `c/hands?where=deal~eq~${encodeURIComponent(JSON.stringify(deal.id))}`));
      firsts.add(mine[0].value.items!.join(","));
    }
    expect(firsts.size).toBe(12);
  });

  it("refuses a deal for a collection that isn't dealt, and a deal that doesn't add up", async () => {
    expect((await post(hostX, "deal/rooms", { room: "A", players: wallets(), deck: ROLES, hand: 1 })).status).toBe(400);
    expect((await post(hostX, "deal/hands", { room: "A", players: wallets(), deck: ROLES, hand: 2 })).status).toBe(400);
    expect((await post(hostX, "deal/hands", { room: "A", players: [wallets()[0]], deck: ROLES, hand: 1 })).status).toBe(400);
    expect((await post(hostX, "deal/hands", { room: "A", players: [wallets()[0], wallets()[0]], deck: ROLES, hand: 1 })).status).toBe(400);
    expect((await post(hostX, "deal/hands", { room: "A", players: ["not-a-wallet", wallets()[0]], deck: ROLES, hand: 1 })).status).toBe(400);
    expect((await post(hostX, "deal/hands", { room: "A", players: wallets(), deck: ["<b>", 5], hand: 1 })).status).toBe(400);
    expect((await post(hostX, "deal/hands", { room: "A", players: wallets(), deck: Array(121).fill("x"), hand: 1 })).status).toBe(400);
  });

  it("needs a wallet sign-in, from the app's own page", async () => {
    expect((await post(undefined, "deal/hands", { room: "A", players: wallets(), deck: ROLES, hand: 1 })).status).toBe(401);
    const foreign = await call(X, "POST", `${V1}/deal/hands`, { cookie: hostX, headers: { origin: "http://y-app.localhost:3000", "sec-fetch-site": "same-site" }, json: { room: "A", players: wallets(), deck: ROLES, hand: 1 } });
    expect(foreign.status).toBe(403);
  });
});

describe("who can read a dealt hand", () => {
  it("only its player: never another player, by any lookup, filter, order or since", async () => {
    const deal = await dealt();
    for (const [i, cookie] of cookies.entries()) {
      const seen = await everythingSeenBy(cookie, deal);
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen.map((r) => r.owner))).toEqual(new Set([wallets()[i]]));
    }
  });

  it("never the host who asked for the deal, nor the app's owner, nor someone not signed in", async () => {
    const deal = await dealt();
    for (const cookie of [hostX, ownerX, undefined]) expect(await everythingSeenBy(cookie, deal)).toEqual([]);
    // Nor the owner's Backend window inside GoodBuild.
    const app = (await ownerApp(db, game.id, ownerAccount.address))!;
    expect(ownerCollections(app)).not.toContain("hands");
    expect((await ownerRecords(db, app, "hands", { limit: 100 })).records).toEqual([]);
  });

  it("not even the host when the host also plays: they see their own share only", async () => {
    const deal = await dealt({ players: [host.address.toLowerCase(), ...wallets().slice(0, 3)] });
    const seen = await recs(await get(X, hostX, "c/hands?since=0"));
    expect(seen.map((r) => r.owner)).toEqual([host.address.toLowerCase()]);
    expect(seen[0].key).toBe(deal.id);
  });
});

describe("nobody writes a dealt collection but the dealer", () => {
  it("refuses a player adding, replacing or deleting a hand, and the app's owner too", async () => {
    const deal = await dealt();
    for (const cookie of [cookies[0], ownerX, hostX]) {
      expect((await put(X, cookie, "hands", deal.id, { deal: deal.id, items: ["medic"] })).status).toBe(403);
      expect((await put(X, cookie, "hands", "mine", { items: ["saboteur"] })).status).toBe(403);
      expect((await post(cookie, "c/hands", { value: { items: ["saboteur"] } })).status).toBe(403);
    }
    expect(await errorCode(await put(X, cookies[0], "hands", deal.id, { items: ["medic"] }))).toBe("forbidden");
    expect((await call(X, "DELETE", `${V1}/c/hands/${deal.id}`, { cookie: cookies[0], headers: page(X) })).status).toBe(403);
    expect((await call(X, "DELETE", `${V1}/c/hands/${deal.id}?owner=${wallets()[0]}`, { cookie: ownerX, headers: page(X) })).status).toBe(403);
    const mine = await recs(await get(X, cookies[0], "c/hands"));
    expect(mine).toHaveLength(1);
    expect(mine[0].value.deal).toBe(deal.id);
  });
});

describe("the receipt and drawing", () => {
  it("shows the deal to its host and players only, with counts and no items", async () => {
    const deal = await dealt();
    for (const cookie of [hostX, cookies[2]]) {
      const res = await get(X, cookie, `deal/hands/${deal.id}`);
      expect(res.status).toBe(200);
      expect(JSON.stringify(await res.json())).not.toMatch(/saboteur|crew|medic/);
    }
    const outsider = await signIn(privateKeyToAccount(generatePrivateKey()), X);
    for (const cookie of [outsider, ownerX]) expect((await get(X, cookie, `deal/hands/${deal.id}`)).status).toBe(404);
    expect((await get(X, undefined, `deal/hands/${deal.id}`)).status).toBe(401);
  });

  it("lets a player draw for themselves only; the host and outsiders can't, and nobody else sees what was drawn", async () => {
    const deal = await dealt({ deck: DECK, hand: 5 });
    const res = await post(cookies[1], `deal/hands/${deal.id}/draw`, { count: 2 });
    expect(res.status).toBe(200);
    const drew = (await res.json()) as { items: string[]; deal: Receipt };
    expect(drew.items).toHaveLength(2);
    expect(drew.deal).toMatchObject({ hands: [5, 7, 5, 5], drawn: [0, 1, 0, 0], stock: 30 });
    const mine = (await recs(await get(X, cookies[1], "c/hands"))).flatMap((r) => r.value.items!);
    expect(mine).toEqual(expect.arrayContaining(drew.items));
    for (const cookie of [cookies[0], hostX, ownerX]) expect(JSON.stringify(await everythingSeenBy(cookie, deal))).not.toContain(`"${drew.items[0]}"`);
    expect((await post(hostX, `deal/hands/${deal.id}/draw`, { count: 1 })).status).toBe(404);
    expect((await post(ownerX, `deal/hands/${deal.id}/draw`, { count: 1 })).status).toBe(404);
    expect((await post(cookies[1], `deal/hands/${deal.id}/draw`, { count: 11 })).status).toBe(400);
  });

  it("never hands out the same item twice, even when players draw at once, and says when the stock is empty", async () => {
    const deal = await dealt({ deck: DECK, hand: 10 });
    const draws = await Promise.all(Array.from({ length: 16 }, (_, i) => post(cookies[i % 4], `deal/hands/${deal.id}/draw`, { count: 1 }, `203.0.113.${i + 2}`)));
    const ok = draws.filter((r) => r.status === 200);
    const items = (await Promise.all(ok.map(async (r) => ((await r.json()) as { items: string[] }).items))).flat();
    expect(items).toHaveLength(12);
    expect(new Set(items).size).toBe(12);
    expect(draws.filter((r) => r.status === 409)).toHaveLength(4);
    const all: string[] = [];
    for (const cookie of cookies) all.push(...(await recs(await get(X, cookie, "c/hands"))).flatMap((r) => r.value.items!));
    expect(all.sort()).toEqual([...DECK].sort());
  });
});

describe("deleting", () => {
  it("Delete my data removes a player's hands and a host's deals", async () => {
    const deal = await dealt();
    expect((await call(X, "DELETE", `${V1}/me`, { cookie: cookies[0], headers: page(X) })).status).toBe(200);
    expect(await db.select().from(appDataRecords).where(eq(appDataRecords.ownerWallet, wallets()[0]))).toEqual([]);
    expect((await call(X, "DELETE", `${V1}/me`, { cookie: hostX, headers: page(X) })).status).toBe(200);
    expect(await db.select().from(appDataDeals).where(eq(appDataDeals.id, deal.id))).toEqual([]);
  });
});
