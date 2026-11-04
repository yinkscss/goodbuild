import { NextResponse, connection } from "next/server";

import { visionClient } from "@/server/agent";
import { dbAssetStore, reclassifyAsset } from "@/server/agent/asset-store";
import { ASSET_KINDS, type AssetKind } from "@/server/agent/assets";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { getOwnedProject } from "@/server/projects";

/**
 * The asset's bytes, for the owner's workspace only (same origin, session cookie). The preview
 * turns them into data URLs; nothing outside the workspace loads this URL.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/assets/[assetId]">) {
  await connection();
  try {
    const session = await requireSession();
    const { id, assetId } = await ctx.params;
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id)) || !/^[0-9a-f-]{36}$/i.test(assetId)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const asset = await dbAssetStore(db).get(id, assetId);
    if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "Content-Type": asset.mime,
        "Content-Length": String(asset.bytes.length),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        // An SVG opened directly can't run anything or load anything.
        "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        "Content-Disposition": `inline; filename="${asset.name}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Change what an upload is for: { kind: "logo" | "image" | "reference" }. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[id]/assets/[assetId]">) {
  try {
    const session = await requireSession();
    const { id, assetId } = await ctx.params;
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id)) || !/^[0-9a-f-]{36}$/i.test(assetId)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const body = (await request.json().catch(() => null)) as { kind?: string } | null;
    if (!body?.kind || !(ASSET_KINDS as string[]).includes(body.kind)) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const asset = await reclassifyAsset({ store: dbAssetStore(db), db, model: visionClient(), projectId: id, userId: session.user.id, id: assetId, kind: body.kind as AssetKind });
    return asset ? NextResponse.json({ asset }) : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/projects/[id]/assets/[assetId]">) {
  try {
    const session = await requireSession();
    const { id, assetId } = await ctx.params;
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id)) || !/^[0-9a-f-]{36}$/i.test(assetId)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const removed = await dbAssetStore(db).remove(id, assetId);
    return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}
