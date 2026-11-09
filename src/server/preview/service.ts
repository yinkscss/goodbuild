import "server-only";

import { createHash, createHmac } from "node:crypto";

import { previewLabel, publishedAppUrl } from "@/lib/published-host";
import { loadFiles } from "@/server/agent/store";
import { withCurrentDataHelpers, withCurrentWalletHelpers } from "@/server/agent/template";
import { sessionSecret } from "@/server/auth/config";
import type { Db } from "@/server/db/client";
import type { Project } from "@/server/db/schema";
import { withCurrentAddresses } from "@/server/deploy/addresses";
import { buildPublishedApp, PublishBuildError } from "@/server/publish/build";

import { previewBridge } from "./bridge";
import { getPreview, putPreview } from "./cache";

/**
 * GoodBuild's own preview (D69): the saved project built with the publish bundler and served on a
 * host of its own, so the preview no longer depends on CodeSandbox's bundler or a CDN, and what the
 * owner sees is built the way the published app will be.
 */

const LABEL = "goodbuild/preview-host/v1";

/**
 * The project's preview host token: the same for every build of a project, so the preview keeps
 * its origin (and with it the wallet's permission and anything the app stored in the browser).
 * Derived with a key of its own, never the raw session secret, and not guessable from the project id.
 */
export function previewToken(projectId: string): string {
  const key = createHmac("sha256", Buffer.from(sessionSecret())).update(LABEL).digest();
  return createHmac("sha256", key).update(projectId).digest("hex").slice(0, 32);
}

export class PreviewBuildError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

export interface PreviewInfo {
  url: string;
  /** The preview's origin: the workspace only listens to messages from it. */
  origin: string;
  buildId: string;
  /** False when this call reused the build already in memory. */
  rebuilt: boolean;
}

/** A fingerprint of everything the build depends on. */
function buildIdOf(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const path of Object.keys(files).sort()) hash.update(path).update("\0").update(files[path]).update("\0");
  return hash.digest("hex").slice(0, 16);
}

/** Build the project's saved files (or reuse the build of the same files) and say where it is served. */
export async function buildPreview(db: Db, project: Pick<Project, "id" | "name" | "chainId">, requestHost: string | null, domain: string, deps: { build?: typeof buildPublishedApp } = {}): Promise<PreviewInfo> {
  const saved = await loadFiles(db, project.id);
  if (!("src/App.tsx" in saved)) throw new PreviewBuildError("This project has no app to preview yet.");
  // The same files publishing builds: deployed addresses and today's wallet and data helpers.
  const files = withCurrentWalletHelpers(withCurrentDataHelpers(await withCurrentAddresses(db, project.id, saved)), project.chainId);
  const token = previewToken(project.id);
  const url = publishedAppUrl(previewLabel(token), requestHost, domain);
  const buildId = buildIdOf(files);
  const info = { url: `${url}/?b=${buildId}`, origin: new URL(url).origin, buildId };

  const cached = getPreview(token);
  if (cached && cached.buildId === buildId && cached.projectId === project.id) return { ...info, rebuilt: false };

  try {
    // No assets: the preview host serves uploads straight from the asset store. No WalletConnect and
    // no data id, like the Sandpack preview: browser wallets only, and saved data stays in the browser.
    const built = await (deps.build ?? buildPublishedApp)({ files, assets: [], title: project.name, hasUndeployedContracts: false, preview: { bridge: previewBridge } });
    putPreview(token, project.id, buildId, built);
  } catch (error) {
    if (error instanceof PublishBuildError) throw new PreviewBuildError(error.message, error.details);
    throw error;
  }
  return { ...info, rebuilt: true };
}

/**
 * Headers for a preview file. Like a published app's, except that the workspace may frame it, and
 * nothing is cached or indexed: the address is a private one.
 */
export function previewHeaders(mime: string, size: number, workspaceOrigin: string): Record<string, string> {
  return {
    "Content-Type": mime,
    "Content-Length": String(size),
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https:",
      "font-src 'self' data: https:",
      "img-src 'self' data: https:",
      "connect-src 'self' https: wss:",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      `frame-ancestors ${workspaceOrigin}`,
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  };
}

/** The main site's origin, the only page allowed to frame a preview. */
export function workspaceOrigin(requestHost: string | null, env: NodeJS.ProcessEnv = process.env): string {
  const domain = env.APP_DOMAIN;
  if (domain && env.NODE_ENV === "production" && !/^(localhost|127\.)/.test(domain)) return `https://${domain}`;
  // Development: the main site is the preview host without its label, on the same port.
  const [hostname, port] = (requestHost ?? "localhost").split(":");
  const main = hostname.replace(/^pv-[0-9a-f]{32}\./, "");
  return `http://${main}${port ? `:${port}` : ""}`;
}
