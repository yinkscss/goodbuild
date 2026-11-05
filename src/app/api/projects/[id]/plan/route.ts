import { NextResponse } from "next/server";
import { z } from "zod";

import { PLAN_OTHER_MAX } from "@/lib/plan";
import { errorResponse, requireSession } from "@/server/auth/http";
import { savePlanAnswer } from "@/server/agent/plan-first";
import { getDb } from "@/server/db/client";
import { getOwnedProject } from "@/server/projects";

const body = z.object({
  messageId: z.string().uuid(),
  questionId: z.string().min(1).max(32),
  answer: z.object({
    picks: z.array(z.string().max(32)).max(10),
    other: z.string().trim().max(PLAN_OTHER_MAX).optional(),
  }),
});

/** Save one answer to the plan's questions (D32). No model call and no job. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[id]/plan">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const result = await savePlanAnswer(db, { projectId: id, ...parsed.data });
    if (result !== "saved") return NextResponse.json({ error: result }, { status: result === "invalid" ? 400 : 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
