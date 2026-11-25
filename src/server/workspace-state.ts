import "server-only";

import { eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { buildDeliveries, projectAssets, turnJobs, type DeliveryPlan } from "@/server/db/schema";
import { pendingAssetIds } from "@/lib/attachments";
import { estimateTurnMicro } from "@/lib/pricing";
import { dbAssetStore } from "@/server/agent/asset-store";
import { publicAssetOrigin, publicAssetUrl } from "@/server/agent/asset-url";
import type { AssetInfo } from "@/server/agent/assets";
import { MODEL_IDS, TIER_FOR } from "@/server/agent/model";
import { systemPrompt } from "@/server/agent/prompt";
import { listVersions, loadFiles } from "@/server/agent/store";
import { starterFiles, withStarterHelpers } from "@/server/agent/template";
import { activeJobs } from "@/server/jobs/jobs";
import { shouldOfferVerification } from "@/server/credits/cap";
import { freePolicy } from "@/server/credits/free-grants";
import { availableMicro } from "@/server/credits/available";
import { getCredits } from "@/server/credits";
import { contractState } from "@/server/deploy/contract-state";
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
  project: { id: string; name: string; status: string; chainId: number; currentVersion: number; building: boolean; upgradeable: boolean; templateId?: string | null; displayKind?: DeliveryPlan["displayKind"] };
  files: Record<string, string>;
  messages: WorkspaceMessage[];
  versions: Array<{ number: number; summary: string; createdAt: string; revertedFrom: number | null }>;
  /** Preflight estimates in micro-USD (D13). */
  estimate: { buildMicro: number; planMicro: number };
  delivery?: DeliveryPlan;
  /**
   * Uploaded logos, images and design references (metadata; bytes via the assets API). `url`
   * is a public signed URL when GoodBuild runs on a public https origin; otherwise the preview
   * inlines data URLs. `pending`: uploaded since the last message, so it shows above the composer
   * and goes with the next one (a sent file shows in its message instead).
   */
  assets: Array<AssetInfo & { url?: string; pending?: boolean }>;
  /** The running turn and queued follow-ups, oldest first (P18). A reload attaches to the first. */
  /** Deployed contracts whose saved code has changed since, so the chain doesn't have the changes. */
  outdatedContracts: string[];
  /** Of those, the ones behind a proxy: they get the changes at the same address (D33). */
  upgradableContracts: string[];
  /** Used the free AI and verification would unlock more (D30). Under D123: not verified yet. */
  offerVerification: boolean;
  /** D123 ("verified": free credits are grants, shown by FreeCreditsCard) or the D28/D30 allowances ("legacy"). */
  freePolicy: "verified" | "legacy";
  /** Paid credit plus free AI left, in micro-USD (null when the ledger is unreadable). Shown in the header chip. */
  availableMicro: number | null;
  jobs: Array<{ id: string; status: "queued" | "running"; userMessageId: string; assistantMessageId: string | null; mode: string }>;
  /** What GoodBuild remembers about this app (D164): the memory's decisions, which the person can remove. */
  remembered?: string[];
}

/** Everything the workspace needs to render, for the page and for reloads after a turn. */
export async function workspaceState(db: Db, projectId: string, ownerId: string): Promise<WorkspaceState | null> {
  const owned = await getOwnedProject(db, projectId, ownerId);
  if (!owned) return null;
  const { project } = owned;
  const savedFiles = await loadFiles(db, projectId);
  const firstBuild = Object.keys(savedFiles).length === 0;
  const files = firstBuild ? starterFiles(project.chainId) : withStarterHelpers(savedFiles, project.chainId);
  const versions = await listVersions(db, projectId);
  const contextChars = Object.values(files).reduce((n, c) => n + c.length, 0) + systemPrompt("build").length + 2_000;
  const contracts = await contractState(db, project, files);
  const uploaded = await db.select({ id: projectAssets.id, createdAt: projectAssets.createdAt }).from(projectAssets).where(eq(projectAssets.projectId, projectId));
  const pending = pendingAssetIds(
    owned.messages.map((m) => ({ role: m.role, meta: (m.meta as Record<string, unknown> | null) ?? null, createdAt: m.createdAt.toISOString() })),
    uploaded.map((a) => ({ id: a.id, createdAt: a.createdAt.toISOString() })),
  );
  const jobRows = await db.select({ id: turnJobs.id, assistantId: turnJobs.assistantMessageId }).from(turnJobs).where(eq(turnJobs.projectId, projectId));
  const delivery = (await db.select().from(buildDeliveries).where(eq(buildDeliveries.projectId, projectId)))[0]?.plan;
  return {
    project: {
      displayKind: delivery?.displayKind,
      id: project.id,
      name: project.name,
      status: project.status,
      chainId: project.chainId,
      currentVersion: project.currentVersion,
      building: Boolean(project.turnStartedAt),
      upgradeable: contracts.upgradeable,
      templateId: project.templateId,
    },
    files,
    delivery,
    messages: owned.messages.map((m) => ({
      id: m.id,
      role: m.role as WorkspaceMessage["role"],
      content: m.content,
      status: m.status,
      meta: m.role === "assistant" && m.meta?.kind === "turn" ? { ...m.meta, jobId: jobRows.find((j) => j.assistantId === m.id)?.id ?? m.meta.jobId } : m.meta ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
    versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString(), revertedFrom: v.revertedFrom ?? null })),
    outdatedContracts: contracts.outdated,
    upgradableContracts: contracts.upgradable,
    offerVerification: await shouldOfferVerification(db, ownerId),
    freePolicy: freePolicy(process.env),
    remembered: ((project.memory as { decisions?: string[] } | null)?.decisions ?? []).slice(0, 15),
    availableMicro: await availableMicro(db, ownerId, (await getCredits(ownerId, db)).balanceMicro),
    estimate: {
      buildMicro: estimateTurnMicro({ mode: "build", contextChars, firstBuild }, firstBuild ? MODEL_IDS[TIER_FOR.build] : undefined),
      planMicro: estimateTurnMicro({ mode: "plan", contextChars, firstBuild }),
    },
    assets: (await dbAssetStore(db).list(projectId)).map((a) => {
      const origin = publicAssetOrigin();
      return { ...a, ...(origin ? { url: publicAssetUrl(origin, projectId, a.id) } : {}), pending: pending.has(a.id) };
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
