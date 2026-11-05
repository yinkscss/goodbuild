import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { DeployError, prepareDeploy } from "@/server/deploy/service";
import { getOwnedProject } from "@/server/projects";

export const maxDuration = 60;

const body = z.object({ chainId: z.number().int(), evmVersion: z.enum(["cancun", "paris"]).optional() });

/** Compile the saved project and return the ordered deploy plan (D23). */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/deploy/prepare">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
    try {
      return NextResponse.json({ plan: await prepareDeploy(db, { projectId: id, ...parsed.data }) });
    } catch (error) {
      if (error instanceof DeployError) return NextResponse.json({ error: error.code, message: error.message, details: error.details }, { status: 422 });
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
