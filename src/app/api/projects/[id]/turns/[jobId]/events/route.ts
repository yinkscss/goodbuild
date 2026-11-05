import { NextResponse, connection } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { inlineWorker } from "@/server/jobs";
import { getJob, readEvents } from "@/server/jobs/jobs";
import { getOwnedProject } from "@/server/projects";

export const maxDuration = 300;

/** Close the stream after this long; the client reconnects with ?after= (P18). */
const STREAM_MS = 60_000;
const POLL_MS = 400;
/** A job that ended this long ago without an end marker (its worker crashed while ending). */
const ORPHAN_MS = 5_000;

/**
 * A job's events as Server-Sent Events, numbered with `id:` so a client can resume from the
 * last one it saw (?after=seq, or the Last-Event-ID header). Replays from the start for a
 * reload mid-build. Ends with `event: end` once the job is over and everything was sent.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/turns/[jobId]/events">) {
  await connection();
  try {
    const session = await requireSession();
    const { id, jobId } = await ctx.params;
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id)) || !/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const first = await getJob(db, jobId);
    if (!first || first.projectId !== id) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const url = new URL(request.url);
    let after = Number(url.searchParams.get("after") ?? request.headers.get("last-event-id") ?? -1);
    if (!Number.isFinite(after)) after = -1;

    const worker = inlineWorker();
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };
        let wake: (() => void) | null = null;
        const unsubscribe = worker?.onEvents(jobId, () => wake?.()) ?? (() => undefined);
        const deadline = Date.now() + STREAM_MS;
        try {
          send(`retry: 1000\n\n`);
          for (;;) {
            const events = await readEvents(db, jobId, after);
            for (const { seq, event } of events) {
              after = seq;
              if (event.type === "end") {
                send(`id: ${seq}\nevent: end\ndata: {}\n\n`);
                return;
              }
              send(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
            }
            if (closed) return;
            if (!events.length) {
              const job = await getJob(db, jobId);
              const over = !job || !["queued", "running"].includes(job.status);
              if (over && (!job?.finishedAt || Date.now() - job.finishedAt.getTime() > ORPHAN_MS)) {
                send(`event: end\ndata: {}\n\n`);
                return;
              }
              if (job?.status === "queued") send(`: queued\n\n`);
            }
            if (Date.now() > deadline) return; // the client reconnects with ?after=
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, POLL_MS);
              wake = () => {
                clearTimeout(t);
                resolve();
              };
            });
            wake = null;
          }
        } catch {
          // DB went away mid-stream: the client reconnects.
        } finally {
          unsubscribe();
          if (!closed) controller.close();
        }
      },
      cancel() {
        closed = true;
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
