import { NextResponse, connection } from "next/server";

import { z } from "zod";

import { NETWORKS } from "@/config/networks";
import { switchProjectChain } from "@/server/agent/store";
import { getOwnedProject } from "@/server/projects";
import { mainnetAllowedFor } from "@/server/settings/mainnet-access";
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

const patchBody = z.object({ chainId: z.union([z.literal(NETWORKS.celo.chainId), z.literal(NETWORKS["celo-sepolia"].chainId)]) });

/** Move the project to Celo mainnet or Celo Sepolia. Mainnet follows the mainnet switch (D50). Not while a build runs. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = patchBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const db = await getDb();
    const owned = await getOwnedProject(db, id, session.user.id);
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (owned.project.turnStartedAt) return NextResponse.json({ error: "busy" }, { status: 409 });
    const { chainId } = parsed.data;
    if (chainId === NETWORKS.celo.chainId && !(await mainnetAllowedFor(db, session.user.wallet))) return NextResponse.json({ error: "mainnet_closed" }, { status: 403 });
    const label = chainId === NETWORKS.celo.chainId ? NETWORKS.celo.label + " mainnet" : NETWORKS["celo-sepolia"].label + " testnet";
    const version = await switchProjectChain(db, id, chainId, label);
    return NextResponse.json({ chainId, version });
  } catch (error) {
    return errorResponse(error);
  }
}
