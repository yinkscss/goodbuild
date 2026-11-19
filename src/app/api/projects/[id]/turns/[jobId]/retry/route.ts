import { z } from "zod";
import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { kickWorker } from "@/server/jobs";
import { readGoodIdentityOnCelo } from "@/server/goodid";
import { startTurn } from "@/server/jobs/jobs";

/** A retry is a server action against the failed job, never an invented user utterance. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/turns/[jobId]/retry">) {
  try {
    const session = await requireSession();
    const parsed = z.object({ useCredits: z.boolean().optional() }).safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const { id, jobId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const started = await startTurn(await getDb(), { projectId: id, userId: session.user.id, mode: "build", retryOfJobId: jobId, useCredits: parsed.data.useCredits }, process.env, { readIdentity: readGoodIdentityOnCelo });
    if ("refused" in started) return NextResponse.json({ error: started.refused.reason, message: started.refused.message }, { status: 402 });
    kickWorker();
    return NextResponse.json({ jobId: started.job.id, messageId: started.job.userMessageId, status: started.job.status }, { status: 202 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (["project_not_found", "retry_not_found"].includes(reason)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (["retry_stale", "retry_busy", "retry_not_failed"].includes(reason)) return NextResponse.json({ error: reason, message: "This build has been superseded or is already running. Reload to continue from the current version." }, { status: 409 });
    return errorResponse(error);
  }
}
