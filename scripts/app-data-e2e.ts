// End-to-end check of the app data API, against a real production build on Postgres, with real
// signatures from wallets generated here. Nothing touches a network beyond this machine.
//
//   1. Start the server: NODE_ENV=production PUBLISHED_APPS_DOMAIN=localhost APP_DOMAIN=localhost:$PORT
//      SESSION_SECRET=<32+ chars> DATABASE_URL=<throwaway database> GOODBUILD_INLINE_WORKER=0 pnpm start -p $PORT
//   2. PORT=$PORT DATABASE_URL=<same> [PLAYWRIGHT_PATH=<playwright package>] \
//      pnpm exec tsx --require ./scripts/worker-preload.cjs scripts/app-data-e2e.ts
//
// With PLAYWRIGHT_PATH the same flow also runs in Chromium, through the real page and helper.
import http from "node:http";

import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { celoSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";
import { eq, sql } from "drizzle-orm";

import { saveFiles } from "@/server/agent/store";
import { starterFiles } from "@/server/agent/template";
import { DEFAULT_LIMITS } from "@/server/app-data/limits";
import { liveApp, putRecord } from "@/server/app-data/store";
import { signInUser } from "@/server/auth/service";
import { appDataRecords, appDataUsage } from "@/server/db/app-data-schema";
import { getDb } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { buildPublishedApp } from "@/server/publish/build";
import { createProjectFromPrompt } from "@/server/projects";

const PORT = Number(process.env.PORT ?? 3457);
const SLUG = `notes-${Date.now().toString(36)}`;
const SIBLING = `other-${Date.now().toString(36)}`;
const APP_HOST = `${SLUG}.localhost:${PORT}`;
const SIBLING_HOST = `${SIBLING}.localhost:${PORT}`;
const MAIN_HOST = `localhost:${PORT}`;
const V1 = "/__gb/data/v1";

const APP = `import { useState } from "react";
import { useCollection, useDbSession } from "./lib/useDb";
import { deleteMyData } from "./lib/db";
import { errorMessage } from "./lib/format";

export default function App() {
  const session = useDbSession();
  const notes = useCollection<{ text: string }>("notes", { enabled: !!session.wallet, wallet: session.wallet });
  const posts = useCollection<{ text: string }>("posts");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const save = async (what: typeof notes) => {
    setError("");
    try {
      await what.add({ text });
      setText("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <main>
      <p id="who">{session.loading ? "loading" : session.wallet ?? "signed out"}</p>
      <p id="session-error">{session.error}</p>
      <p id="error">{error}</p>
      <button id="sign-in" onClick={() => void session.signIn()}>Sign in</button>
      <button id="sign-out" onClick={() => void session.signOut()}>Sign out</button>
      <input id="text" value={text} onChange={(e) => setText(e.target.value)} />
      <button id="save" onClick={() => void save(notes)}>Save note</button>
      <button id="post" onClick={() => void save(posts)}>Post</button>
      <button id="erase" onClick={() => void deleteMyData().then(() => location.reload())}>Delete my data</button>
      <ul id="notes">{notes.records.map((r) => <li key={r.key}>{r.value.text}</li>)}</ul>
      <ul id="posts">{posts.records.map((r) => <li key={r.key}>{r.value.text}</li>)}</ul>
    </main>
  );
}
`;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures += 1;
}

const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });

/** http.request to 127.0.0.1 with a Host header: Node's fetch can't reach <slug>.localhost reliably. */
function send(host: string, method: string, path: string, options: { cookie?: string; headers?: Record<string, string>; json?: unknown; body?: string } = {}) {
  const body = options.json !== undefined ? JSON.stringify(options.json) : options.body;
  const headers: Record<string, string> = { host, ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.json !== undefined ? { "content-type": "application/json" } : {}), ...options.headers };
  if (body) headers["content-length"] = String(Buffer.byteLength(body));
  return new Promise<{ status: number; text: string; json: () => Record<string, unknown>; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path, headers, agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, text, headers: res.headers, json: () => JSON.parse(text) as Record<string, unknown> });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

const samePage = (host: string) => ({ origin: `http://${host}`, "sec-fetch-site": "same-origin" });

