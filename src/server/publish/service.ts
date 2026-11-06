import "server-only";

import { randomBytes } from "node:crypto";

import { and, eq, ne } from "drizzle-orm";
import type { PublicClient } from "viem";

import { DATA_RULES_PATH, parseDataRules } from "@/lib/app-data";
import { withCurrentDataHelpers } from "@/server/agent/template";
import { slugFromName, slugProblem } from "@/lib/published-host";
import { dbAssetStore } from "@/server/agent/asset-store";
import { loadFiles } from "@/server/agent/store";
import type { Db } from "@/server/db/client";
import { publicationFiles, publications, type Publication } from "@/server/db/publish-schema";
import type { Project } from "@/server/db/schema";
import { withCurrentAddresses } from "@/server/deploy/addresses";
import { contractState } from "@/server/deploy/contract-state";
import { publicClientFor } from "@/server/deploy/service";
import { hasChangeableContracts } from "@/server/deploy/upgradeable";
import { buildPublishedApp, PublishBuildError, type PublishedFile } from "./build";

export type PublishErrorCode = "invalid_slug" | "reserved_slug" | "slug_taken" | "busy" | "disabled" | "build_failed" | "not_published";

export class PublishError extends Error {
  constructor(
    readonly code: PublishErrorCode,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

function assertSlug(slug: string) {
  const problem = slugProblem(slug);
  if (problem === "invalid") throw new PublishError("invalid_slug", "Use 3 to 40 lowercase letters, numbers or single hyphens, starting and ending with a letter or number.");
  if (problem === "reserved") throw new PublishError("reserved_slug", "That address is reserved. Try another.");
}

export async function slugAvailable(db: Db, slug: string, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: publications.id })
    .from(publications)
    .where(and(eq(publications.slug, slug), ne(publications.projectId, projectId)))
    .limit(1);
  return !row;
}

/**
 * Contracts this code needs that aren't deployed on the project's chain. An address from an older
 * version of the contracts doesn't count: its functions may not match this front end.
 */
export async function undeployedContracts(db: Db, project: Pick<Project, "id" | "chainId">, files: Record<string, string>): Promise<string[]> {
  const { names, live } = await contractState(db, project, files);
  return names.filter((n) => !live.includes(n));
}

export interface PublishStatus {
  slug: string;
  /** Live right now. False if never published, unpublished or taken down. */
  live: boolean;
  disabled: boolean;
  publishedVersion: number | null;
  currentVersion: number;
  /** Contracts that would show the demo notice if published now. */
  undeployed: string[];
  hasApp: boolean;
}

async function suggestedSlug(db: Db, project: Pick<Project, "id" | "name">): Promise<string> {
  const base = slugFromName(project.name);
  if (await slugAvailable(db, base, project.id)) return base;
  return `${base.slice(0, 33).replace(/-+$/, "")}-${project.id.slice(0, 6)}`;
}

async function publicationOf(db: Db, projectId: string): Promise<Publication | undefined> {
  const [row] = await db.select().from(publications).where(eq(publications.projectId, projectId)).limit(1);
  return row;
}

export async function publishStatus(db: Db, project: Project): Promise<PublishStatus> {
  const [row, files] = await Promise.all([publicationOf(db, project.id), loadFiles(db, project.id)]);
  return {
    slug: row?.slug ?? (await suggestedSlug(db, project)),
    live: Boolean(row && !row.unpublishedAt && !row.disabledAt),
    disabled: Boolean(row?.disabledAt),
    publishedVersion: row && !row.unpublishedAt ? row.versionNumber : null,
    currentVersion: project.currentVersion,
    undeployed: await undeployedContracts(db, project, files),
    hasApp: "src/App.tsx" in files,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) => (e as { code?: string } | null)?.code;
  return code(error) === "23505" || code((error as { cause?: unknown } | null)?.cause) === "23505";
}

/** Where a visitor reports this app, on the main site. */
function reportUrl(slug: string): string | undefined {
  const domain = process.env.APP_DOMAIN;
  if (!domain) return undefined;
  return `${/^(localhost|127\.)/.test(domain) ? "http" : "https"}://${domain}/report?app=${slug}`;
}

