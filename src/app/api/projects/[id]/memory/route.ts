import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withoutDecision, type Memory } from "@/server/agent/memory";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { getOwnedProject } from "@/server/projects";

/** Forget one thing GoodBuild remembers about this app (D163). Refused while a build runs, which may update the memory. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/memory">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = z.object({ remove: z.string().min(1).max(500) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const db = await getDb();
    const owned = await getOwnedProject(db, id, session.user.id);
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (owned.project.turnStartedAt) return NextResponse.json({ error: "busy", message: "Wait for the build to finish, then try again." }, { status: 409 });
    const memory = withoutDecision((owned.project.memory as Memory | null) ?? null, parsed.data.remove);
    if (memory) await db.update(projects).set({ memory }).where(eq(projects.id, id));
    return NextResponse.json({ remembered: memory?.decisions ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}