async function signInMain(account: PrivateKeyAccount): Promise<string> {
  const nonceRes = await send(MAIN_HOST, "GET", "/api/auth/nonce");
  const nonceCookie = String(nonceRes.headers["set-cookie"]?.[0] ?? "").split(";")[0];
  const message = createSiweMessage({ address: account.address, chainId: celoSepolia.id, domain: MAIN_HOST, uri: `http://${MAIN_HOST}`, version: "1", nonce: nonceRes.json().nonce as string, issuedAt: new Date() });
  const res = await send(MAIN_HOST, "POST", "/api/auth/verify", {
    cookie: nonceCookie,
    headers: { origin: `http://${MAIN_HOST}`, "sec-fetch-site": "same-origin" },
    json: { message, signature: await account.signMessage({ message }), walletKind: "external", attestation: { ageOk: true, notUsPerson: true } },
  });
  if (res.status !== 200) throw new Error(`main sign-in failed: ${res.status} ${res.text}`);
  return (res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]).filter((c) => c.includes("gb_session=") && !c.endsWith("=")).join("; ");
}

async function signInApp(account: PrivateKeyAccount, host = APP_HOST): Promise<string> {
  const nonce = await send(host, "GET", `${V1}/session/nonce`, { headers: samePage(host) });
  const { domain, uri } = nonce.json() as { domain: string; uri: string };
  check(`sign-in domain is the app's own host (${host})`, domain === host && uri === `http://${host}`, nonce.json());
  const message = createSiweMessage({ address: account.address, chainId: celoSepolia.id, domain, uri, version: "1", nonce: nonce.json().nonce as string, issuedAt: new Date() });
  const res = await send(host, "POST", `${V1}/session`, { headers: samePage(host), json: { message, signature: await account.signMessage({ message }) } });
  if (res.status !== 200) throw new Error(`app sign-in failed: ${res.status} ${res.text}`);
  return String(res.headers["set-cookie"]?.[0]).split(";")[0];
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

async function measure(name: string, count: number, run: (i: number) => Promise<void>) {
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await run(i);
    times.push(performance.now() - start);
  }
  console.log(`TIME  ${name}: p50 ${percentile(times, 50).toFixed(1)} ms, p95 ${percentile(times, 95).toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms (${count} calls)`);
  return percentile(times, 95);
}

