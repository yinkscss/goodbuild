import { NextResponse, connection } from "next/server";

import { visionClient } from "@/server/agent";
import { AssetRejected, dbAssetStore, ingestAsset } from "@/server/agent/asset-store";
import { ASSET_KINDS, MAX_ASSET_BYTES, type AssetKind } from "@/server/agent/assets";
import { errorResponse, requireSession } from "@/server/auth/http";
import { checkAiAllowance } from "@/server/credits/cap";
import { getDb } from "@/server/db/client";
import { getOwnedProject } from "@/server/projects";

export const maxDuration = 60;

/** The project's uploaded assets (metadata only). */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/assets">) {
  await connection();
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ assets: await dbAssetStore(db).list(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Upload one image (multipart: file, kind). Type is sniffed from the bytes; SVGs are sanitised. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/assets">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const allowance = await checkAiAllowance(db, { userId: session.user.id });
    if (!allowance.allowed) return NextResponse.json({ error: allowance.reason, message: allowance.message }, { status: 402 });

    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_ASSET_BYTES + 64_000) return NextResponse.json({ error: "too_large", message: `Files can be up to ${MAX_ASSET_BYTES / 1_000_000} MB.` }, { status: 413 });
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) return NextResponse.json({ error: "invalid_body", message: "Attach a file." }, { status: 400 });
    const kindRaw = String(form.get("kind") ?? "image");
    const kind: AssetKind = (ASSET_KINDS as string[]).includes(kindRaw) ? (kindRaw as AssetKind) : "image";
    if (file.size > MAX_ASSET_BYTES) return NextResponse.json({ error: "too_large", message: `Files can be up to ${MAX_ASSET_BYTES / 1_000_000} MB.` }, { status: 413 });

    const asset = await ingestAsset({
      store: dbAssetStore(db),
      db,
      model: visionClient(),
      projectId: id,
      userId: session.user.id,
      fileName: file.name || "image",
      kind,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof AssetRejected) return NextResponse.json({ error: "rejected", message: error.message }, { status: 422 });
    return errorResponse(error);
  }
}
