import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { projectAssets, type ProjectAsset } from "@/server/db/schema";
import {
  MAX_ASSET_BYTES,
  MAX_ASSETS_PER_PROJECT,
  analyseImage,
  assetFileName,
  describePrompt,
  sanitizeSvg,
  sniffType,
  visionImage,
  type AssetInfo,
  type AssetKind,
  type AssetMime,
} from "./assets";
import { TIER_FOR, type ModelClient } from "./model";
import { recordUsage } from "./store";

/**
 * Where asset bytes live. The DB implementation is for development and small deployments;
 * object storage (S3, R2) implements the same interface later without touching callers.
 */
export interface AssetStore {
  list(projectId: string): Promise<AssetInfo[]>;
  get(projectId: string, id: string): Promise<(AssetInfo & { bytes: Uint8Array }) | null>;
  put(projectId: string, asset: Omit<AssetInfo, "id"> & { bytes: Uint8Array }): Promise<AssetInfo>;
  update(projectId: string, id: string, patch: Partial<Pick<AssetInfo, "description" | "kind">>): Promise<void>;
  remove(projectId: string, id: string): Promise<boolean>;
  /** References whose image the agent hasn't seen yet; marked once a turn attaches them. */
  unattached(projectId: string): Promise<AssetInfo[]>;
  markAttached(projectId: string, ids: string[], messageId: string): Promise<void>;
}

function info(r: ProjectAsset): AssetInfo {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as AssetKind,
    mime: r.mime as AssetMime,
    size: r.size,
    width: r.width,
    height: r.height,
    palette: r.palette ?? [],
    description: r.description,
  };
}

const META = {
  id: projectAssets.id,
  projectId: projectAssets.projectId,
  name: projectAssets.name,
  kind: projectAssets.kind,
  mime: projectAssets.mime,
  size: projectAssets.size,
  width: projectAssets.width,
  height: projectAssets.height,
  palette: projectAssets.palette,
  description: projectAssets.description,
};

export function dbAssetStore(db: Db): AssetStore {
  return {
    async list(projectId) {
      const rows = await db.select(META).from(projectAssets).where(eq(projectAssets.projectId, projectId)).orderBy(asc(projectAssets.createdAt));
      return rows.map((r) => info(r as ProjectAsset));
    },
    async get(projectId, id) {
      const [r] = await db
        .select()
        .from(projectAssets)
        .where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.id, id)))
        .limit(1);
      return r ? { ...info(r), bytes: r.bytes } : null;
    },
    async put(projectId, a) {
      const [r] = await db
        .insert(projectAssets)
        .values({ projectId, name: a.name, kind: a.kind, mime: a.mime, bytes: a.bytes, size: a.size, width: a.width, height: a.height, palette: a.palette, description: a.description })
        .returning(META);
      return info(r as ProjectAsset);
    },
    async update(projectId, id, patch) {
      await db.update(projectAssets).set(patch).where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.id, id)));
    },
    async remove(projectId, id) {
      const rows = await db.delete(projectAssets).where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.id, id))).returning({ id: projectAssets.id });
      return rows.length > 0;
    },
    async unattached(projectId) {
      const rows = await db
        .select(META)
        .from(projectAssets)
        .where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.kind, "reference"), isNull(projectAssets.attachedAt)))
        .orderBy(asc(projectAssets.createdAt));
      return rows.map((r) => info(r as ProjectAsset));
    },
    async markAttached(projectId, ids, messageId) {
      for (const id of ids) {
        await db.update(projectAssets).set({ attachedAt: messageId }).where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.id, id)));
      }
    },
  };
}

export class AssetRejected extends Error {}

/**
 * Validate, analyse, describe and store one upload. Type comes from the bytes; SVGs are
 * sanitised before anything parses them. The description call (cheap model, which reads
 * images) is best effort: an upload never fails because the model did.
 */
export async function ingestAsset(args: {
  store: AssetStore;
  db: Db;
  model: ModelClient | null;
  projectId: string;
  userId: string;
  fileName: string;
  kind: AssetKind;
  bytes: Uint8Array;
}): Promise<AssetInfo> {
  let bytes = args.bytes;
  if (bytes.length === 0) throw new AssetRejected("The file is empty.");
  if (bytes.length > MAX_ASSET_BYTES) throw new AssetRejected(`Files can be up to ${MAX_ASSET_BYTES / 1_000_000} MB.`);
  const mime = sniffType(bytes);
  if (!mime) throw new AssetRejected("Upload a PNG, JPEG, WebP or SVG image.");
  if (mime === "image/svg+xml") {
    const clean = sanitizeSvg(new TextDecoder().decode(bytes));
    if (!clean.ok) throw new AssetRejected(clean.error);
    bytes = new TextEncoder().encode(clean.svg);
  }
  const existing = await args.store.list(args.projectId);
  if (existing.length >= MAX_ASSETS_PER_PROJECT) throw new AssetRejected(`A project can hold up to ${MAX_ASSETS_PER_PROJECT} files. Delete one first.`);

  let facts: Awaited<ReturnType<typeof analyseImage>>;
  try {
    facts = await analyseImage(bytes);
  } catch {
    throw new AssetRejected("That image couldn't be read. Try exporting it again as PNG.");
  }
  const name = assetFileName(args.fileName, mime, existing.map((a) => a.name));
  const description = args.model ? await describeImage(args, bytes, mime, name).catch(() => "") : "";
  return args.store.put(args.projectId, { name, kind: args.kind, mime, bytes, size: bytes.length, ...facts, description });
}

async function describeImage(
  args: { db: Db; model: ModelClient | null; projectId: string; userId: string; kind: AssetKind },
  bytes: Uint8Array,
  mime: AssetMime,
  name: string,
): Promise<string> {
  if (!args.model) return "";
  const image = await visionImage(bytes, mime);
  let text = "";
  for await (const ev of args.model.stream({
    tier: TIER_FOR.build,
    maxTokens: 700,
    messages: [{ role: "user", content: [{ type: "text", text: describePrompt(args.kind, name) }, { type: "image", ...image }] }],
  })) {
    if (ev.type === "text") text += ev.delta;
    else if (ev.type === "usage") {
      await recordUsage(args.db, {
        userId: args.userId,
        projectId: args.projectId,
        messageId: null,
        callId: ev.callId || `asset:${crypto.randomUUID()}`,
        model: ev.model,
        inputTokens: ev.inputTokens,
        outputTokens: ev.outputTokens,
        cachedInputTokens: ev.cachedInputTokens,
      });
    }
  }
  return text.trim().slice(0, 2000);
}
