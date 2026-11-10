import "server-only";

import { parseSiweMessage } from "viem/siwe";

import { randomUUID } from "node:crypto";

import { COLLECTION_NAME, DATA_CLIENT_HEADER, MAX_WHERE, RECORD_KEY, normalizeEmail, parseClause, ruleFor, type CollectionRule, type RecordQuery } from "@/lib/app-data";
import { APP_SESSION_COOKIE } from "@/lib/auth/cookie-names";
import { classifyHost, publishedAppUrl, publishedAppsDomain } from "@/lib/published-host";
import { isProduction } from "@/server/auth/config";
import { AuthError } from "@/server/auth/errors";
import { verifySignIn, type VerifySignInInput } from "@/server/auth/siwe";
import type { Db } from "@/server/db/client";
import { effectiveHost } from "@/server/edge";
import { emailSender, requestEmailCode, verifyEmailCode, type EmailSender } from "./email";
import { createRateLimiter, limitsFromEnv, type AppDataLimits, type RateLimiter } from "./limits";
import {
  ANON_PREFIX,
  AppDataError,
  SESSION_TTL_SECONDS,
  canCreate,
  consumeNonce,
  createNonce,
  createSession,
  deleteRecord,
  endSession,
  eraseWallet,
  getRecord,
  listRecords,
  liveApp,
  newRecordKey,
  putRecord,
  sessionEmail,
  sessionWallet,
  totalStoredBytes,
  usableNonce,
  viewerFor,
  type LiveApp,
  type Viewer,
} from "./store";

export { APP_SESSION_COOKIE, createRateLimiter };

export interface AppDataDeps {
  limits?: AppDataLimits;
  rate?: RateLimiter;
  /** Contract-wallet signature check. Defaults to the on-chain one in verifySignIn. */
  verifyContractSignature?: VerifySignInInput["verifyContractSignature"];
  totalBytesCacheMs?: number;
  /** Sends sign-in emails (D35). Defaults to Resend, or the server log in development. */
  sendEmail?: EmailSender | null;
}

const defaultRate = createRateLimiter();

const ERROR_HEADERS = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...ERROR_HEADERS, ...headers } });
}

function fail(code: string, status: number, message: string): never {
  throw new AppDataError(code, status, message);
}

/**
 * The page making this request must be the app itself. Other apps are same-site, so the browser
 * sends the visitor's cookie with their requests whatever SameSite says. Requests with neither
 * header aren't from a browser page and carry no ambient cookie.
 */
function isForeignPage(request: Request, host: string): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** Read a body up to a limit, whatever Content-Length claims. Null if it is too long. */
async function readBody(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requireJson(request: Request) {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") fail("unsupported_media_type", 415, "Send this as application/json.");
}

function parseObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("invalid_body", 400, "The request body isn't valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("invalid_body", 400, "The request body must be a JSON object.");
  return parsed as Record<string, unknown>;
}

function clientIp(headers: Headers): string {
  // The firewall lets only Cloudflare reach the server, so its header is the visitor's address.
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function readCookie(request: Request): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === APP_SESSION_COOKIE) return part.slice(at + 1).trim();
  }
  return undefined;
}

function sessionCookie(value: string, maxAge: number): string {
  // No Domain: the cookie stays on this app's host. In production __Host- makes the browser enforce that.
  return `${APP_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isProduction() ? "; Secure" : ""}`;
}

function checkCollection(name: string) {
  if (!COLLECTION_NAME.test(name)) fail("invalid_collection", 400, "Collection names use lowercase letters, numbers, - and _, start with a letter, and have at most 48 characters.");
}

function checkKey(key: string) {
  if (!RECORD_KEY.test(key)) fail("invalid_key", 400, "Keys use letters, numbers, _ . : and -, start with a letter or number, and have at most 128 characters.");
}