async function main() {
  const db = await getDb();
  const owner = privateKeyToAccount(generatePrivateKey());
  const alice = privateKeyToAccount(generatePrivateKey());
  const bob = privateKeyToAccount(generatePrivateKey());

  // --- Publish a real app through the real API ---
  const mainCookie = await signInMain(owner);
  const user = await signInUser(db, { wallet: owner.address, walletKind: "external" });
  const files = { ...starterFiles(), "src/App.tsx": APP, "src/lib/dataRules.json": JSON.stringify({ collections: { notes: "private", posts: "public-read" } }) };
  const project = await createProjectFromPrompt(db, user.id, { prompt: "notes", network: "celo-sepolia" });
  await saveFiles(db, project.id, files);
  const sibling = await createProjectFromPrompt(db, user.id, { prompt: "sibling", network: "celo-sepolia" });
  await saveFiles(db, sibling.id, { ...files, "src/App.tsx": 'export default function App() { return <p id="sibling">other app</p>; }' });
  for (const [id, slug] of [[project.id, SLUG], [sibling.id, SIBLING]]) {
    const res = await send(MAIN_HOST, "POST", `/api/projects/${id}/publish`, { cookie: mainCookie, headers: { origin: `http://${MAIN_HOST}`, "sec-fetch-site": "same-origin" }, json: { slug, confirmed: true } });
    check(`published ${slug}`, res.status === 200, res.text.slice(0, 300));
  }
  const page = await send(APP_HOST, "GET", "/");
  const clientId = page.text.match(/name="goodbuild-data" content="([^"]+)"/)?.[1];
  check("the page carries the public client id", Boolean(clientId), page.text.slice(0, 200));

  // --- The flow ---
  const aliceCookie = await signInApp(alice);
  const bobCookie = await signInApp(bob);
  const cookieFlags = await (async () => {
    const carol = privateKeyToAccount(generatePrivateKey());
    const n = await send(APP_HOST, "GET", `${V1}/session/nonce`);
    const message = createSiweMessage({ address: carol.address, chainId: celoSepolia.id, domain: APP_HOST, uri: `http://${APP_HOST}`, version: "1", nonce: n.json().nonce as string, issuedAt: new Date() });
    const res = await send(APP_HOST, "POST", `${V1}/session`, { headers: samePage(APP_HOST), json: { message, signature: await carol.signMessage({ message }) } });
    return String(res.headers["set-cookie"]?.[0]);
  })();
  check("cookie: __Host-, Secure, HttpOnly, SameSite=Strict, no Domain", /^__Host-gbapp_session=/.test(cookieFlags) && /; Secure/.test(cookieFlags) && /; HttpOnly/.test(cookieFlags) && /SameSite=Strict/.test(cookieFlags) && !/Domain=/i.test(cookieFlags), cookieFlags);

  const saved = await send(APP_HOST, "PUT", `${V1}/c/notes/diary`, { cookie: aliceCookie, headers: samePage(APP_HOST), json: { value: { text: "alice's secret" } } });
  check("wallet A writes", saved.status === 200 && saved.json().owner === alice.address.toLowerCase(), saved.text);
  const read = await send(APP_HOST, "GET", `${V1}/c/notes/diary`, { cookie: aliceCookie, headers: samePage(APP_HOST) });
  check("wallet A reads it back", read.status === 200 && (read.json().value as { text: string }).text === "alice's secret", read.text);
  check("the response can't be cached", String(read.headers["cache-control"]).includes("no-store"), read.headers["cache-control"]);
  check("wallet B is refused A's record by key", (await send(APP_HOST, "GET", `${V1}/c/notes/diary?owner=${alice.address}`, { cookie: bobCookie, headers: samePage(APP_HOST) })).status === 404);
  const bobsList = await send(APP_HOST, "GET", `${V1}/c/notes?owner=${alice.address}`, { cookie: bobCookie, headers: samePage(APP_HOST) });
  check("wallet B sees none of A's records when listing", bobsList.status === 200 && (bobsList.json().records as unknown[]).length === 0, bobsList.text);
  check("no session gets 401", (await send(APP_HOST, "GET", `${V1}/c/notes`)).status === 401);

  // --- Attacks over real HTTP ---
  const siblingPage = { origin: `http://${SIBLING_HOST}`, "sec-fetch-site": "same-site" };
  const csrf = await send(APP_HOST, "POST", `${V1}/c/notes`, { cookie: aliceCookie, headers: { ...siblingPage, "content-type": "text/plain" }, body: JSON.stringify({ value: "csrf" }) });
  check("text/plain POST from a sibling app with A's cookie: 403", csrf.status === 403, csrf.text);
  check("no CORS header on it", csrf.headers["access-control-allow-origin"] === undefined);
  const preflight = await send(APP_HOST, "OPTIONS", `${V1}/c/notes/k`, { headers: { origin: `http://${SIBLING_HOST}`, "access-control-request-method": "PUT" } });
  check("preflight from a sibling app gets no CORS grant", preflight.headers["access-control-allow-origin"] === undefined, preflight.headers);
  check("A's cookie means nothing on the sibling app", (await send(SIBLING_HOST, "GET", `${V1}/c/notes`, { cookie: aliceCookie })).status === 401);
  check("a client id for another app: 403", (await send(APP_HOST, "GET", `${V1}/c/notes`, { cookie: aliceCookie, headers: { "x-gb-client": "gbc_forged" } })).status === 403);
  check("GoodBuild's session cookie gets nothing on an app host", (await send(APP_HOST, "GET", `${V1}/c/notes`, { cookie: mainCookie })).status === 401);
  for (const path of ["/app-data/" + SLUG + "/v1/c/posts", `${V1}/c/posts`]) {
    const res = await send(MAIN_HOST, "GET", path, { cookie: mainCookie });
    check(`main host has no data route at ${path}`, res.status === 404 && !res.text.includes('"records"'), res.status);
  }
  for (const path of ["/api/projects", "/api/auth/session", `/api/projects/${project.id}/app-data`, `/app-data/${SIBLING}/v1/c/posts`, `/published-app/${SIBLING}`]) {
    const res = await send(APP_HOST, "GET", path, { cookie: mainCookie });
    check(`app host can't reach ${path}`, res.status === 404, { status: res.status, body: res.text.slice(0, 100) });
  }
  for (const path of [`${V1}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/api/projects`, `/__gb/data/../../api/projects`, `${V1}/c/..%2f..%2f..%2f${SIBLING}/x`, `/__gb/data/..%2f..%2fapi%2fprojects`, `${V1}/c/notes%00/x`]) {
    const res = await send(APP_HOST, "GET", path, { cookie: mainCookie });
    check(`raw path stays contained: ${path}`, res.status >= 400 && res.status < 500 && !res.text.includes('"projects"'), { status: res.status, body: res.text.slice(0, 100) });
  }
  check("blocked region: 451", (await send(APP_HOST, "GET", `${V1}/c/posts`, { headers: { "cf-ipcountry": "US" } })).status === 451);
  const big = await send(APP_HOST, "PUT", `${V1}/c/notes/big`, { cookie: aliceCookie, headers: samePage(APP_HOST), json: { value: "x".repeat(DEFAULT_LIMITS.maxValueBytes + 1) } });
  check("oversized value: 413 with a clear message", big.status === 413 && big.json().error === "value_too_large", big.text);
  const injection = await send(APP_HOST, "GET", `${V1}/c/x%27%3BDROP%20TABLE%20app_data_records%3B--/k`, { cookie: aliceCookie, headers: samePage(APP_HOST) });
  check("SQL in a collection name is refused", injection.status === 404, injection.status);

  // --- Latency, on this production build and real Postgres ---
  const writes = await measure("write (PUT, new key)", 50, async (i) => {
    const res = await send(APP_HOST, "PUT", `${V1}/c/notes/perf-${i}`, { cookie: aliceCookie, headers: samePage(APP_HOST), json: { value: { text: "x".repeat(200), i } } });
    if (res.status !== 200) throw new Error(`write failed: ${res.status} ${res.text}`);
  });
  const reads = await measure("read one record", 100, async () => {
    const res = await send(APP_HOST, "GET", `${V1}/c/notes/diary`, { cookie: aliceCookie, headers: samePage(APP_HOST) });
    if (res.status !== 200) throw new Error(`read failed: ${res.status}`);
  });
  const lists = await measure("list 50 records", 100, async () => {
    const res = await send(APP_HOST, "GET", `${V1}/c/notes`, { cookie: aliceCookie, headers: samePage(APP_HOST) });
    if (res.status !== 200) throw new Error(`list failed: ${res.status}`);
  });
  check("p95 under 100 ms", Math.max(writes, reads, lists) < 100, { writes, reads, lists });

  let limited: Awaited<ReturnType<typeof send>> | undefined;
  for (let i = 0; i <= DEFAULT_LIMITS.readsPerIpPerMinute && !limited; i++) {
    const res = await send(APP_HOST, "GET", `${V1}/c/posts`, { headers: { "cf-connecting-ip": "203.0.113.9" } });
    if (res.status === 429) limited = res;
  }
  check("the read limit answers 429 with Retry-After", Boolean(limited?.headers["retry-after"]), limited?.status);

  // --- Quotas under real concurrency: Postgres has real parallel connections, unlike PGlite ---
  const app = await liveApp(db, SIBLING);
  if (!app) throw new Error("sibling isn't live");
  const racer = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
  const raced = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => putRecord(db, app, { collection: "race", owner: racer, key: `k${i}`, json: '"v"' }, { ...DEFAULT_LIMITS, maxRowsPerWallet: 7 })));
  check("40 parallel writes against a limit of 7: exactly 7 land", raced.filter((r) => r.status === "fulfilled").length === 7, raced.map((r) => r.status));
  const [counted] = await db.select({ rows: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(size_bytes),0)::int` }).from(appDataRecords).where(eq(appDataRecords.projectId, app.projectId));
  const usage = await db.select().from(appDataUsage).where(eq(appDataUsage.projectId, app.projectId));
  check("usage totals match the rows exactly", usage.every((u) => u.rows === counted.rows && u.bytes === counted.bytes), { counted, usage });

  // --- A real browser, through the real page and helper ---
  if (process.env.PLAYWRIGHT_PATH) await browserPass(alice, bob);
  else console.log("SKIP  browser pass: PLAYWRIGHT_PATH isn't set");

  // --- Owner tools, and deleting ---
  await send(APP_HOST, "PUT", `${V1}/c/notes/kept`, { cookie: bobCookie, headers: samePage(APP_HOST), json: { value: "bob's secret" } });
  const stats = await send(MAIN_HOST, "GET", `/api/projects/${project.id}/app-data`, { cookie: mainCookie });
  check("the owner sees totals only", stats.status === 200 && Number(stats.json().records) > 0 && !stats.text.includes("secret"), stats.text);
  const stranger = await signInMain(privateKeyToAccount(generatePrivateKey()));
  check("another GoodBuild user can't see or delete them", (await send(MAIN_HOST, "GET", `/api/projects/${project.id}/app-data`, { cookie: stranger })).status === 404 && (await send(MAIN_HOST, "DELETE", `/api/projects/${project.id}/app-data`, { cookie: stranger, headers: samePage(MAIN_HOST) })).status === 404);
  check("an app can't call the owner's delete", (await send(MAIN_HOST, "DELETE", `/api/projects/${project.id}/app-data`, { cookie: mainCookie, headers: { origin: `http://${APP_HOST}`, "sec-fetch-site": "same-site" } })).status === 403);
  const erased = await send(MAIN_HOST, "DELETE", `/api/projects/${project.id}/app-data`, { cookie: mainCookie, headers: samePage(MAIN_HOST) });
  check("the owner can delete everything", erased.status === 200 && erased.json().records === 0, erased.text);
  check("sessions went with it", (await send(APP_HOST, "GET", `${V1}/c/notes`, { cookie: aliceCookie })).status === 401);
  await db.delete(projects).where(eq(projects.id, sibling.id));
  const [left] = await db.select({ rows: sql<number>`count(*)::int` }).from(appDataRecords).where(eq(appDataRecords.projectId, sibling.id));
  check("deleting a project removes its records", left.rows === 0, left);

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}

