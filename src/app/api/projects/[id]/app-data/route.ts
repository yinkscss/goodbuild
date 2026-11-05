import { NextResponse, connection } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { deleteProjectData, projectDataStats } from "@/server/app-data/store";
import { getDb } from "@/server/db/client";
import type { Project } from "@/server/db/schema";
import { getOwnedProject } from "@/server/projects";

/** Runs only for the project's owner, signed in to GoodBuild itself. An app host can't reach this (proxy.ts). */
async function withProject(ctx: RouteContext<"/api/projects/[id]/app-data">, run: (project: Project) => Promise<Response>) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const owned = await getOwnedProject(await getDb(), id, session.user.id);
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return await run(owned.project);
  } catch (error) {
    return errorResponse(error);
  }
}

/** How much visitors have saved in this app: totals only, never their data. */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/app-data">) {
  await connection();
  return withProject(ctx, async (project) => NextResponse.json(await projectDataStats(await getDb(), project.id), { headers: { "Cache-Control": "no-store" } }));
}

/** Delete everything visitors saved in this app. It can't be undone. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/projects/[id]/app-data">) {
  return withProject(ctx, async (project) => {
    const db = await getDb();
    await deleteProjectData(db, project.id);
    return NextResponse.json(await projectDataStats(db, project.id));
  });
}
