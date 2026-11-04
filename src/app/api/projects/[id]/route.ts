import { NextResponse, connection } from "next/server";

import { workspaceState } from "@/server/workspace-state";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";

/** Full workspace state: project, files, chat, versions and the next-turn estimate. */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  await connection();
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const state = await workspaceState(await getDb(), id, session.user.id);
    if (!state) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