async function browserPass(alice: PrivateKeyAccount, bob: PrivateKeyAccount) {
  type Playwright = { chromium: { launch: (o: object) => Promise<any> } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const loaded = (await import(process.env.PLAYWRIGHT_PATH as string)) as Playwright & { default?: Playwright };
  const browser = await (loaded.default ?? loaded).chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--disable-features=LocalNetworkAccessChecks"] });
  const wallet = async (account: PrivateKeyAccount) => {
    const context = await browser.newContext();
    await context.exposeBinding("__sign", (_source: unknown, hex: `0x${string}`) => account.signMessage({ message: { raw: hex } }));
    await context.addInitScript(`window.ethereum = {
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return ["${account.address}"];
        if (method === "personal_sign") return window.__sign(params[0]);
        if (method === "eth_chainId") return "0x${celoSepolia.id.toString(16)}";
        return null;
      },
      on() {},
      removeListener() {},
    };`);
    return context;
  };

  const url = `http://${APP_HOST}/`;
  const a = await (await wallet(alice)).newPage();
  const errors: string[] = [];
  a.on("pageerror", (e: Error) => errors.push(e.message));
  a.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error" && !/status of 40[134]/.test(m.text())) errors.push(m.text()); });
  await a.goto(url);
  await a.waitForFunction(() => document.querySelector("#who")?.textContent === "signed out");
  await a.click("#sign-in");
  await a.waitForFunction((w: string) => document.querySelector("#who")?.textContent === w, alice.address.toLowerCase(), { timeout: 15000 });
  check("browser: A signs in through the wallet", true);
  const cookies = await a.context().cookies();
  const cookie = cookies.find((c: { name: string }) => c.name === "__Host-gbapp_session");
  check("browser: Chromium kept the cookie, host-only and HttpOnly", Boolean(cookie?.httpOnly) && cookie?.domain === `${SLUG}.localhost`, cookies);
  check("browser: the page's code can't read the cookie", !(await a.evaluate(() => document.cookie)).includes("gbapp_session"));

  await a.fill("#text", "written in the browser");
  await a.click("#save");
  await a.waitForFunction(() => document.querySelector("#notes")?.textContent?.includes("written in the browser"));
  await a.fill("#text", "a public post");
  await a.click("#post");
  await a.waitForFunction(() => document.querySelector("#posts")?.textContent?.includes("a public post"));
  await a.reload();
  await a.waitForFunction(() => document.querySelector("#notes")?.textContent?.includes("written in the browser"));
  check("browser: write, reload, read back", true);

  const b = await (await wallet(bob)).newPage();
  await b.goto(url);
  await b.waitForFunction(() => document.querySelector("#who")?.textContent === "signed out");
  await b.waitForFunction(() => document.querySelector("#posts")?.textContent?.includes("a public post"));
  check("browser: the public post shows with nobody signed in", true);
  await b.click("#sign-in");
  await b.waitForFunction((w: string) => document.querySelector("#who")?.textContent === w, bob.address.toLowerCase(), { timeout: 15000 });
  await b.waitForTimeout(500);
  check("browser: B signed in sees none of A's notes", !(await b.textContent("#notes"))?.includes("written in the browser"), await b.textContent("#notes"));
  const refused = await b.evaluate(async (owner: string) => (await fetch(`/__gb/data/v1/c/notes/diary?owner=${owner}`)).status, alice.address);
  check("browser: B asking for A's record by name gets 404", refused === 404, refused);

  // The real attack: another app's page, in A's own browser, with A's cookie in the jar.
  // Served without the published CSP: over http the CSP would stop the request before it left, while
  // in production it allows any https: address, so only the server's check stands in the way.
  const attacker = await a.context().newPage();
  await attacker.route(`http://${SIBLING_HOST}/`, (route: { fulfill(o: object): unknown }) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>sibling</p>" }));
  const seen: Array<{ method: string; status: number }> = [];
  attacker.on("response", (res: { url(): string; status(): number; request(): { method(): string } }) => {
    if (res.url().includes("/__gb/data/")) seen.push({ method: res.request().method(), status: res.status() });
  });
  await attacker.goto(`http://${SIBLING_HOST}/`);
  // A string, because tsx's transform adds helpers to functions that don't exist in the page.
  const attack = (await attacker.evaluate(`(async () => {
    const target = "http://${APP_HOST}/__gb/data/v1/c/notes";
    const body = JSON.stringify({ value: "planted" });
    const fire = (init) => fetch(target, { credentials: "include", ...init }).then((res) => "status " + res.status, (e) => "blocked: " + e.name);
    return {
      read: await fire({}),
      noCorsWrite: await fire({ method: "POST", mode: "no-cors", headers: { "content-type": "text/plain" }, body }),
      corsWrite: await fire({ method: "POST", headers: { "content-type": "application/json" }, body }),
    };
  })()`)) as { read: string; noCorsWrite: string; corsWrite: string };
  await a.reload();
  await a.waitForFunction(() => document.querySelector("#notes")?.textContent?.includes("written in the browser"));
  await attacker.waitForTimeout(300);
  console.log("INFO  sibling attack, as the browser saw it:", JSON.stringify({ attack, seen }));
  check("browser: a sibling app can't read or plant data with A's cookie", !(await a.textContent("#notes"))?.includes("planted") && attack.read.startsWith("blocked") && attack.corsWrite.startsWith("blocked"), attack);
  const plain = seen.find((r) => r.method === "POST");
  // Playwright doesn't report whether the cookie went with it. The same request with the cookie is checked over HTTP above.
  check("browser: that write really reached the server and got 403", plain?.status === 403, seen);

  await a.click("#sign-out");
  await a.waitForFunction(() => document.querySelector("#who")?.textContent === "signed out");
  check("browser: signing out clears the screen", !(await a.textContent("#notes"))?.includes("written in the browser"));
  await a.click("#sign-in");
  await a.waitForFunction((w: string) => document.querySelector("#who")?.textContent === w, alice.address.toLowerCase());
  await a.click("#erase");
  await a.waitForFunction(() => document.querySelector("#who")?.textContent === "signed out");
  check("browser: Delete my data signs out and removes A's post", !(await a.textContent("#posts"))?.includes("a public post"), await a.textContent("#posts"));
  check("browser: no script or policy errors on the page", errors.length === 0, errors);

  // The preview: the same helper on another origin, with no public id on the page and no server.
  const built = await buildPublishedApp({ files: { ...starterFiles(), "src/App.tsx": APP, "src/lib/dataRules.json": JSON.stringify({ collections: { posts: "public-read" } }) }, assets: [], title: "Preview", hasUndeployedContracts: false });
  const preview = await (await browser.newContext()).newPage();
  const serverCalls: string[] = [];
  await preview.route("https://preview.invalid/**", (route: { request(): { url(): string }; fulfill(o: object): unknown }) => {
    const path = new URL(route.request().url()).pathname.slice(1) || "index.html";
    if (path.startsWith("__gb")) serverCalls.push(path);
    const file = built.find((f) => f.path === path);
    return route.fulfill(file ? { status: 200, contentType: file.mime, body: Buffer.from(file.bytes) } : { status: 404, body: "" });
  });
  await preview.goto("https://preview.invalid/");
  await preview.click("#sign-in");
  await preview.waitForFunction(() => document.querySelector("#who")?.textContent?.startsWith("0x"));
  await preview.fill("#text", "only in this browser");
  await preview.click("#save");
  await preview.waitForFunction(() => document.querySelector("#notes")?.textContent?.includes("only in this browser"));
  await preview.reload();
  await preview.click("#sign-in");
  await preview.waitForFunction(() => document.querySelector("#notes")?.textContent?.includes("only in this browser"));
  check("preview: sign-in, write and reload work with no server, and no request reaches one", serverCalls.length === 0, serverCalls);
  check("preview: the note says the data stays in this browser", Boolean(await preview.textContent("[data-goodbuild-preview-note]")));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
