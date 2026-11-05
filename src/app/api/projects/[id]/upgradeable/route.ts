import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { DeployError } from "@/server/deploy/deploy-error";
import { setUpgradeable } from "@/server/deploy/upgradeable";
import { getOwnedProject } from "@/server/projects";

const body = z.object({ enabled: z.boolean() });

/** Turn the project's upgradeable option on or off (D33). The server refuses it on mainnet. */
export async function PUT(request: Request, ctx: RouteContext<"/api/projects/[id]/upgradeable">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const db = await getDb();
    const owned = await getOwnedProject(db, id, session.user.id);
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
    try {
      await setUpgradeable(db, owned.project, parsed.data.enabled);
      return NextResponse.json({ upgradeable: parsed.data.enabled });
    } catch (error) {
      if (error instanceof DeployError) return NextResponse.json({ error: error.code, message: error.message }, { status: 422 });
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
