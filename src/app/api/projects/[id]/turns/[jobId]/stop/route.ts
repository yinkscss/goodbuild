import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { kickWorker } from "@/server/jobs";
import { getJob, stopProject } from "@/server/jobs/jobs";
import { getOwnedProject } from "@/server/projects";

/**
 * Stop (user decision 2, P18): the running turn stops at its next safe point and saves nothing;
 * every queued follow-up of the project is cancelled and stays in the chat to resend.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[id]/turns/[jobId]/stop">) {
  try {
    const session = await requireSession();
    const { id, jobId } = await ctx.params;
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id)) || !/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const job = await getJob(db, jobId);
    if (!job || job.projectId !== id) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const result = await stopProject(db, id);
    kickWorker();
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
