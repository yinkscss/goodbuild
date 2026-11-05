// @vitest-environment node
/**
 * The attacker's suite for the app data API. Written before the code, and it goes through the real
 * proxy and then the real handler, on a real (in-memory) Postgres, with real signatures.
 */
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { celoSepolia, mainnet } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE } from "@/lib/auth/cookie-names";
import { issueSession, resolveSession, signInUser } from "@/server/auth/service";
import { verifySignIn } from "@/server/auth/siwe";
import { saveFiles } from "@/server/agent/store";
import { createTestDb, type Db } from "@/server/db/client";
import { appDataNonces, appDataRecords, appDataSessions, appDataUsage } from "@/server/db/app-data-schema";
import { publications } from "@/server/db/publish-schema";
import { projects, type Project } from "@/server/db/schema";
import { createProjectFromPrompt } from "@/server/projects";
import { publishApp, unpublishApp } from "@/server/publish/service";
import { proxy } from "@/proxy";
import { APP_SESSION_COOKIE, createRateLimiter, handleAppData, type AppDataDeps } from "./handler";
import { DEFAULT_LIMITS, type AppDataLimits } from "./limits";
import { deleteProjectData, projectDataStats } from "./store";

const BUILT = async () => [{ path: "index.html", mime: "text/html", bytes: new TextEncoder().encode("<p>app</p>") }];
const RULES = JSON.stringify({ collections: { posts: "public-read", notes: "private" } });

let db: Db;
let ownerId: string;
let deps: AppDataDeps;
let limits: AppDataLimits;

const X = "x-app.localhost:3000";
const Y = "y-app.localhost:3000";
const MAIN = "localhost:3000";
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
const records = async (res: Response) => ((await res.json()) as { records: Array<{ key: string; owner: string; value: unknown }> }).records;
const errorCode = async (res: Response) => ((await res.json()) as { error: string }).error;

