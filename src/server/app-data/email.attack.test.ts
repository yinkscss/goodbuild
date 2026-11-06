// @vitest-environment node
/**
 * The attacker's suite for email sign-in (D35): codes, caps, ids per app and every purge path. Same harness as attack.test.ts: real proxy, real handler.
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
import { appDataEmailCodes, appDataEmailIdentities, appDataSessions } from "@/server/db/app-data-schema";
import { publications } from "@/server/db/publish-schema";
import { deleteProjectData } from "./store";
import { codeMessage, emailSender, type EmailMessage } from "./email";
import type { Project } from "@/server/db/schema";
import { createProjectFromPrompt } from "@/server/projects";
import { publishApp } from "@/server/publish/service";
import { proxy } from "@/proxy";
import { APP_SESSION_COOKIE, createRateLimiter, handleAppData, type AppDataDeps } from "./handler";
import { DEFAULT_LIMITS, type AppDataLimits } from "./limits";

const BUILT = async () => [{ path: "index.html", mime: "text/html", bytes: new TextEncoder().encode("<p>app</p>") }];

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

async function publishedProject(slug: string, rules: string = RULES()): Promise<Project> {
  const project = await createProjectFromPrompt(db, ownerId, { prompt: slug, network: "celo-sepolia" });
  await saveFiles(db, project.id, { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>", "src/lib/dataRules.json": rules });
  await publishApp(db, project, slug, { build: BUILT });
  return project;
}




const RULES = (signIn: unknown = { email: true }) =>
  JSON.stringify({
    ...(signIn === "none" ? {} : { signIn }),
    collections: {
      notes: "private",
      members: { read: ["signed-in"] },
      posts: "public-read",
      bookings: { create: "anyone", read: ["writer", "owner"], public: ["day"], fields: { name: "string", day: "string" }, unique: ["day"] },
    },
  });

let app: Project;
let other: Project;
let ownerAccount: PrivateKeyAccount;
let ownerX: string;
let sent: EmailMessage[];
const Y = "y-app.localhost:3000";

const ask = (host: string, email: unknown, ip = "203.0.113.5") => call(host, "POST", `${V1}/session/email`, { headers: { ...page(host), "cf-connecting-ip": ip }, json: { email } });
const verify = (host: string, email: string, code: string, cookie?: string, ip = "203.0.113.5") =>
  call(host, "POST", `${V1}/session/email/verify`, { cookie, headers: { ...page(host), "cf-connecting-ip": ip }, json: { email, code } });
const lastCode = () => /is ([0-9]{6})\./.exec(sent[sent.length - 1].text)![1];
async function emailSignIn(host: string, email: string): Promise<string> {
  expect((await ask(host, email)).status).toBe(200);
  const res = await verify(host, email, lastCode());
  expect(res.status).toBe(200);
  return cookieFrom(res);
}
const subjectOf = async (projectId: string, email: string) => (await db.select().from(appDataEmailIdentities).where(eq(appDataEmailIdentities.projectId, projectId))).find((r) => r.email === email)?.subject;
type Rec = { key: string; owner: string | null; value: Record<string, unknown> };
const recs = async (res: Response) => ((await res.json()) as { records: Rec[] }).records;

beforeEach(async () => {
  vi.unstubAllEnvs();
  db = await createTestDb();
  sent = [];
  limits = { ...DEFAULT_LIMITS };
  deps = { limits, rate: createRateLimiter(), verifyContractSignature: async () => false, sendEmail: async (m) => void sent.push(m) };
  ownerAccount = privateKeyToAccount(generatePrivateKey());
  ownerId = (await signInUser(db, { wallet: ownerAccount.address, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } })).id;
  app = await publishedProject("x-app", RULES());
  other = await publishedProject("y-app", RULES());
  ownerX = await signIn(ownerAccount, X);
});

describe("sending a code", () => {
  it("sends one email to exactly the address given, naming only the app's address", async () => {
    const res = await ask(X, "  Ada@Example.com ");
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ada@example.com");
    expect(sent[0].text).toContain("x-app.localhost:3000");
    expect(sent[0].text).toContain("Never share this code");
    expect(sent[0].subject).toMatch(/^Your sign-in code: [0-9]{6}$/);
  });

  it("refuses anything but one plain address", async () => {
    limits.emailCodesPerIpPerMinute = 100;
    for (const bad of ["a@b.com, c@d.com", "a@b.com;c@d.com", "Ada <a@b.com>", "a@b.com\r\nBcc: x@y.com", "a@b", "@b.com", "a@@b.com", "a b@c.com", "x".repeat(250) + "@b.com", 42, null]) {
      expect((await ask(X, bad)).status, String(bad)).toBe(400);
    }
    expect(sent).toEqual([]);
  });

  it("keeps dots and +tags, because they can be different people", async () => {
    await ask(X, "a.da+salon@example.com");
    expect(sent[0].to).toBe("a.da+salon@example.com");
  });

  it("is off unless the app asked for it", async () => {
    const quiet = await publishedProject("q-app", RULES("none"));
    expect((await ask("q-app.localhost:3000", "ada@example.com")).status).toBe(404);
    expect(sent).toEqual([]);
    expect((await db.select().from(publications).where(eq(publications.projectId, quiet.id)))[0].emailSignIn).toBe(false);
  });

  it("refuses in production when no email key is set, instead of pretending", async () => {
    deps.sendEmail = null;
    const res = await ask(X, "ada@example.com");
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("email_unavailable");
  });

  it("says plainly when sending failed, and the failed code doesn't count", async () => {
    deps.sendEmail = async () => {
      const { AppDataError } = await import("./store");
      throw new AppDataError("email_failed", 502, "The email couldn't be sent just now.");
    };
    expect((await ask(X, "ada@example.com")).status).toBe(502);
    expect(await db.select().from(appDataEmailCodes)).toEqual([]);
  });
});

describe("caps, counted in the database", () => {
  it("3 codes per address every 10 minutes, per app", async () => {
    for (let i = 0; i < 3; i++) expect((await ask(X, "ada@example.com", `198.51.100.${i}`)).status).toBe(200);
    const fourth = await ask(X, "ada@example.com", "198.51.100.9");
    expect(fourth.status).toBe(429);
    expect(await errorCode(fourth)).toBe("email_limit");
    // A cap in one app doesn't block the same address in another.
    expect((await ask(Y, "ada@example.com")).status).toBe(200);
  });

  it("a daily cap per IP, per app, and across the whole site", async () => {
    limits.emailCodesPerIpPerDay = 2;
    expect((await ask(X, "a@example.com")).status).toBe(200);
    expect((await ask(X, "b@example.com")).status).toBe(200);
    expect((await ask(X, "c@example.com")).status).toBe(429);
    limits.emailCodesPerIpPerDay = 100;
    limits.emailCodesPerProjectPerDay = 3;
    expect((await ask(X, "d@example.com", "192.0.2.1")).status).toBe(200);
    expect(await errorCode(await ask(X, "e@example.com", "192.0.2.2"))).toBe("email_app_cap");
    limits.emailCodesSitePerDay = 3;
    expect(await errorCode(await ask(Y, "f@example.com", "192.0.2.3"))).toBe("email_site_cap");
  });

  it("the per-minute IP limit answers 429 with Retry-After", async () => {
    limits.emailCodesPerIpPerMinute = 1;
    await ask(X, "a@example.com");
    const res = await ask(X, "b@example.com");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

describe("checking a code", () => {
  it("signs in with the right code, once", async () => {
    await ask(X, "ada@example.com");
    const code = lastCode();
    const res = await verify(X, "ada@example.com", code);
    expect(res.status).toBe(200);
    const session = (await (await get(X, cookieFrom(res), "session")).json()) as { wallet: string | null; email: string; signedIn: boolean; owner: boolean };
    expect(session).toMatchObject({ wallet: null, email: "ada@example.com", signedIn: true, owner: false });
    expect((await verify(X, "ada@example.com", code)).status).toBe(401);
  });

  it("refuses a code sent to another address, or for another app", async () => {
    await ask(X, "ada@example.com");
    const code = lastCode();
    expect((await verify(X, "bola@example.com", code)).status).toBe(401);
    expect((await verify(Y, "ada@example.com", code)).status).toBe(401);
    expect((await verify(X, "ada@example.com", code)).status).toBe(200);
  });

  it("refuses an expired code", async () => {
    await ask(X, "ada@example.com");
    await db.update(appDataEmailCodes).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await verify(X, "ada@example.com", lastCode())).status).toBe(401);
  });

  it("allows 5 tries per code, even when 30 guesses arrive at once", async () => {
    await ask(X, "ada@example.com");
    const right = lastCode();
    const wrong = right === "000000" ? "111111" : "000000";
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => verify(X, "ada@example.com", wrong, undefined, `10.0.0.${i}`)));
    expect(results.every((r) => r.status === 401 || r.status === 429)).toBe(true);
    const [row] = await db.select().from(appDataEmailCodes);
    expect(row.attempts).toBe(5);
    expect((await verify(X, "ada@example.com", right)).status).toBe(401);
  });

  it("gives one session when the right code arrives twice at once", async () => {
    await ask(X, "ada@example.com");
    const code = lastCode();
    const both = await Promise.all([verify(X, "ada@example.com", code), verify(X, "ada@example.com", code, undefined, "10.0.1.1")]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await db.select().from(appDataSessions).where(eq(appDataSessions.email, "ada@example.com"))).toHaveLength(1);
  });

  it("caps wrong guesses across codes, so asking for new codes doesn't buy more tries", async () => {
    limits.emailFailuresPerEmailPerDay = 6;
    for (let round = 0; round < 2; round++) {
      await ask(X, "ada@example.com", `10.1.${round}.1`);
      const wrong = lastCode() === "000000" ? "111111" : "000000";
      for (let i = 0; i < 3; i++) await verify(X, "ada@example.com", wrong, undefined, `10.2.${round}.${i}`);
    }
    await ask(X, "ada@example.com", "10.3.0.1");
    const locked = await verify(X, "ada@example.com", lastCode(), undefined, "10.3.0.2");
    expect(locked.status).toBe(429);
    expect(await errorCode(locked)).toBe("email_locked");
  });
});

describe("who an email visitor is", () => {
  it("keeps one id per app, a different one in every other app, and never the address", async () => {
    const x1 = await emailSignIn(X, "ada@example.com");
    await put(X, x1, "notes", "n", "mine");
    const x2 = await emailSignIn(X, "ada@example.com");
    expect((await recs(await get(X, x2, "c/notes")))[0].value).toBe("mine");
    await emailSignIn(Y, "ada@example.com");
    const sx = await subjectOf(app.id, "ada@example.com");
    const sy = await subjectOf(other.id, "ada@example.com");
    expect(sx).toMatch(/^email:[0-9a-f-]{36}$/);
    expect(sx).not.toBe(sy);
    expect(sx).not.toContain("ada");
  });

  it("is signed in for the rules, but never the owner", async () => {
    const ada = await emailSignIn(X, "ada@example.com");
    expect((await put(X, ada, "members", "me", { name: "Ada" })).status).toBe(200);
    expect((await recs(await get(X, ada, "c/members")))[0].value).toEqual({ name: "Ada" });
    expect(((await (await get(X, ada, "session")).json()) as { owner: boolean }).owner).toBe(false);
  });

  it("never shows the address to other people, even in a public collection", async () => {
    const ada = await emailSignIn(X, "ada@example.com");
    await put(X, ada, "posts", "p", { text: "hello" });
    const res = await get(X, undefined, "c/posts");
    const text = await res.text();
    expect(text).toContain("hello");
    expect(text).not.toContain("ada@example.com");
    await call(X, "POST", `${V1}/c/bookings`, { cookie: ada, headers: page(X), json: { value: { name: "Ada", day: "Mon" } } });
    const ownerView = await (await get(X, ownerX, "c/bookings")).text();
    expect(ownerView).toContain("Ada");
    expect(ownerView).not.toContain("ada@example.com");
  });

  it("ends an anonymous session when the visitor signs in by email", async () => {
    const anonRes = await call(X, "POST", `${V1}/c/bookings`, { headers: page(X), json: { value: { name: "A", day: "Tue" } } });
    const anon = cookieFrom(anonRes);
    await ask(X, "ada@example.com");
    const res = await verify(X, "ada@example.com", lastCode(), anon);
    expect(res.status).toBe(200);
    expect(((await (await get(X, anon, "session")).json()) as { signedIn: boolean }).signedIn).toBe(false);
  });
});

describe("deleting", () => {
  it("Delete my data removes the visitor's records, sessions, address and codes in that app", async () => {
    const ada = await emailSignIn(X, "ada@example.com");
    await put(X, ada, "notes", "n", "x");
    await ask(X, "ada@example.com", "10.9.9.9");
    expect((await call(X, "DELETE", `${V1}/me`, { cookie: ada, headers: page(X) })).status).toBe(200);
    expect(await subjectOf(app.id, "ada@example.com")).toBeUndefined();
    expect(await db.select().from(appDataEmailCodes).where(eq(appDataEmailCodes.projectId, app.id))).toEqual([]);
    expect(await db.select().from(appDataSessions).where(eq(appDataSessions.email, "ada@example.com"))).toEqual([]);
  });

  it("the owner's Delete all and a takedown purge clear addresses and codes too", async () => {
    await emailSignIn(X, "ada@example.com");
    await ask(X, "bola@example.com");
    await deleteProjectData(db, app.id);
    expect(await db.select().from(appDataEmailIdentities).where(eq(appDataEmailIdentities.projectId, app.id))).toEqual([]);
    expect(await db.select().from(appDataEmailCodes).where(eq(appDataEmailCodes.projectId, app.id))).toEqual([]);
    expect(await db.select().from(appDataSessions).where(eq(appDataSessions.projectId, app.id))).toEqual([]);
  });
});

describe("the email itself", () => {
  it("never logs codes instead of sending on a real domain, whatever the flag says", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(emailSender({ EMAIL_LOG_CODES_LOCALHOST_ONLY: "1", APP_DOMAIN: "goodbuildit.xyz" })).toBeNull();
    expect(emailSender({ APP_DOMAIN: "localhost:3000" })).toBeNull();
    expect(emailSender({ EMAIL_LOG_CODES_LOCALHOST_ONLY: "1", APP_DOMAIN: "localhost:3000" })).not.toBeNull();
  });

  it("goes to Resend with one recipient, the configured sender and a timeout", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const send = emailSender({ RESEND_API_KEY: "re_test_key_for_unit_tests_only", EMAIL_FROM: "GoodBuild <login@goodbuildit.xyz>" }, (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);
    await send!(codeMessage("ada@example.com", "123456", "salon.goodbuildit.xyz"));
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ from: "GoodBuild <login@goodbuildit.xyz>", to: ["ada@example.com"], subject: "Your sign-in code: 123456", text: expect.stringContaining("salon.goodbuildit.xyz") });
    expect(calls[0].init.signal).toBeTruthy();
  });
});

void Y;