const ANON_ID = /^(anon|email):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whose record: a wallet, or an anonymous visitor's id as the API showed it. */
function ownerParam(url: URL): string | undefined {
  const owner = url.searchParams.get("owner");
  if (owner === null) return undefined;
  if (/^0x[0-9a-fA-F]{40}$/.test(owner)) return owner.toLowerCase();
  if (ANON_ID.test(owner)) return owner;
  return fail("invalid_owner", 400, "owner must be a wallet address.");
}

function pageParams(url: URL): { limit: number; cursor?: number } {
  const rawLimit = url.searchParams.get("limit");
  const rawCursor = url.searchParams.get("cursor");
  if (rawLimit !== null && !/^[0-9]{1,3}$/.test(rawLimit)) fail("invalid_limit", 400, "limit must be a number from 1 to 100.");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (limit < 1 || limit > 100) fail("invalid_limit", 400, "limit must be a number from 1 to 100.");
  if (rawCursor !== null && !/^[0-9]{1,15}$/.test(rawCursor)) fail("invalid_cursor", 400, "That cursor isn't valid.");
  return { limit, cursor: rawCursor === null ? undefined : Number(rawCursor) };
}

/** where=field~op~value (up to four), order=field, dir=asc|desc, since=<ms>: the list's query (D79). */
function queryParams(url: URL): RecordQuery | undefined {
  const rawWhere = url.searchParams.getAll("where");
  const order = url.searchParams.get("order");
  const dir = url.searchParams.get("dir");
  const since = url.searchParams.get("since");
  if (!rawWhere.length && order === null && dir === null && since === null) return undefined;
  if (rawWhere.length > MAX_WHERE) fail("invalid_query", 400, `Use at most ${MAX_WHERE} where filters.`);
  const where = rawWhere.map((w) => {
    const c = parseClause(w);
    return typeof c === "string" ? fail("invalid_query", 400, c) : c;
  });
  if (order !== null && !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(order)) fail("invalid_query", 400, "order must be a field name, or createdAt or updatedAt.");
  if (dir !== null && dir !== "asc" && dir !== "desc") fail("invalid_query", 400, "dir must be asc or desc.");
  if (since !== null && !/^[0-9]{1,15}$/.test(since)) fail("invalid_query", 400, "since must be a time in milliseconds.");
  return { where, ...(order !== null ? { order: { field: order, dir: (dir ?? "desc") as "asc" | "desc" } } : {}), ...(since !== null ? { since: Number(since) } : {}) };
}

interface Context {
  db: Db;
  app: LiveApp;
  request: Request;
  url: URL;
  host: string;
  slug: string;
  ip: string;
  limits: AppDataLimits;
  rate: RateLimiter;
  deps: AppDataDeps;
}

function limit(ctx: Context, key: string, perMinute: number) {
  const retry = ctx.rate.hit(key, perMinute);
  if (retry) throw new AppDataError("rate_limited", 429, "Too many requests. Wait a moment and try again.", retry);
}

/** The session's subject: a wallet, or an anonymous visitor (D34). */
async function viewerOf(ctx: Context): Promise<Viewer | null> {
  return viewerFor(ctx.app, await sessionWallet(ctx.db, ctx.app.projectId, readCookie(ctx.request)));
}

async function requireViewer(ctx: Context): Promise<Viewer> {
  const viewer = await viewerOf(ctx);
  if (!viewer) fail("unauthenticated", 401, "Connect your wallet and sign in first.");
  return viewer;
}

function limitWrite(ctx: Context, viewer: Viewer) {
  limit(ctx, `w:ip:${ctx.ip}`, ctx.limits.writesPerIpPerMinute);
  limit(ctx, `w:wallet:${ctx.app.projectId}:${viewer.subject}`, ctx.limits.writesPerWalletPerMinute);
  if (!viewer.signedIn) {
    limit(ctx, `w:anon-ip:${ctx.ip}`, ctx.limits.anonWritesPerIpPerMinute);
    limit(ctx, `w:anon-project:${ctx.app.projectId}`, ctx.limits.anonWritesPerProjectPerMinute);
  }
}