/** Build the saved version and swap it in. The old files stay live if anything fails. */
export async function publishApp(db: Db, project: Project, slug: string, deps: { build?: typeof buildPublishedApp; client?: Pick<PublicClient, "readContract"> } = {}): Promise<PublishStatus> {
  assertSlug(slug);
  if (project.turnStartedAt) throw new PublishError("busy", "Wait for the build to finish, then publish.");
  const existing = await publicationOf(db, project.id);
  if (existing?.disabledAt) throw new PublishError("disabled", "This app was taken down and can't be published.");
  if (!(await slugAvailable(db, slug, project.id))) throw new PublishError("slug_taken", "That address is taken. Try another.");

  const saved = await loadFiles(db, project.id);
  const { rules: dataRules, issues: ruleIssues } = parseDataRules(saved[DATA_RULES_PATH]);
  if (ruleIssues.length) throw new PublishError("build_failed", "The app's data rules aren't valid.", ruleIssues);
  // Public (docs/APP_DATA.md). Keeps its value across republishing, so a built page never goes stale.
  const clientId = existing?.clientId ?? `gbc_${randomBytes(16).toString("hex")}`;
  const undeployed = await undeployedContracts(db, project, saved);
  // The current data helpers, so an app published from an older project gets today's rules support (D34).
  const files = withCurrentDataHelpers(await withCurrentAddresses(db, project.id, saved));

  const store = dbAssetStore(db);
  const assets: Array<{ name: string; mime: string; bytes: Uint8Array }> = [];
  for (const info of await store.list(project.id)) {
    if (info.kind === "reference") continue;
    const asset = await store.get(project.id, info.id);
    if (asset) assets.push({ name: asset.name, mime: asset.mime, bytes: asset.bytes });
  }

  let built: PublishedFile[];
  try {
    const changeableContract = await hasChangeableContracts(db, project, saved, deps.client ?? publicClientFor(project.chainId));
    built = await (deps.build ?? buildPublishedApp)({ files, assets, title: project.name, reportUrl: reportUrl(slug), hasUndeployedContracts: undeployed.length > 0, dataClientId: clientId, changeableContract });
  } catch (error) {
    if (error instanceof PublishBuildError) throw new PublishError("build_failed", error.message, error.details);
    throw error;
  }

  try {
    await db.transaction(async (tx) => {
      const values = { slug, versionNumber: project.currentVersion, hasUndeployedContracts: undeployed.length > 0, publishedAt: new Date(), unpublishedAt: null, dataRules };
      const [row] = await tx
        .insert(publications)
        .values({ projectId: project.id, clientId, ...values })
        .onConflictDoUpdate({ target: publications.projectId, set: values })
        .returning({ id: publications.id });
      await tx.delete(publicationFiles).where(eq(publicationFiles.publicationId, row.id));
      await tx.insert(publicationFiles).values(built.map((f) => ({ publicationId: row.id, path: f.path, mime: f.mime, bytes: f.bytes })));
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PublishError("slug_taken", "That address is taken. Try another.");
    throw error;
  }
  return publishStatus(db, project);
}

/** Take the app offline and delete its files. The project keeps its address. */
export async function unpublishApp(db: Db, project: Project): Promise<PublishStatus> {
  const existing = await publicationOf(db, project.id);
  if (!existing || existing.unpublishedAt) throw new PublishError("not_published", "This app isn't published.");
  await db.transaction(async (tx) => {
    await tx.update(publications).set({ unpublishedAt: new Date() }).where(eq(publications.id, existing.id));
    await tx.delete(publicationFiles).where(eq(publicationFiles.publicationId, existing.id));
  });
  return publishStatus(db, project);
}

/** One file of a live app, or null if the app or file isn't available. */
export async function publishedFile(db: Db, slug: string, filePath: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const [row] = await db
    .select({ mime: publicationFiles.mime, bytes: publicationFiles.bytes, unpublishedAt: publications.unpublishedAt, disabledAt: publications.disabledAt })
    .from(publications)
    .innerJoin(publicationFiles, eq(publicationFiles.publicationId, publications.id))
    .where(and(eq(publications.slug, slug), eq(publicationFiles.path, filePath)))
    .limit(1);
  if (!row || row.unpublishedAt || row.disabledAt) return null;
  return { mime: row.mime, bytes: row.bytes };
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Google Fonts <link>s are allowed by the design guides; React style props need inline styles.
  "style-src 'self' 'unsafe-inline' https:",
  "font-src 'self' data: https:",
  "img-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Headers for a published file. Hashed bundles never change; HTML must always be revalidated. */
export function publishedHeaders(filePath: string, mime: string, size: number): Record<string, string> {
  const cache = filePath === "index.html" ? "no-cache" : filePath.startsWith("assets/") ? "public, max-age=3600" : "public, max-age=31536000, immutable";
  return {
    "Content-Type": mime,
    "Content-Length": String(size),
    "Cache-Control": cache,
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}
