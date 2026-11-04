import { NextResponse } from "next/server";
import { z } from "zod";

import { revertTo } from "@/server/agent/store";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { getOwnedProject } from "@/server/projects";

/** Restore an earlier version's files as a new version. Deployed contracts are untouched. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/revert">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = z.object({ version: z.number().int().positive() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const db = await getDb();
    const owned = await getOwnedProject(db, id, session.user.id);
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (owned.project.turnStartedAt) return NextResponse.json({ error: "busy" }, { status: 409 });
    const version = await revertTo(db, id, parsed.data.version);
    if (!version) return NextResponse.json({ error: "version_not_found" }, { status: 404 });
    return NextResponse.json({ version });
  } catch (error) {
    return errorResponse(error);
  }
}
