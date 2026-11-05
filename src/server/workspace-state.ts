import "server-only";

import type { Db } from "@/server/db/client";
import { estimateTurnMicro } from "@/lib/pricing";
import { dbAssetStore } from "@/server/agent/asset-store";
import { publicAssetOrigin, publicAssetUrl } from "@/server/agent/asset-url";
import type { AssetInfo } from "@/server/agent/assets";
import { systemPrompt } from "@/server/agent/prompt";
import { listVersions, loadFiles } from "@/server/agent/store";
import { starterFiles } from "@/server/agent/template";
import { activeJobs } from "@/server/jobs/jobs";
import { getOwnedProject } from "@/server/projects";

export interface WorkspaceMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface WorkspaceState {
  project: { id: string; name: string; status: string; chainId: number; currentVersion: number; building: boolean };
  files: Record<string, string>;
  messages: WorkspaceMessage[];
  versions: Array<{ number: number; summary: string; createdAt: string; revertedFrom: number | null }>;
  /** Preflight estimates in micro-USD (D13). */
  estimate: { buildMicro: number; planMicro: number };
  /**
   * Uploaded logos, images and design references (metadata; bytes via the assets API). `url`
   * is a public signed URL when GoodBuild runs on a public https origin; otherwise the preview
   * inlines data URLs.
   */
  assets: Array<AssetInfo & { url?: string }>;
  /** The running turn and queued follow-ups, oldest first (P18). A reload attaches to the first. */
  jobs: Array<{ id: string; status: "queued" | "running"; userMessageId: string; assistantMessageId: string | null; mode: string }>;
}

/** Everything the workspace needs to render, for the page and for reloads after a turn. */
export async function workspaceState(db: Db, projectId: string, ownerId: string): Promise<WorkspaceState | null> {
  const owned = await getOwnedProject(db, projectId, ownerId);
  if (!owned) return null;
  const { project } = owned;
  const files = await loadFiles(db, projectId);
  const versions = await listVersions(db, projectId);
  const basis = Object.keys(files).length ? files : starterFiles();
  const contextChars = Object.values(basis).reduce((n, c) => n + c.length, 0) + systemPrompt("build").length + 2_000;
  const firstBuild = Object.keys(files).length === 0;
  return {
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      chainId: project.chainId,
      currentVersion: project.currentVersion,
      building: Boolean(project.turnStartedAt),
    },
    files,
    messages: owned.messages.map((m) => ({
      id: m.id,
      role: m.role as WorkspaceMessage["role"],
      content: m.content,
      status: m.status,
      meta: m.meta ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
    versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString(), revertedFrom: v.revertedFrom ?? null })),
    estimate: {
      buildMicro: estimateTurnMicro({ mode: "build", contextChars, firstBuild }),
      planMicro: estimateTurnMicro({ mode: "plan", contextChars, firstBuild }),
    },
    assets: (await dbAssetStore(db).list(projectId)).map((a) => {
      const origin = publicAssetOrigin();
      return origin ? { ...a, url: publicAssetUrl(origin, projectId, a.id) } : a;
    }),
    jobs: (await activeJobs(db, projectId)).map((j) => ({
      id: j.id,
      status: j.status as "queued" | "running",
      userMessageId: j.userMessageId,
      assistantMessageId: j.assistantMessageId,
      mode: j.mode,
    })),
  };
}
