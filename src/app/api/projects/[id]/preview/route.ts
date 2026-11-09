import { NextResponse, connection } from "next/server";

import { publishedAppsDomain } from "@/lib/published-host";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { effectiveHost } from "@/server/edge";
import { PreviewBuildError, buildPreview } from "@/server/preview/service";
import { getOwnedProject } from "@/server/projects";

export const maxDuration = 60;

/**
 * Build the project's saved files for GoodBuild's own preview (D69) and return where it is served.
 * Owner only. Calling it again for the same files reuses the build.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/preview">) {
  await connection();
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const db = await getDb();
    const owned = await getOwnedProject(db, id, session.user.id);
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const info = await buildPreview(db, owned.project, effectiveHost(request.headers), publishedAppsDomain());
    return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PreviewBuildError) {
      return NextResponse.json({ error: "build_failed", message: error.message, details: error.details }, { status: 422 });
    }
    return errorResponse(error);
  }
}
