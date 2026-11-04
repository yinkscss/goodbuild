import { NextResponse } from "next/server";

import { createProjectBody } from "@/lib/api-schemas";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { createProjectFromPrompt, listProjects } from "@/server/projects";

/** Create a project from a prompt (the first message is queued for the agent). */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const parsed = createProjectBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const project = await createProjectFromPrompt(await getDb(), session.user.id, parsed.data);
    return NextResponse.json({ id: project.id, name: project.name }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** The signed-in user's projects, newest first. */
export async function GET() {
  try {
    const session = await requireSession();
    const rows = await listProjects(await getDb(), session.user.id);
    return NextResponse.json({
      projects: rows.map((p) => ({ id: p.id, name: p.name, status: p.status, chainId: p.chainId, updatedAt: p.updatedAt })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
