import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { sessionSecret } from "@/server/auth/config";

/**
 * Public, unguessable URLs for uploaded assets, so a deployed GoodBuild (https) can let the
 * Sandpack preview load images directly instead of inlining data URLs (P17).
 *
 * Token = base64url("<projectId>.<assetId>") + "." + HMAC-SHA256 over it, keyed with a key
 * derived from SESSION_SECRET under its own label (never the raw secret). Asset bytes never
 * change after upload (re-classifying changes only kind and description), so the asset id is
 * the content version and responses can be cached as immutable.
 */
const LABEL = "goodbuild/asset-url/v1";

function key(): Buffer {
  return createHmac("sha256", Buffer.from(sessionSecret())).update(LABEL).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function assetToken(projectId: string, assetId: string): string {
  const payload = Buffer.from(`${projectId}.${assetId}`).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyAssetToken(token: string): { projectId: string; assetId: string } | null {
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [projectId, assetId] = Buffer.from(payload, "base64url").toString("utf8").split(".");
  const uuid = /^[0-9a-f-]{36}$/i;
  return uuid.test(projectId ?? "") && uuid.test(assetId ?? "") ? { projectId, assetId } : null;
}

/**
 * The origin previews can load assets from, or null to inline data URLs. Only a configured
 * public https deployment qualifies: APP_DOMAIN set, production, not localhost. (https on
 * localhost still fails Chrome's local-network rules from Sandpack's public origin.)
 */
export function publicAssetOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const domain = env.PUBLIC_ASSET_ORIGIN?.replace(/\/+$/, "") || (env.APP_DOMAIN ? `https://${env.APP_DOMAIN}` : "");
  if (!domain || env.NODE_ENV !== "production") return null;
  let url: URL;
  try {
    url = new URL(domain);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(url.hostname) || url.hostname.endsWith(".localhost")) return null;
  return url.origin;
}

export function publicAssetUrl(origin: string, projectId: string, assetId: string): string {
  return `${origin}/a/${assetToken(projectId, assetId)}`;
}
