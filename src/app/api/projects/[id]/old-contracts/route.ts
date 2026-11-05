import { NextResponse, connection } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { oldContractsWithFunds } from "@/server/deploy/old-contracts";
import { getOwnedProject } from "@/server/projects";

/** Contracts this project has replaced that still hold G$, and how funds might be taken out. */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/old-contracts">) {
  await connection();
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const db = await getDb();
    const owned = await getOwnedProject(db, id, session.user.id);
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ contracts: await oldContractsWithFunds(db, owned.project) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