async function publishedProject(slug: string, rules = RULES): Promise<Project> {
  const project = await createProjectFromPrompt(db, ownerId, { prompt: slug, network: "celo-sepolia" });
  await saveFiles(db, project.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": rules });
  await publishApp(db, project, slug, { build: BUILT });
  return project;
}

const clientOf = async (projectId: string) => (await db.select({ id: publications.clientId }).from(publications).where(eq(publications.projectId, projectId)))[0].id;

let projectX: Project;
let projectY: Project;
let alice: PrivateKeyAccount;
let bob: PrivateKeyAccount;
let aliceX: string;
let bobX: string;

beforeEach(async () => {
  vi.unstubAllEnvs();
  db = await createTestDb();
  limits = { ...DEFAULT_LIMITS };
  deps = { limits, rate: createRateLimiter(), verifyContractSignature: async () => false };
  const owner = await signInUser(db, { wallet: privateKeyToAccount(generatePrivateKey()).address, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  ownerId = owner.id;
  projectX = await publishedProject("x-app");
  projectY = await publishedProject("y-app");
  alice = privateKeyToAccount(generatePrivateKey());
  bob = privateKeyToAccount(generatePrivateKey());
  aliceX = await signIn(alice, X);
  bobX = await signIn(bob, X);
});

describe("wallet A against wallet B", () => {
  beforeEach(async () => {
    expect((await put(X, bobX, "notes", "diary", { text: "bob's secret" })).status).toBe(200);
  });

  it("can't read B's private record by key or by naming B as the owner", async () => {
    expect((await get(X, aliceX, "c/notes/diary")).status).toBe(404);
    expect((await get(X, aliceX, `c/notes/diary?owner=${bob.address}`)).status).toBe(404);
    expect((await get(X, aliceX, `c/notes/diary?owner=${bob.address.toLowerCase()}`)).status).toBe(404);
  });

  it("can't list B's private records", async () => {
    expect(await records(await get(X, aliceX, "c/notes"))).toEqual([]);
    expect(await records(await get(X, aliceX, `c/notes?owner=${bob.address}`))).toEqual([]);
  });

  it("can't read private records without signing in at all", async () => {
    expect((await get(X, undefined, "c/notes")).status).toBe(401);
    expect((await get(X, undefined, `c/notes/diary?owner=${bob.address}`)).status).toBe(401);
  });

  it("writing the same key makes A's own record and leaves B's alone", async () => {
    expect((await put(X, aliceX, "notes", "diary", "alice wrote this")).status).toBe(200);
    const [bobs] = await records(await get(X, bobX, "c/notes"));
    expect(bobs.value).toEqual({ text: "bob's secret" });
  });

  it("can't choose the owner of a write through the body, the query or a header", async () => {
    const res = await call(X, "PUT", `${V1}/c/notes/forged?owner=${bob.address}`, {
      cookie: aliceX,
      headers: { ...page(X), "x-wallet": bob.address },
      json: { value: "forged", owner: bob.address, ownerWallet: bob.address, wallet: bob.address },
    });
    expect(((await res.json()) as { owner: string }).owner).toBe(alice.address.toLowerCase());
    expect((await get(X, bobX, "c/notes/forged")).status).toBe(404);
  });

  it("can't delete B's record", async () => {
    expect((await call(X, "DELETE", `${V1}/c/notes/diary?owner=${bob.address}`, { cookie: aliceX, headers: page(X) })).status).toBe(404);
    expect((await get(X, bobX, "c/notes/diary")).status).toBe(200);
  });

  it("in a public collection can read B's record but not change or delete it", async () => {
    expect((await put(X, bobX, "posts", "hello", "from bob")).status).toBe(200);
    expect(((await (await get(X, undefined, `c/posts/hello?owner=${bob.address}`)).json()) as { value: string }).value).toBe("from bob");

    expect((await put(X, aliceX, "posts", "hello", "from alice")).status).toBe(200);
    expect((await call(X, "DELETE", `${V1}/c/posts/hello?owner=${bob.address}`, { cookie: aliceX, headers: page(X) })).status).toBe(200); // removes Alice's own
    expect(((await (await get(X, undefined, `c/posts/hello?owner=${bob.address}`)).json()) as { value: string }).value).toBe("from bob");
  });

  it("can't reach another wallet with no session on a public collection", async () => {
    expect((await put(X, undefined, "posts", "anon", "x")).status).toBe(401);
    expect((await call(X, "POST", `${V1}/c/posts`, { headers: page(X), json: { value: "x" } })).status).toBe(401);
  });

  it("erasing my data touches only mine", async () => {
    expect((await put(X, aliceX, "notes", "mine", "x")).status).toBe(200);
    expect((await call(X, "DELETE", `${V1}/me`, { cookie: aliceX, headers: page(X) })).status).toBe(200);
    expect((await get(X, aliceX, "session").then((r) => r.json()) as { wallet: string | null }).wallet).toBeNull();
    expect((await get(X, bobX, "c/notes/diary")).status).toBe(200);
    const left = await db.select().from(appDataRecords).where(eq(appDataRecords.ownerWallet, alice.address.toLowerCase()));
    expect(left).toEqual([]);
  });
});

describe("app X against app Y", () => {
  let aliceY: string;
  beforeEach(async () => {
    aliceY = await signIn(alice, Y);
    expect((await put(Y, aliceY, "notes", "only-in-y", "y data")).status).toBe(200);
    expect((await put(Y, aliceY, "posts", "public-in-y", "y public")).status).toBe(200);
  });

  it("the same wallet has separate data in each app", async () => {
    expect((await get(X, aliceX, "c/notes/only-in-y")).status).toBe(404);
    expect(await records(await get(X, aliceX, "c/posts"))).toEqual([]);
    expect(await records(await get(X, undefined, "c/posts"))).toEqual([]);
  });

  it("a session cookie from X means nothing on Y", async () => {
    expect((await get(Y, aliceX, "c/notes")).status).toBe(401);
    expect((await put(Y, aliceX, "notes", "planted", "x")).status).toBe(401);
    expect(((await (await get(Y, aliceX, "session")).json()) as { wallet: string | null }).wallet).toBeNull();
  });

  it("forged project and client ids get nothing", async () => {
    const clientY = await clientOf(projectY.id);
    const forged = await call(X, "GET", `${V1}/c/notes?projectId=${projectY.id}&project_id=${projectY.id}&clientId=${clientY}`, {
      cookie: aliceX,
      headers: { ...page(X), "x-gb-project": projectY.id },
    });
    expect(await records(forged)).toEqual([]);

    const res = await call(X, "GET", `${V1}/c/notes`, { cookie: aliceX, headers: { ...page(X), "x-gb-client": clientY } });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("client_mismatch");

    expect((await call(X, "PUT", `${V1}/c/notes/k`, { cookie: aliceX, headers: { ...page(X), "x-gb-client": clientY }, json: { value: 1, projectId: projectY.id } })).status).toBe(403);
    const inY = await db.select().from(appDataRecords).where(and(eq(appDataRecords.projectId, projectY.id), eq(appDataRecords.key, "k")));
    expect(inY).toEqual([]);
  });

  it("a correct client id alone gives no access", async () => {
    const res = await call(X, "GET", `${V1}/c/notes`, { headers: { ...page(X), "x-gb-client": await clientOf(projectX.id) } });
    expect(res.status).toBe(401);
  });

  it("the path can't name another app: the host decides", async () => {
    const res = await call(X, "GET", `/__gb/data/../../app-data/y-app/v1/c/posts`, { headers: page(X) });
    expect(res.status).not.toBe(200);
    expect((await call(X, "GET", `${V1}/%2e%2e/%2e%2e/%2e%2e/app-data/y-app/v1/c/posts`, { headers: page(X) })).status).not.toBe(200);
    expect((await call(X, "GET", `${V1}/c/..%2F..%2Fy-app/x`, { headers: page(X) })).status).not.toBe(200);
  });

  it("the route refuses a slug that isn't the host's, even if the proxy is skipped", async () => {
    const request = new NextRequest(`http://${X}/app-data/y-app/v1/c/posts`, { headers: { host: X } });
    expect((await handleAppData(db, request, { slug: "y-app", path: ["v1", "c", "posts"] }, deps)).status).toBe(404);
  });

  it("a slug given up and taken by another project doesn't inherit data or sessions", async () => {
    await db.update(publications).set({ slug: "z-app" }).where(eq(publications.projectId, projectY.id));
    const taker = await publishedProject("y-app");
    expect(taker.id).not.toBe(projectY.id);
    expect((await get(Y, aliceY, "c/notes")).status).toBe(401);
    expect(await records(await get(Y, undefined, "c/posts"))).toEqual([]);
  });
});

describe("sign-in", () => {
  it("a nonce works once: replaying message and signature fails", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const body = await signInBody(carol, X, await nonceFor(X));
    expect((await call(X, "POST", `${V1}/session`, { headers: page(X), json: body })).status).toBe(200);
    const replay = await call(X, "POST", `${V1}/session`, { headers: page(X), json: body });
    expect(replay.status).toBe(401);
    expect(replay.headers.getSetCookie()).toEqual([]);
  });

  it("two simultaneous uses of one nonce give one session", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const body = await signInBody(carol, X, await nonceFor(X));
    const results = await Promise.all([1, 2, 3].map(() => call(X, "POST", `${V1}/session`, { headers: page(X), json: body })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401]);
  });

  it("a nonce the server never issued is refused", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const res = await call(X, "POST", `${V1}/session`, { headers: page(X), json: await signInBody(carol, X, "abcdefgh12345678") });
    expect(res.status).toBe(401);
  });

  it("an expired nonce is refused", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const nonce = await nonceFor(X);
    await db.update(appDataNonces).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(appDataNonces.nonce, nonce));
    expect((await call(X, "POST", `${V1}/session`, { headers: page(X), json: await signInBody(carol, X, nonce) })).status).toBe(401);
  });

  it("a nonce from app Y can't sign in to app X, whichever domain is signed", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const nonce = await nonceFor(Y);
    expect((await call(X, "POST", `${V1}/session`, { headers: page(X), json: await signInBody(carol, X, nonce) })).status).toBe(401);
  });

  it("a signature for another domain is refused: another app, the main site, a phishing site", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    for (const domain of [Y, MAIN, "goodbuildit.xyz", "evil.example", "x-app.localhost", "x-app.localhost.evil.example"]) {
      const message = siwe(carol, domain, await nonceFor(X), { uri: `http://${X}` });
      const res = await call(X, "POST", `${V1}/session`, { headers: page(X), json: { message, signature: await carol.signMessage({ message }) } });
      expect(res.status, domain).toBe(401);
      expect(await errorCode(res), domain).toBe("domain_mismatch");
    }
  });

  it("forging the Host-like headers doesn't change the domain it expects", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const message = siwe(carol, "evil.example", await nonceFor(X));
    const res = await call(X, "POST", `${V1}/session`, {
      headers: { ...page(X), "x-forwarded-host": "evil.example", "x-gb-host": "evil.example", "x-gb-edge": "guess" },
      json: { message, signature: await carol.signMessage({ message }) },
    });
    expect(res.status).toBe(401);
  });

  it("a message whose uri points elsewhere is refused", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const message = siwe(carol, X, await nonceFor(X), { uri: "https://evil.example/" });
    expect((await call(X, "POST", `${V1}/session`, { headers: page(X), json: { message, signature: await carol.signMessage({ message }) } })).status).toBe(401);
  });

  it("a signature from another wallet is refused, and so is a chain we don't support", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const message = siwe(carol, X, await nonceFor(X));
    expect((await call(X, "POST", `${V1}/session`, { headers: page(X), json: { message, signature: await bob.signMessage({ message }) } })).status).toBe(401);

    const wrongChain = siwe(carol, X, await nonceFor(X), { chainId: mainnet.id });
    expect((await call(X, "POST", `${V1}/session`, { headers: page(X), json: { message: wrongChain, signature: await carol.signMessage({ message: wrongChain }) } })).status).toBe(401);
  });

  it("a stale message is refused even with a live nonce", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const message = siwe(carol, X, await nonceFor(X), { issuedAt: new Date(Date.now() - 60 * 60 * 1000) });
    expect((await call(X, "POST", `${V1}/session`, { headers: page(X), json: { message, signature: await carol.signMessage({ message }) } })).status).toBe(401);
  });

  it("a failed signature doesn't use up the nonce, and the right one still works", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const nonce = await nonceFor(X);
    const message = siwe(carol, X, nonce);
    expect((await call(X, "POST", `${V1}/session`, { headers: page(X), json: { message, signature: await bob.signMessage({ message }) } })).status).toBe(401);
    expect((await call(X, "POST", `${V1}/session`, { headers: page(X), json: { message, signature: await carol.signMessage({ message }) } })).status).toBe(200);
  });

  it("the message app X signs in with can't sign in to the main site", async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const message = siwe(carol, X, "abcdefgh12345678");
    await expect(verifySignIn({ message, signature: await carol.signMessage({ message }), expectedNonce: "abcdefgh12345678", expectedDomain: "goodbuildit.xyz", verifyContractSignature: async () => false })).rejects.toMatchObject({ code: "domain_mismatch" });
  });

  it("a contract wallet can sign in through the on-chain check, which the rate limit covers", async () => {
    const check = vi.fn(async () => true);
    deps = { ...deps, verifyContractSignature: check };
    const carol = privateKeyToAccount(generatePrivateKey());
    const message = siwe(carol, X, await nonceFor(X));
    expect((await call(X, "POST", `${V1}/session`, { headers: page(X), json: { message, signature: "0x1234" } })).status).toBe(200);
    expect(check).toHaveBeenCalledOnce();
  });

  it("signing out ends the session on the server, not only in the browser", async () => {
    expect((await call(X, "DELETE", `${V1}/session`, { cookie: aliceX, headers: page(X) })).status).toBe(200);
    expect((await get(X, aliceX, "c/notes")).status).toBe(401);
  });

  it("an expired session is refused", async () => {
    await db.update(appDataSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(appDataSessions.wallet, alice.address.toLowerCase()));
    expect((await get(X, aliceX, "c/notes")).status).toBe(401);
  });

  it("the cookie is scoped to this host and out of reach of the page's code", async () => {
    const res = await call(X, "POST", `${V1}/session`, { headers: page(X), json: await signInBody(privateKeyToAccount(generatePrivateKey()), X, await nonceFor(X)) });
    const set = res.headers.getSetCookie()[0].toLowerCase();
    expect(set).toContain("httponly");
    expect(set).toContain("samesite=strict");
    expect(set).toContain("path=/");
    expect(set).not.toContain("domain=");
  });

  it("the token isn't stored in the database", async () => {
    const token = aliceX.split("=")[1];
    const rows = await db.select().from(appDataSessions);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
  });
});

