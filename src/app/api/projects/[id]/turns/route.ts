import { NextResponse } from "next/server";
import { z } from "zod";

import { PROMPT_MAX_LENGTH } from "@/lib/prompt";
import { modelClient, runTurn, TurnBusyError, type TurnEvent } from "@/server/agent";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { getOwnedProject } from "@/server/projects";

export const maxDuration = 300;

const body = z
  .object({
    mode: z.enum(["build", "plan"]).default("build"),
    prompt: z.string().trim().min(1).max(PROMPT_MAX_LENGTH).optional(),
    userMessageId: z.string().uuid().optional(),
  })
  .refine((b) => b.prompt || b.userMessageId, { message: "prompt or userMessageId is required" });

/**
 * Run one agent turn and stream its events as Server-Sent Events. The turn keeps
 * running (and persists) even if the browser disconnects; the workspace then reloads it.
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
    if (parsed.data.userMessageId && !owned.messages.some((m) => m.id === parsed.data.userMessageId && m.status === "queued")) {
      return NextResponse.json({ error: "message_not_queued" }, { status: 409 });
    }

    const model = modelClient();
    const encoder = new TextEncoder();
    let open = true;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: TurnEvent) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          } catch {
            open = false; // client went away; the turn continues and persists
          }
        };
        try {
          await runTurn({ db, model }, { projectId: id, userId: session.user.id, ...parsed.data }, send);
        } catch (error) {
          if (error instanceof TurnBusyError) send({ type: "busy" });
          else send({ type: "error", message: "The build failed to start." });
        } finally {
          if (open) controller.close();
        }
      },
      cancel() {
        open = false;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