/** Can someone with no session see anything here? If not, they're asked to sign in. */
function openToVisitors(rule: CollectionRule): boolean {
  return rule.read.includes("anyone") || rule.public.length > 0;
}

// --- Routes ------------------------------------------------------------------

async function nonceRoute(ctx: Context): Promise<Response> {
  limit(ctx, `n:ip:${ctx.ip}`, ctx.limits.noncesPerIpPerMinute);
  limit(ctx, `n:project:${ctx.app.projectId}`, ctx.limits.noncesPerProjectPerMinute);
  const { nonce, expiresAt } = await createNonce(ctx.db, ctx.app.projectId);
  const uri = publishedAppUrl(ctx.slug, ctx.host, publishedAppsDomain());
  return json({ nonce, domain: new URL(uri).host, uri, expiresAt });
}

async function signInRoute(ctx: Context): Promise<Response> {
  limit(ctx, `s:ip:${ctx.ip}`, ctx.limits.signInsPerIpPerMinute);
  requireJson(ctx.request);
  const text = await readBody(ctx.request, ctx.limits.maxSignInBodyBytes);
  if (text === null) fail("body_too_large", 413, "That sign-in request is too large.");
  const body = parseObject(text);
  const { message, signature } = body;
  if (typeof message !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]*$/.test(signature)) {
    fail("invalid_body", 400, "Send the signed message and its signature.");
  }

  const parsed = parseSiweMessage(message);
  if (!parsed.nonce) fail("message_invalid", 401, "That sign-in message isn't valid.");
  const nonce = await usableNonce(ctx.db, ctx.app.projectId, parsed.nonce);
  if (!nonce) fail("nonce_invalid", 401, "That sign-in has expired. Try again.");

  const uri = publishedAppUrl(ctx.slug, ctx.host, publishedAppsDomain());
  let wallet: string;
  try {
    const verified = await verifySignIn({
      message,
      signature: signature as `0x${string}`,
      expectedNonce: nonce,
      // From configuration and the checked slug, never from a header the caller controls.
      expectedDomain: new URL(uri).host,
      verifyContractSignature: ctx.deps.verifyContractSignature,
    });
    wallet = verified.address.toLowerCase();
  } catch (error) {
    if (error instanceof AuthError) fail(error.code, 401, "That signature wasn't accepted. Try signing in again.");
    throw error;
  }
  let signedFor: string | null = null;
  try {
    signedFor = parsed.uri ? new URL(parsed.uri).origin : null;
  } catch {
    // reported below
  }
  if (signedFor !== new URL(uri).origin) fail("uri_mismatch", 401, "That signature wasn't made for this app.");

  // Only now, after every check, so one nonce gives at most one session.
  if (!(await consumeNonce(ctx.db, ctx.app.projectId, nonce))) fail("nonce_invalid", 401, "That sign-in has already been used. Try again.");
  const session = await createSession(ctx.db, ctx.app.projectId, wallet);
  return json({ wallet, expiresAt: session.expiresAt }, 200, { "Set-Cookie": sessionCookie(session.token, SESSION_TTL_SECONDS) });
}

async function sessionRoute(ctx: Context, method: string): Promise<Response> {
  if (method === "GET") {
    limit(ctx, `r:ip:${ctx.ip}`, ctx.limits.readsPerIpPerMinute);
    const viewer = await viewerOf(ctx);
    // An anonymous visitor isn't signed in. `owner` lets the app show its owner view. An email
    // visitor gets their own address back, never their id, and `wallet` stays null for them.
    const isWallet = Boolean(viewer?.signedIn && viewer.subject.startsWith("0x"));
    const email = viewer?.signedIn && !isWallet ? await sessionEmail(ctx.db, ctx.app.projectId, readCookie(ctx.request)) : null;
    return json({ wallet: isWallet ? viewer!.subject : null, email, signedIn: Boolean(viewer?.signedIn), owner: Boolean(viewer?.isOwner), emailSignIn: ctx.app.emailSignIn });
  }
  if (method === "POST") return signInRoute(ctx);
  if (method === "DELETE") {
    limit(ctx, `w:ip:${ctx.ip}`, ctx.limits.writesPerIpPerMinute);
    await endSession(ctx.db, ctx.app.projectId, readCookie(ctx.request));
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }
  return fail("method_not_allowed", 405, "That method isn't allowed here.");
}