describe("GoodBuild's own session", () => {
  async function mainSession() {
    const user = await signInUser(db, { wallet: alice.address, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    return (await issueSession(db, user, celoSepolia.id)).token;
  }

  it("gets nothing from the data routes, under either cookie name", async () => {
    const token = await mainSession();
    expect((await get(X, `${SESSION_COOKIE}=${token}`, "c/notes")).status).toBe(401);
    expect((await get(X, `${APP_SESSION_COOKIE}=${token}`, "c/notes")).status).toBe(401);
  });

  it("isn't set, changed or cleared by a sign-in or sign-out", async () => {
    const token = await mainSession();
    const signedOut = await call(X, "DELETE", `${V1}/session`, { cookie: `${SESSION_COOKIE}=${token}; ${aliceX}`, headers: page(X) });
    expect(signedOut.headers.getSetCookie().filter((c) => c.startsWith(`${SESSION_COOKIE}=`))).toEqual([]);
    const signedIn = await call(X, "POST", `${V1}/session`, { headers: page(X), json: await signInBody(bob, X, await nonceFor(X)) });
    expect(signedIn.headers.getSetCookie().filter((c) => c.startsWith(`${SESSION_COOKIE}=`))).toEqual([]);
    expect(await resolveSession(db, token)).not.toBeNull();
  });

  it("an app session token isn't a GoodBuild session", async () => {
    expect(await resolveSession(db, aliceX.split("=")[1])).toBeNull();
  });
});

describe("hosts", () => {
  it("the data routes don't exist on the main host", async () => {
    expect((await call(MAIN, "GET", "/app-data/x-app/v1/c/posts")).status).toBe(404);
    expect((await call(MAIN, "PUT", "/app-data/x-app/v1/c/posts/k", { json: { value: 1 } })).status).toBe(404);
    expect((await call(MAIN, "GET", `${V1}/c/posts`)).headers.get("x-passed-to")).toBe("main-site"); // an ordinary 404 page
  });

  it("the route itself refuses the main host and unknown hosts", async () => {
    for (const host of [MAIN, "goodbuild.localhost:3000", "evil.example", "a.x-app.localhost:3000"]) {
      const request = new NextRequest(`http://${host}/app-data/x-app/v1/c/posts`, { headers: { host } });
      expect((await handleAppData(db, request, { slug: "x-app", path: ["v1", "c", "posts"] }, deps)).status, host).toBe(404);
    }
  });

  it("an app host can't reach the main site's API or pages", async () => {
    for (const path of ["/api/projects", "/api/auth/session", "/api/projects/" + projectX.id + "/app-data", "/home", "/app-data/y-app/v1/c/posts", "/published-app/y-app"]) {
      const res = await call(X, "GET", path, { headers: page(X) });
      expect(res.headers.get("x-passed-to"), path).toBe(`/published-app/x-app${path}`);
    }
  });

  it("a blocked region gets 451 on every data route, signed in or not", async () => {
    for (const [method, path] of [["GET", "/session/nonce"], ["POST", "/session"], ["GET", "/c/posts"], ["PUT", "/c/notes/k"], ["DELETE", "/me"]]) {
      const res = await call(X, method, `${V1}${path}`, { cookie: aliceX, headers: { ...page(X), "cf-ipcountry": "US" } });
      expect(res.status, path).toBe(451);
    }
  });

  it("a taken-down or unpublished app serves no data, and sign-in stops", async () => {
    await put(X, aliceX, "posts", "p", "v");
    await db.update(publications).set({ disabledAt: new Date() }).where(eq(publications.projectId, projectX.id));
    expect((await get(X, undefined, "c/posts")).status).toBe(404);
    expect((await get(X, aliceX, "c/notes")).status).toBe(404);
    expect((await put(X, aliceX, "notes", "k", "v")).status).toBe(404);
    expect((await call(X, "GET", `${V1}/session/nonce`, { headers: page(X) })).status).toBe(404);

    await db.update(publications).set({ disabledAt: null }).where(eq(publications.projectId, projectX.id));
    expect((await get(X, undefined, "c/posts")).status).toBe(200);
    await unpublishApp(db, projectX);
    expect((await get(X, undefined, "c/posts")).status).toBe(404);
  });
});

describe("cross-site requests carrying a visitor's cookie", () => {
  // A sibling app is same-site, so SameSite cookies don't stop the browser sending the cookie.
  const sibling = { origin: `http://${Y}`, "sec-fetch-site": "same-site" };

  it("a text/plain POST from a sibling app does nothing", async () => {
    const res = await call(X, "POST", `${V1}/c/notes`, { cookie: aliceX, headers: { ...sibling, "content-type": "text/plain" }, body: JSON.stringify({ value: "csrf" }) });
    expect(res.status).toBe(403);
    expect(await db.select().from(appDataRecords).where(eq(appDataRecords.projectId, projectX.id))).toEqual([]);
  });

  it("every write and read from a sibling or foreign page is refused, by either header", async () => {
    const attacks: Array<Record<string, string>> = [
      sibling,
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "cross-site" },
      { origin: `http://${Y}` },
      { origin: "https://evil.example" },
      { origin: "null" },
      { origin: "not a url" },
      { origin: `http://${X}`, "sec-fetch-site": "cross-site" },
    ];
    for (const headers of attacks) {
      const label = JSON.stringify(headers);
      expect((await call(X, "PUT", `${V1}/c/notes/k`, { cookie: aliceX, headers, json: { value: 1 } })).status, label).toBe(403);
      expect((await call(X, "DELETE", `${V1}/me`, { cookie: aliceX, headers })).status, label).toBe(403);
      expect((await call(X, "DELETE", `${V1}/session`, { cookie: aliceX, headers })).status, label).toBe(403);
      expect((await call(X, "GET", `${V1}/c/notes`, { cookie: aliceX, headers })).status, label).toBe(403);
    }
  });

  it("a same-origin write with the wrong content type is refused, since it skips the preflight", async () => {
    const res = await call(X, "PUT", `${V1}/c/notes/k`, { cookie: aliceX, headers: { ...page(X), "content-type": "text/plain" }, body: JSON.stringify({ value: 1 }) });
    expect(res.status).toBe(415);
    expect((await call(X, "POST", `${V1}/session`, { headers: { ...page(X), "content-type": "application/x-www-form-urlencoded" }, body: "a=1" })).status).toBe(415);
  });

  it("never grants CORS, on any response", async () => {
    const responses = await Promise.all([
      call(X, "OPTIONS", `${V1}/c/notes/k`, { headers: { origin: `http://${Y}`, "access-control-request-method": "PUT", "access-control-request-headers": "content-type" } }),
      get(X, undefined, "c/posts"),
      get(X, aliceX, "c/notes"),
      call(X, "GET", `${V1}/session/nonce`, { headers: { origin: `http://${Y}` } }),
    ]);
    for (const res of responses) {
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    }
  });

  it("every response is uncacheable, so Cloudflare can't serve one visitor's data to another", async () => {
    for (const res of [await get(X, undefined, "c/posts"), await get(X, aliceX, "c/notes"), await get(X, undefined, "c/notes"), await call(X, "GET", `${V1}/session/nonce`, { headers: page(X) })]) {
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
});

describe("quotas and limits", () => {
  it("refuses a value over the size limit, with a clear error, even with no or a false content-length", async () => {
    limits.maxValueBytes = 1024;
    const res = await put(X, aliceX, "notes", "big", "x".repeat(2000));
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe("value_too_large");

    const huge = JSON.stringify({ value: "x".repeat(5_000_000) });
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(huge)); c.close(); } });
    const request = new NextRequest(`http://${X}/app-data/x-app/v1/c/notes/big`, {
      method: "PUT",
      headers: { host: X, cookie: aliceX, "content-type": "application/json", "content-length": "10", ...page(X) },
      body: stream,
      duplex: "half",
    } as ConstructorParameters<typeof NextRequest>[1]);
    expect((await handleAppData(db, request, { slug: "x-app", path: ["v1", "c", "notes", "big"] }, deps)).status).toBe(413);
    expect(await db.select().from(appDataRecords)).toEqual([]);
  });

  it("refuses a huge sign-in body before parsing it", async () => {
    const res = await call(X, "POST", `${V1}/session`, { headers: page(X), json: { message: "x".repeat(200_000), signature: "0x" } });
    expect(res.status).toBe(413);
  });

  it("stops a wallet at its row limit, and updating or deleting still works there", async () => {
    limits.maxRowsPerWallet = 2;
    expect((await put(X, aliceX, "notes", "a", 1)).status).toBe(200);
    expect((await put(X, aliceX, "notes", "b", 1)).status).toBe(200);
    const over = await put(X, aliceX, "notes", "c", 1);
    expect(over.status).toBe(507);
    expect(await errorCode(over)).toBe("wallet_quota_exceeded");
    expect((await put(X, aliceX, "notes", "a", 2)).status).toBe(200); // replacing adds no row
    expect((await call(X, "DELETE", `${V1}/c/notes/a`, { cookie: aliceX, headers: page(X) })).status).toBe(200);
    expect((await put(X, aliceX, "notes", "c", 1)).status).toBe(200);
    expect((await put(X, bobX, "notes", "a", 1)).status).toBe(200); // Bob has his own allowance
  });

  it("stops a wallet at its byte limit, counting a replacement by its growth", async () => {
    limits.maxBytesPerWallet = 2000;
    expect((await put(X, aliceX, "notes", "a", "x".repeat(1500))).status).toBe(200);
    expect(await errorCode(await put(X, aliceX, "notes", "b", "x".repeat(1500)))).toBe("wallet_quota_exceeded");
    expect(await errorCode(await put(X, aliceX, "notes", "a", "x".repeat(2500)))).toBe("wallet_quota_exceeded");
    expect((await put(X, aliceX, "notes", "a", "x".repeat(1800))).status).toBe(200);
  });

  it("stops a project at its limits, across wallets", async () => {
    limits.maxRowsPerProject = 3;
    expect((await put(X, aliceX, "notes", "a", 1)).status).toBe(200);
    expect((await put(X, aliceX, "notes", "b", 1)).status).toBe(200);
    expect((await put(X, bobX, "notes", "a", 1)).status).toBe(200);
    expect(await errorCode(await put(X, bobX, "notes", "b", 1))).toBe("project_quota_exceeded");

    limits.maxRowsPerProject = 1000;
    limits.maxBytesPerProject = 1000;
    expect(await errorCode(await put(X, bobX, "notes", "big", "x".repeat(1000)))).toBe("project_quota_exceeded");
  });

  it("one app filling up doesn't stop another", async () => {
    limits.maxRowsPerProject = 1;
    expect((await put(X, aliceX, "notes", "a", 1)).status).toBe(200);
    expect((await put(X, aliceX, "notes", "b", 1)).status).toBe(507);
    expect((await put(Y, await signIn(alice, Y), "notes", "a", 1)).status).toBe(200);
  });

  it("stops everyone at the whole-site limit", async () => {
    limits.maxTotalBytes = 100;
    expect((await put(X, aliceX, "notes", "a", "x".repeat(200))).status).toBe(200); // measured total was 0
    deps.totalBytesCacheMs = 0;
    expect(await errorCode(await put(X, aliceX, "notes", "b", 1))).toBe("storage_full");
  });

  it("usage stays exact through writes, replacements and deletes, and concurrent writes can't overshoot", async () => {
    limits.maxRowsPerWallet = 5;
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => put(X, aliceX, "notes", `k${i}`, i)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(results.filter((r) => r.status === 507)).toHaveLength(7);
    await put(X, aliceX, "notes", "k0", "replaced");
    const [{ rows, bytes }] = await db.select({ rows: sql<number>`count(*)::int`, bytes: sql<number>`sum(size_bytes)::int` }).from(appDataRecords).where(eq(appDataRecords.projectId, projectX.id));
    const usage = await db.select().from(appDataUsage).where(eq(appDataUsage.projectId, projectX.id));
    for (const row of usage) expect({ wallet: row.wallet, rows: row.rows, bytes: row.bytes }).toEqual({ wallet: row.wallet, rows, bytes });
  });

  it("rate limits writes per wallet and per address, with Retry-After", async () => {
    limits.writesPerWalletPerMinute = 3;
    for (let i = 0; i < 3; i++) expect((await put(X, aliceX, "notes", `k${i}`, i)).status).toBe(200);
    const res = await put(X, aliceX, "notes", "k4", 4);
    expect(res.status).toBe(429);
    expect(await errorCode(res)).toBe("rate_limited");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await put(X, bobX, "notes", "k", 1)).status).toBe(200);
  });

  it("rate limits nonces and sign-ins by address, which is what bounds the table and the on-chain check", async () => {
    limits.noncesPerIpPerMinute = 2;
    const from = (ip: string) => ({ ...page(X), "cf-connecting-ip": ip });
    expect((await call(X, "GET", `${V1}/session/nonce`, { headers: from("1.1.1.1") })).status).toBe(200);
    expect((await call(X, "GET", `${V1}/session/nonce`, { headers: from("1.1.1.1") })).status).toBe(200);
    expect((await call(X, "GET", `${V1}/session/nonce`, { headers: from("1.1.1.1") })).status).toBe(429);
    expect((await call(X, "GET", `${V1}/session/nonce`, { headers: from("2.2.2.2") })).status).toBe(200);

    limits.signInsPerIpPerMinute = 1;
    const check = vi.fn(async () => false);
    deps = { ...deps, verifyContractSignature: check };
    const message = siwe(alice, X, ((await (await call(X, "GET", `${V1}/session/nonce`, { headers: from("4.4.4.4") })).json()) as { nonce: string }).nonce);
    await call(X, "POST", `${V1}/session`, { headers: from("3.3.3.3"), json: { message, signature: "0x12" } });
    expect((await call(X, "POST", `${V1}/session`, { headers: from("3.3.3.3"), json: { message, signature: "0x12" } })).status).toBe(429);
  });

  it("a bad nonce never reaches the on-chain signature check", async () => {
    const check = vi.fn(async () => false);
    deps = { ...deps, verifyContractSignature: check };
    const message = siwe(alice, X, "abcdefgh12345678");
    await call(X, "POST", `${V1}/session`, { headers: page(X), json: { message, signature: "0x12" } });
    expect(check).not.toHaveBeenCalled();
  });

  it("expired nonces and sessions are cleaned up", async () => {
    await db.update(appDataNonces).set({ expiresAt: new Date(Date.now() - 1000) });
    await db.update(appDataSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(appDataSessions.wallet, bob.address.toLowerCase()));
    await signIn(alice, X);
    expect((await db.select().from(appDataNonces)).filter((n) => n.expiresAt < new Date())).toEqual([]);
    expect(await db.select().from(appDataSessions).where(eq(appDataSessions.wallet, bob.address.toLowerCase()))).toEqual([]);
  });
});

