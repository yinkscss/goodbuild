import "server-only";

import { parseSiweMessage } from "viem/siwe";

import { accessFor, COLLECTION_NAME, DATA_CLIENT_HEADER, RECORD_KEY } from "@/lib/app-data";
import { APP_SESSION_COOKIE } from "@/lib/auth/cookie-names";
import { classifyHost, publishedAppUrl, publishedAppsDomain } from "@/lib/published-host";
import { isProduction } from "@/server/auth/config";
import { AuthError } from "@/server/auth/errors";
import { verifySignIn, type VerifySignInInput } from "@/server/auth/siwe";
import type { Db } from "@/server/db/client";
import { effectiveHost } from "@/server/edge";
import { createRateLimiter, limitsFromEnv, type AppDataLimits, type RateLimiter } from "./limits";
import {
  AppDataError,
  SESSION_TTL_SECONDS,
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
  sessionWallet,
  totalStoredBytes,
  usableNonce,
  type LiveApp,
} from "./store";

export { APP_SESSION_COOKIE, createRateLimiter };

export interface AppDataDeps {
  limits?: AppDataLimits;
  rate?: RateLimiter;
  /** Contract-wallet signature check. Defaults to the on-chain one in verifySignIn. */
  verifyContractSignature?: VerifySignInInput["verifyContractSignature"];
  totalBytesCacheMs?: number;
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

function ownerParam(url: URL): string | undefined {
  const owner = url.searchParams.get("owner");
  if (owner === null) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) fail("invalid_owner", 400, "owner must be a wallet address.");
  return owner.toLowerCase();
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

async function viewerOf(ctx: Context): Promise<string | null> {
  return sessionWallet(ctx.db, ctx.app.projectId, readCookie(ctx.request));
}

async function requireViewer(ctx: Context): Promise<string> {
  const wallet = await viewerOf(ctx);
  if (!wallet) fail("unauthenticated", 401, "Connect your wallet and sign in first.");
  return wallet;
}

function limitWrite(ctx: Context, wallet: string) {
  limit(ctx, `w:ip:${ctx.ip}`, ctx.limits.writesPerIpPerMinute);
  limit(ctx, `w:wallet:${ctx.app.projectId}:${wallet}`, ctx.limits.writesPerWalletPerMinute);
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
    return json({ wallet: await viewerOf(ctx) });
  }
  if (method === "POST") return signInRoute(ctx);
  if (method === "DELETE") {
    limit(ctx, `w:ip:${ctx.ip}`, ctx.limits.writesPerIpPerMinute);
    await endSession(ctx.db, ctx.app.projectId, readCookie(ctx.request));
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }
  return fail("method_not_allowed", 405, "That method isn't allowed here.");
}

async function meRoute(ctx: Context, method: string): Promise<Response> {
  if (method !== "DELETE") fail("method_not_allowed", 405, "That method isn't allowed here.");
  const wallet = await requireViewer(ctx);
  limitWrite(ctx, wallet);
  const deleted = await eraseWallet(ctx.db, ctx.app.projectId, wallet);
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
  const wallet = await requireViewer(ctx);
  limitWrite(ctx, wallet);
  const value = await valueFrom(ctx);
  await checkSiteRoom(ctx);
  return json(await putRecord(ctx.db, ctx.app, { collection, owner: wallet, key, json: value }, ctx.limits));
}

async function collectionRoute(ctx: Context, method: string, collection: string): Promise<Response> {
  checkCollection(collection);
  if (method === "POST") return write(ctx, collection, newRecordKey());
  if (method !== "GET") fail("method_not_allowed", 405, "That method isn't allowed here.");
  limit(ctx, `r:ip:${ctx.ip}`, ctx.limits.readsPerIpPerMinute);
  const viewer = await viewerOf(ctx);
  if (!viewer && accessFor(ctx.app.rules, collection) === "private") fail("unauthenticated", 401, "Connect your wallet and sign in first.");
  const owner = ownerParam(ctx.url);
  return json(await listRecords(ctx.db, ctx.app, collection, viewer, { owner, ...pageParams(ctx.url) }));
}

async function recordRoute(ctx: Context, method: string, collection: string, key: string): Promise<Response> {
  checkCollection(collection);
  checkKey(key);
  if (method === "PUT") return write(ctx, collection, key);
  if (method === "DELETE") {
    const wallet = await requireViewer(ctx);
    limitWrite(ctx, wallet);
    // The owner is always the signed-in wallet. Any owner in the request is ignored.
    if (!(await deleteRecord(ctx.db, ctx.app, collection, wallet, key))) fail("not_found", 404, "There's no such record of yours.");
    return json({ ok: true });
  }
  if (method !== "GET") fail("method_not_allowed", 405, "That method isn't allowed here.");
  limit(ctx, `r:ip:${ctx.ip}`, ctx.limits.readsPerIpPerMinute);
  const viewer = await viewerOf(ctx);
  if (!viewer && accessFor(ctx.app.rules, collection) === "private") fail("unauthenticated", 401, "Connect your wallet and sign in first.");
  const owner = ownerParam(ctx.url) ?? viewer ?? fail("invalid_owner", 400, "Say whose record this is with owner=<address>.");
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