async function emailBody(ctx: Context): Promise<Record<string, unknown>> {
  requireJson(ctx.request);
  const text = await readBody(ctx.request, 2048);
  if (text === null) fail("body_too_large", 413, "That request is too large.");
  return parseObject(text);
}

/** Send a sign-in code (D35). Honest about every refusal, because there are no accounts to discover. */
async function emailCodeRoute(ctx: Context): Promise<Response> {
  if (!ctx.app.emailSignIn) fail("email_not_enabled", 404, "This app doesn't offer email sign-in.");
  limit(ctx, `e:ip:${ctx.ip}`, ctx.limits.emailCodesPerIpPerMinute);
  limit(ctx, `e:project:${ctx.app.projectId}`, ctx.limits.emailCodesPerProjectPerMinute);
  const email = normalizeEmail((await emailBody(ctx)).email);
  if (!email) fail("invalid_email", 400, "Enter one email address, like ada@example.com.");
  await checkSiteRoom(ctx);
  const send = ctx.deps.sendEmail === undefined ? emailSender() : ctx.deps.sendEmail;
  const { expiresAt } = await requestEmailCode(ctx.db, ctx.app, { email, ip: ctx.ip, appHost: new URL(publishedAppUrl(ctx.slug, ctx.host, publishedAppsDomain())).host }, ctx.limits, send);
  return json({ sent: true, expiresAt });
}

async function emailVerifyRoute(ctx: Context): Promise<Response> {
  if (!ctx.app.emailSignIn) fail("email_not_enabled", 404, "This app doesn't offer email sign-in.");
  limit(ctx, `ev:ip:${ctx.ip}`, ctx.limits.emailVerifiesPerIpPerMinute);
  const body = await emailBody(ctx);
  const email = normalizeEmail(body.email);
  if (!email) fail("invalid_email", 400, "Enter one email address, like ada@example.com.");
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  const subject = await verifyEmailCode(ctx.db, ctx.app, { email, code }, ctx.limits);
  // An anonymous session ends here. What it sent stays with that browser's old id (docs/APP_DATA.md).
  await endSession(ctx.db, ctx.app.projectId, readCookie(ctx.request));
  const session = await createSession(ctx.db, ctx.app.projectId, subject, new Date(), email);
  return json({ email, expiresAt: session.expiresAt }, 200, { "Set-Cookie": sessionCookie(session.token, SESSION_TTL_SECONDS) });
}

