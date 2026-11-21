import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { getOwnedProject } from "@/server/projects";

/**
 * Forget one thing GoodBuild remembers about this app (D163). One guarded statement: it removes the decision from
 * the memory as stored now (so two tabs forgetting different things both stick), and only while no build runs (a
 * build may rewrite the memory when it ends).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/memory">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = z.object({ remove: z.string().min(1).max(500) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const db = await getDb();
    const owned = await getOwnedProject(db, id, session.user.id);
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const busy = NextResponse.json({ error: "busy", message: "Wait for the build to finish, then try again." }, { status: 409 });
    if (owned.project.turnStartedAt) return busy;
    if (!owned.project.memory) return NextResponse.json({ remembered: [] });
    const [row] = await db
      .update(projects)
      .set({
        memory: sql`jsonb_set(${projects.memory}, '{decisions}', coalesce((select jsonb_agg(d) from jsonb_array_elements(${projects.memory}->'decisions') as d where d <> to_jsonb(${parsed.data.remove}::text)), '[]'::jsonb))`,
      })
      .where(and(eq(projects.id, id), isNull(projects.turnStartedAt)))
      .returning({ memory: projects.memory });
    if (!row) return busy;
    return NextResponse.json({ remembered: row.memory?.decisions ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}
