import "server-only";

import type { PublishedFile } from "@/server/publish/build";

/**
 * Built previews, held in the web process's memory (D69). A preview is rebuilt from the saved
 * project in about a second, so nothing here needs to survive a restart: a miss tells the workspace
 * to ask for the build again. Keeping them out of Postgres also keeps megabytes of throwaway
 * bundles out of every backup.
 *
 * One server process only. With more than one web instance this has to become shared storage.
 */

export interface PreviewBuild {
  projectId: string;
  /** Changes with every build, so the workspace can tell a fresh build from a stale one. */
  buildId: string;
  files: Map<string, { mime: string; bytes: Uint8Array }>;
  bytes: number;
  builtAt: number;
  usedAt: number;
}

export const MAX_PREVIEWS = 40;
export const MAX_PREVIEW_BYTES = 200 * 1024 * 1024;
export const PREVIEW_TTL_MS = 2 * 60 * 60 * 1000;

// On globalThis: Next can load a module once per route bundle, and the build route and the serving
// route must see the same map (and hot reload must not empty it).
const store: Map<string, PreviewBuild> = ((globalThis as { __gbPreviews?: Map<string, PreviewBuild> }).__gbPreviews ??= new Map());

function evict(now: number) {
  for (const [token, b] of store) if (now - b.usedAt > PREVIEW_TTL_MS) store.delete(token);
  const total = () => [...store.values()].reduce((sum, b) => sum + b.bytes, 0);
  // Least recently used first.
  const oldest = () => [...store.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)[0]?.[0];
  while (store.size > MAX_PREVIEWS || total() > MAX_PREVIEW_BYTES) {
    const token = oldest();
    if (!token) break;
    store.delete(token);
  }
}

export function putPreview(token: string, projectId: string, buildId: string, files: PublishedFile[], now = Date.now()): PreviewBuild {
  const build: PreviewBuild = {
    projectId,
    buildId,
    files: new Map(files.map((f) => [f.path, { mime: f.mime, bytes: f.bytes }])),
    bytes: files.reduce((sum, f) => sum + f.bytes.length, 0),
    builtAt: now,
    usedAt: now,
  };
  store.set(token, build);
  evict(now);
  return build;
}

export function getPreview(token: string, now = Date.now()): PreviewBuild | undefined {
  const build = store.get(token);
  if (!build) return undefined;
  if (now - build.usedAt > PREVIEW_TTL_MS) {
    store.delete(token);
    return undefined;
  }
  build.usedAt = now;
  return build;
}

/** Tests. */
export function clearPreviews() {
  store.clear();
}
