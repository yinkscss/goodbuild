import { inArray } from "drizzle-orm";
import { buildDeliveries } from "./db/schema";
import { cache } from "react";
import { redirect } from "next/navigation";

import type { ProjectSummary } from "@/components/home/projects";
import { inferKind } from "@/lib/contract-kind";
import { currentSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { listProjects } from "@/server/projects";

/** One session lookup per request, shared by every section of a signed-in page. Signed out goes to the landing page. */
export const loadSession = cache(async () => {
  const session = await currentSession();
  if (!session) redirect("/");
  return session;
});

/** One projects query per request, shared by the page and the sidebar's recent builds. */
export const loadProjects = cache(async (): Promise<{ projects: ProjectSummary[] } | { error: string }> => {
  const session = await loadSession();
  try {
    const db = await getDb();
    const rows = await listProjects(db, session.user.id, 500);
    const plans = rows.length ? await db.select().from(buildDeliveries).where(inArray(buildDeliveries.projectId,rows.map(p=>p.id))) : [];
    const kinds = new Map(plans.map(p=>[p.projectId,p.plan.displayKind]));
    return {
      projects: rows.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        chainId: p.chainId,
        updatedAt: p.updatedAt,
        kind: inferKind({ templateId: p.templateId, text: p.name, displayKind:kinds.get(p.id) }),
      })),
    };
  } catch (error) {
    console.error(error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
});
