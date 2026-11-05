import { NextResponse } from "next/server";
import { z } from "zod";

import { PROMPT_MAX_LENGTH } from "@/lib/prompt";
import { errorResponse, requireSession } from "@/server/auth/http";
import { checkAiAllowance } from "@/server/credits/cap";
import { getDb } from "@/server/db/client";
import { kickWorker } from "@/server/jobs";
import { enqueueTurn } from "@/server/jobs/jobs";
import { shouldPlanFirst } from "@/server/agent/plan-first";
import { getOwnedProject } from "@/server/projects";

const body = z
  .object({
    mode: z.enum(["build", "plan"]).default("build"),
    prompt: z.string().trim().min(1).max(PROMPT_MAX_LENGTH).optional(),
    userMessageId: z.string().uuid().optional(),
    /** "Skip, just build it" while the questions are still being written. */
    skipPlan: z.boolean().optional(),
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
    const allowance = await checkAiAllowance(db, { userId: session.user.id, projectId: id });
    if (!allowance.allowed) return NextResponse.json({ error: allowance.reason, message: allowance.message }, { status: 402 });
    const { skipPlan, mode, prompt, userMessageId } = parsed.data;
    // First send plans first (D32), whichever screen it came from: the server decides, not the client.
    const intake = await shouldPlanFirst(db, { projectId: id, userId: session.user.id, prompt, skipPlan });
    const job = await enqueueTurn(db, { projectId: id, userId: session.user.id, mode: intake ? "plan" : mode, prompt, userMessageId, intake });
    kickWorker();
    return NextResponse.json({ jobId: job.id, messageId: job.userMessageId, status: job.status }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
