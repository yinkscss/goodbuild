import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { publicDeployment } from "@/server/deploy/service";
import { verifyDeployment } from "@/server/deploy/verify";
import { getOwnedProject } from "@/server/projects";

export const maxDuration = 60;

/** (Re)run source verification for one deployment and return its status. */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[id]/deployments/[deploymentId]/verify">) {
  try {
    const session = await requireSession();
    const { id, deploymentId } = await ctx.params;
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!/^[0-9a-f-]{36}$/i.test(deploymentId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const [row] = await db.select().from(deployments).where(and(eq(deployments.id, deploymentId), eq(deployments.projectId, id))).limit(1);
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (row.verifyStatus === "verified") return NextResponse.json({ deployment: publicDeployment(row) });
    return NextResponse.json({ deployment: publicDeployment(await verifyDeployment(db, row)) });
  } catch (error) {
    return errorResponse(error);
  }
}
