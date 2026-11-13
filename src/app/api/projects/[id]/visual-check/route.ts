import { NextResponse } from "next/server";
import { z } from "zod";

import { visionClient } from "@/server/agent";
import { runVisualCheck } from "@/server/agent/visual-check";
import { errorResponse, requireSession } from "@/server/auth/http";
import { checkAiAllowance } from "@/server/credits/cap";
import { getDb } from "@/server/db/client";
import { getOwnedProject } from "@/server/projects";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 4_000_000;
const IMAGE_PREFIX = /^data:image\/(png|jpeg);base64,/;
const body = z.object({
  version: z.number().int().positive(),
  width: z.number().int().min(200).max(4000),
  // A PNG, or a JPEG when the page was too big for one (preview-capture.ts).
  image: z.string().regex(IMAGE_PREFIX),
});

/** Review a screenshot of the preview for a version this user just built (P17 visual check). */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/visual-check">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const allowance = await checkAiAllowance(db, { userId: session.user.id });
    if (!allowance.allowed) return NextResponse.json({ error: allowance.reason, message: allowance.message }, { status: 402 });
    const base64 = parsed.data.image.replace(IMAGE_PREFIX, "");
    // Its own status, so the workspace can say why instead of "couldn't run".
    if (base64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3)) return NextResponse.json({ error: "too_large" }, { status: 413 });
    const image = new Uint8Array(Buffer.from(base64, "base64"));
    const check = await runVisualCheck({ db, model: visionClient(), projectId: id, userId: session.user.id, version: parsed.data.version, width: parsed.data.width, png: image });
    return check ? NextResponse.json({ check }) : NextResponse.json({ error: "no_result" }, { status: 422 });
  } catch (error) {
    return errorResponse(error);
  }
}
