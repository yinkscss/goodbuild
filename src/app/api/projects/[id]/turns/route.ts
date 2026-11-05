import { NextResponse } from "next/server";
import { z } from "zod";

import { PROMPT_MAX_LENGTH } from "@/lib/prompt";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { kickWorker } from "@/server/jobs";
import { enqueueTurn } from "@/server/jobs/jobs";
import { getOwnedProject } from "@/server/projects";

const body = z
  .object({
    mode: z.enum(["build", "plan"]).default("build"),
    prompt: z.string().trim().min(1).max(PROMPT_MAX_LENGTH).optional(),
    userMessageId: z.string().uuid().optional(),
  })
  .refine((b) => b.prompt || b.userMessageId, { message: "prompt or userMessageId is required" });

/**
 * Queue an agent turn (P18). The prompt is saved as a queued user message and a job is created;
 * a background worker runs it. The response carries the job id; stream its events from
 * GET /api/projects/[id]/turns/[jobId]/events. Follow-ups queue behind a running turn.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/turns">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

    const db = await getDb();
    const owned = await getOwnedProject(db, id, session.user.id);
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (parsed.data.userMessageId && !owned.messages.some((m) => m.id === parsed.data.userMessageId && m.role === "user")) {
      return NextResponse.json({ error: "message_not_found" }, { status: 404 });
    }
    const job = await enqueueTurn(db, { projectId: id, userId: session.user.id, ...parsed.data });
    kickWorker();
    return NextResponse.json({ jobId: job.id, messageId: job.userMessageId, status: job.status }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