describe("injection and odd input", () => {
  const badCollections = ["x'; DROP TABLE app_data_records;--", "A", "UPPER", "1abc", "_x", "a b", "a/b", "a%2Fb", "%00", "a%00b", "a".repeat(49), "..", "%2e%2e", "%22", "(select 1)"];

  it("bad collection names are refused without touching the database", async () => {
    for (const name of badCollections) {
      const write = await call(X, "PUT", `${V1}/c/${name.replaceAll(" ", "%20")}/k`, { cookie: aliceX, headers: page(X), json: { value: 1 } });
      expect(write.status, name).toBeGreaterThanOrEqual(400);
      expect(write.status, name).toBeLessThan(500);
      const read = await call(X, "GET", `${V1}/c/${name.replaceAll(" ", "%20")}`, { cookie: aliceX, headers: page(X) });
      expect(read.status, name).toBeGreaterThanOrEqual(400);
      expect(read.status, name).toBeLessThan(500);
    }
    expect(await db.select().from(appDataRecords)).toEqual([]);
    await db.select().from(appDataRecords); // the table is still there
  });

  it("bad keys are refused", async () => {
    for (const key of ["a'b", "a;b", "..", ".hidden", "a%2Fb", "a%00b", "%0a", "a b".replace(" ", "%20"), "x".repeat(129), "-x", "a*b"]) {
      const res = await call(X, "PUT", `${V1}/c/notes/${key}`, { cookie: aliceX, headers: page(X), json: { value: 1 } });
      expect(res.status, key).toBeGreaterThanOrEqual(400);
      expect(res.status, key).toBeLessThan(500);
    }
    expect(await db.select().from(appDataRecords)).toEqual([]);
  });

  it("bad owner, limit and cursor values are refused", async () => {
    for (const query of ["owner=x", "owner=0x12' or 1=1--", "limit=-1", "limit=abc", "limit=1e9", "cursor=x'", "cursor=-5"]) {
      const res = await get(X, aliceX, `c/notes?${query.replaceAll(" ", "%20").replaceAll("'", "%27")}`);
      expect(res.status, query).toBe(400);
    }
  });

  it('names like "constructor" and "__proto__" are private, whatever the rules object inherits', async () => {
    for (const name of ["constructor", "tostring", "valueof", "hasownproperty"]) {
      expect((await put(X, bobX, name, "k", "secret")).status, name).toBe(200);
      expect((await get(X, undefined, `c/${name}`)).status, name).toBe(401);
      expect(await records(await get(X, aliceX, `c/${name}`)), name).toEqual([]);
    }
    expect((await put(X, bobX, "__proto__", "k", "x")).status).toBe(400);
  });

  it("values that break naive JSON storage come back unchanged, with no 500", async () => {
    const nasty: unknown[] = [
      "\u0000 null byte", "\ud83d lone surrogate", "'; DROP TABLE app_data_records;--", "<script>alert(1)</script>", { __proto__: 1, constructor: { prototype: { x: 1 } } },
      JSON.parse('{"__proto__": {"polluted": true}}'), [[[[[[1]]]]]], 1e308, null, false, "",
    ];
    for (const [i, value] of nasty.entries()) {
      const res = await put(X, aliceX, "notes", `n${i}`, value);
      expect(res.status, String(i)).toBe(200);
      const back = (await (await get(X, aliceX, `c/notes/n${i}`)).json()) as { value: unknown };
      expect(back.value, String(i)).toEqual(JSON.parse(JSON.stringify(value)));
    }
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("malformed bodies are 400s, not 500s", async () => {
    for (const body of ["", "{", "[]", "null", '"x"', "{}", '{"val":1}', "[".repeat(10_000)]) {
      const res = await call(X, "PUT", `${V1}/c/notes/k`, { cookie: aliceX, headers: { ...page(X), "content-type": "application/json" }, body });
      expect(res.status, body.slice(0, 10)).toBe(400);
    }
    for (const json of [{}, { message: 1, signature: 2 }, { message: "garbage", signature: "0x" }, { message: "garbage", signature: "not hex" }]) {
      const res = await call(X, "POST", `${V1}/session`, { headers: page(X), json });
      expect(res.status, JSON.stringify(json)).toBeGreaterThanOrEqual(400);
      expect(res.status, JSON.stringify(json)).toBeLessThan(500);
    }
  });

  it("unknown paths and methods are clean errors", async () => {
    for (const [method, path] of [["GET", "/v2/c/notes"], ["GET", "/"], ["POST", "/c/notes/k"], ["PUT", "/c/notes"], ["PATCH", "/c/notes/k"], ["GET", "/c/notes/k/extra"], ["GET", "/session/other"], ["POST", "/me"]]) {
      const res = await call(X, method, method === "GET" && path.startsWith("/v2") ? `/__gb/data${path}` : `${V1}${path}`, { cookie: aliceX, headers: page(X), json: method === "GET" ? undefined : { value: 1 } });
      expect(res.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
      expect(res.status, `${method} ${path}`).toBeLessThan(500);
    }
  });
});

describe("access rules", () => {
  it("an undeclared collection is private", async () => {
    await put(X, bobX, "anything", "k", "secret");
    expect((await get(X, undefined, "c/anything")).status).toBe(401);
    expect(await records(await get(X, aliceX, "c/anything"))).toEqual([]);
  });

  it("a visitor can't change a rule by asking", async () => {
    const res = await call(X, "PUT", `${V1}/c/notes/k?access=public-read`, { cookie: bobX, headers: { ...page(X), "x-access": "public-read" }, json: { value: "secret", access: "public-read", public: true, isPublic: true } });
    expect(((await res.json()) as { public: boolean }).public).toBe(false);
    expect((await get(X, undefined, "c/notes")).status).toBe(401);
    expect((await get(X, aliceX, `c/notes/k?owner=${bob.address}`)).status).toBe(404);
  });

  it("making a collection public later doesn't expose what was written while it was private", async () => {
    await put(X, bobX, "notes", "old", "written as private");
    await saveFiles(db, projectX.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": JSON.stringify({ collections: { notes: "public-read" } }) });
    await publishApp(db, projectX, "x-app", { build: BUILT });
    expect(await records(await get(X, undefined, "c/notes"))).toEqual([]);
    expect((await get(X, undefined, `c/notes/old?owner=${bob.address}`)).status).toBe(404);
    await put(X, bobX, "notes", "new", "written as public");
    expect((await records(await get(X, undefined, "c/notes"))).map((r) => r.key)).toEqual(["new"]);
  });

  it("making a collection private hides its existing records at once", async () => {
    await put(X, bobX, "posts", "p", "public for now");
    await saveFiles(db, projectX.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": JSON.stringify({ collections: {} }) });
    await publishApp(db, projectX, "x-app", { build: BUILT });
    expect((await get(X, undefined, "c/posts")).status).toBe(401);
    expect(await records(await get(X, aliceX, "c/posts"))).toEqual([]);
    expect((await records(await get(X, bobX, "c/posts"))).map((r) => r.key)).toEqual(["p"]);
  });

  it("publishing refuses a broken rules file and leaves the old rules live", async () => {
    await saveFiles(db, projectX.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": JSON.stringify({ collections: { notes: "everyone" } }) });
    await expect(publishApp(db, projectX, "x-app", { build: BUILT })).rejects.toMatchObject({ code: "build_failed" });
    await put(X, bobX, "notes", "k", "still private");
    expect((await get(X, undefined, "c/notes")).status).toBe(401);
  });

  it("lists page through everything, newest first", async () => {
    for (const k of ["a", "b", "c"]) await put(X, bobX, "posts", k, k);
    await put(X, aliceX, "posts", "d", "d");
    const first = (await (await get(X, undefined, "c/posts?limit=2")).json()) as { records: Array<{ key: string }>; nextCursor: string | null };
    expect(first.records.map((r) => r.key)).toEqual(["d", "c"]);
    const second = (await (await get(X, undefined, `c/posts?limit=2&cursor=${first.nextCursor}`)).json()) as { records: Array<{ key: string }>; nextCursor: string | null };
    expect(second.records.map((r) => r.key)).toEqual(["b", "a"]);
    expect(second.nextCursor).toBeNull();
    expect((await records(await get(X, undefined, `c/posts?owner=${alice.address}`))).map((r) => r.key)).toEqual(["d"]);
  });
});

describe("deleting data", () => {
  beforeEach(async () => {
    await put(X, aliceX, "notes", "k", "x");
    await put(Y, await signIn(alice, Y), "notes", "k", "y");
  });

  it("deleting a project removes everything it held, and nothing of anyone else's", async () => {
    await db.delete(projects).where(eq(projects.id, projectX.id));
    for (const table of [appDataRecords, appDataUsage, appDataNonces, appDataSessions]) {
      expect(await db.select().from(table).where(eq(table.projectId, projectX.id))).toEqual([]);
    }
    expect(await db.select().from(appDataRecords).where(eq(appDataRecords.projectId, projectY.id))).toHaveLength(1);
  });

  it("the owner's delete-all clears records, usage and sessions, in that project only", async () => {
    expect(await projectDataStats(db, projectX.id)).toMatchObject({ records: 1, wallets: 1 });
    await deleteProjectData(db, projectX.id);
    expect(await projectDataStats(db, projectX.id)).toMatchObject({ records: 0, wallets: 0, bytes: 0 });
    expect((await get(X, aliceX, "c/notes")).status).toBe(401);
    expect(await db.select().from(appDataRecords).where(eq(appDataRecords.projectId, projectY.id))).toHaveLength(1);
  });
});