async function meRoute(ctx: Context, method: string): Promise<Response> {
  if (method !== "DELETE") fail("method_not_allowed", 405, "That method isn't allowed here.");
  const viewer = await requireViewer(ctx);
  limitWrite(ctx, viewer);
  const deleted = await eraseWallet(ctx.db, ctx.app.projectId, viewer.subject);
  return json({ deleted }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

/** The value as JSON text, within the size limit. Re-serialised, so what's stored is what was parsed. */
async function valueFrom(ctx: Context): Promise<string> {
  requireJson(ctx.request);
  const tooLarge = () => fail("value_too_large", 413, `That value is too large. The limit is ${Math.floor(ctx.limits.maxValueBytes / 1024)} KB.`);
  const text = await readBody(ctx.request, ctx.limits.maxValueBytes + 1024);
  if (text === null) tooLarge();
  const body = parseObject(text as string);
  if (!Object.hasOwn(body, "value")) fail("invalid_body", 400, 'Send {"value": ...}.');
  let serialised: string;
  try {
    serialised = JSON.stringify(body.value);
  } catch {
    fail("invalid_body", 400, "That value can't be stored.");
  }
  if (Buffer.byteLength(serialised) > ctx.limits.maxValueBytes) tooLarge();
  return serialised;
}

async function checkSiteRoom(ctx: Context) {
  const total = await ctx.rate.cached("total-bytes", ctx.deps.totalBytesCacheMs ?? 60_000, () => totalStoredBytes(ctx.db));
  if (total >= ctx.limits.maxTotalBytes) fail("storage_full", 507, "GoodBuild's app storage is full right now, so nothing new can be saved.");
}

async function write(ctx: Context, collection: string, key: string): Promise<Response> {
  const rule = ruleFor(ctx.app.rules, collection);
  let viewer = await viewerOf(ctx);
  if (!viewer && rule.create === "anyone") {
    // A visitor who didn't sign in gets an id of their own, separate from the cookie's secret, so they can see what they sent.
    viewer = { subject: `${ANON_PREFIX}${randomUUID()}`, signedIn: false, isOwner: false };
    limitWrite(ctx, viewer);
    const value = await valueFrom(ctx);
    await checkSiteRoom(ctx);
    const record = await putRecord(ctx.db, ctx.app, { collection, owner: viewer.subject, key, json: value }, ctx.limits, new Date(), viewer);
    const session = await createSession(ctx.db, ctx.app.projectId, viewer.subject);
    return json(record, 200, { "Set-Cookie": sessionCookie(session.token, SESSION_TTL_SECONDS) });
  }
  if (!viewer) fail("unauthenticated", 401, "Connect your wallet and sign in first.");
  if (!canCreate(rule, viewer) && rule.create === "owner") fail("forbidden", 403, "Only this app's owner can add records here.");
  limitWrite(ctx, viewer);
  const value = await valueFrom(ctx);
  await checkSiteRoom(ctx);
  return json(await putRecord(ctx.db, ctx.app, { collection, owner: viewer.subject, key, json: value }, ctx.limits, new Date(), viewer));
}

async function collectionRoute(ctx: Context, method: string, collection: string): Promise<Response> {
  checkCollection(collection);
  if (method === "POST") return write(ctx, collection, newRecordKey());
  if (method !== "GET") fail("method_not_allowed", 405, "That method isn't allowed here.");
  // A ceiling per address first, then the real limit: per signed-in person (players behind one mobile
  // network share an address, D79), or per address in this app for visitors who aren't signed in.
  limit(ctx, `r:ip-all:${ctx.ip}`, ctx.limits.listsPerIpCeilingPerMinute);
  const viewer = await viewerOf(ctx);
  const who = viewer?.signedIn ? `viewer:${ctx.app.projectId}:${viewer.subject}` : `ip:${ctx.app.projectId}:${ctx.ip}`;
  limit(ctx, `r:${who}`, ctx.limits.readsPerIpPerMinute);
  if (!viewer && !openToVisitors(ruleFor(ctx.app.rules, collection))) fail("unauthenticated", 401, "Connect your wallet and sign in first.");
  const owner = ownerParam(ctx.url);
  const query = queryParams(ctx.url);
  const page = pageParams(ctx.url);
  if (query) {
    if (page.cursor !== undefined) fail("invalid_cursor", 400, "A list with filters, an order or since can't be paged with a cursor. Raise limit or narrow the filters.");
    limit(ctx, `q:${who}`, ctx.limits.queriesPerIpPerMinute);
  }
  return json(await listRecords(ctx.db, ctx.app, collection, viewer, { owner, ...page, query }));
}

async function recordRoute(ctx: Context, method: string, collection: string, key: string): Promise<Response> {
  checkCollection(collection);
  checkKey(key);
  if (method === "PUT") return write(ctx, collection, key);
  if (method === "DELETE") {
    const viewer = await requireViewer(ctx);
    limitWrite(ctx, viewer);
    const rule = ruleFor(ctx.app.rules, collection);
    // Someone else's record only for the app's owner, and only where the rule lets them. Otherwise it's always your own.
    const named = ownerParam(ctx.url);
    const target = named && named !== viewer.subject && viewer.isOwner && rule.delete.includes("owner") ? named : viewer.subject;
    if (target === viewer.subject && !rule.delete.includes("writer") && !(viewer.isOwner && rule.delete.includes("owner"))) fail("forbidden", 403, "Records here can't be deleted.");
    if (!(await deleteRecord(ctx.db, ctx.app, collection, target, key))) fail("not_found", 404, "There's no such record of yours.");
    return json({ ok: true });
  }
  if (method !== "GET") fail("method_not_allowed", 405, "That method isn't allowed here.");
  limit(ctx, `r:ip:${ctx.ip}`, ctx.limits.readsPerIpPerMinute);
  const viewer = await viewerOf(ctx);
  if (!viewer && !openToVisitors(ruleFor(ctx.app.rules, collection))) fail("unauthenticated", 401, "Connect your wallet and sign in first.");
  const owner = ownerParam(ctx.url) ?? viewer?.subject ?? fail("invalid_owner", 400, "Say whose record this is with owner=<address>.");
  // A private record of someone else's looks the same as one that doesn't exist.
  const record = await getRecord(ctx.db, ctx.app, collection, owner, key, viewer);
  return record ? json(record) : fail("not_found", 404, "There's no such record.");
}

function route(ctx: Context, method: string, path: string[]): Promise<Response> {
  const [version, section, a, b, ...extra] = path;
  if (version !== "v1" || extra.length) fail("not_found", 404, "There's nothing here.");
  if (section === "session" && a === undefined) return sessionRoute(ctx, method);
  if (section === "session" && a === "nonce" && b === undefined) {
    if (method !== "GET") fail("method_not_allowed", 405, "That method isn't allowed here.");
    return nonceRoute(ctx);
  }
  if (section === "session" && a === "email" && (b === undefined || b === "verify")) {
    if (method !== "POST") fail("method_not_allowed", 405, "That method isn't allowed here.");
    return b === "verify" ? emailVerifyRoute(ctx) : emailCodeRoute(ctx);
  }
  if (section === "me" && a === undefined) return meRoute(ctx, method);
  if (section === "c" && a && b === undefined) return collectionRoute(ctx, method, a);
  if (section === "c" && a && b) return recordRoute(ctx, method, a, b);
  return fail("not_found", 404, "There's nothing here.");
}

/**
 * The data API of one published app. The tenant comes only from the Host, checked against the
 * rewrite's slug; nothing in the request can name another project. See docs/APP_DATA.md.
 */
export async function handleAppData(db: Db, request: Request, target: { slug: string; path: string[] }, deps: AppDataDeps = {}): Promise<Response> {
  try {
    const hostHeader = effectiveHost(request.headers);
    const kind = classifyHost(hostHeader, publishedAppsDomain());
    if (kind.kind !== "app" || kind.slug !== target.slug) return json({ error: "not_found", message: "There's nothing here." }, 404);
    const host = hostHeader as string;

    if (isForeignPage(request, host)) fail("forbidden_origin", 403, "Only this app's own pages can use its data.");

    const app = await liveApp(db, target.slug);
    if (!app) fail("app_unavailable", 404, "This app isn't available.");

    // Public, so this only catches a build talking to the wrong app. It grants nothing (docs/APP_DATA.md).
    const client = request.headers.get(DATA_CLIENT_HEADER);
    if (client !== null && client !== app.clientId) fail("client_mismatch", 403, "This request names a different app.");

    const limits = deps.limits ?? limitsFromEnv();
    const rate = deps.rate ?? defaultRate;
    const ctx: Context = { db, app, request, url: new URL(request.url), host, slug: target.slug, ip: clientIp(request.headers), limits, rate, deps };
    limit(ctx, `project:${app.projectId}`, limits.requestsPerProjectPerMinute);
    return await route(ctx, request.method, target.path);
  } catch (error) {
    if (error instanceof AppDataError) {
      return json({ error: error.code, message: error.message }, error.status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {});
    }
    // No request data in the log: values are other people's.
    console.error("app data request failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "internal_error", message: "Something went wrong. Try again." }, 500);
  }
}
