import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { githubRepos } from "@/server/db/github-schema";
import { getOwnedProject } from "@/server/projects";
import { LinkError, createAndLink, syncProject, toLink } from "@/server/github/sync";

export const maxDuration = 60;

const headers = { "Cache-Control": "no-store, private" };
const STATUS = { not_connected: 409, already_linked: 409, github_failed: 502 } as const;
const patch = z.object({ action: z.enum(["sync", "overwrite"]).optional(), autoSync: z.boolean().optional() }).strict();

async function owned(ctx: RouteContext<"/api/projects/[id]/github">) {
  const session = await requireSession();
  const { id } = await ctx.params;
  const db = await getDb();
  const project = await getOwnedProject(db, id, session.user.id);
  return project ? { db, session, projectId: project.project.id } : null;
}

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404, headers });

/** The project's repository link, or null. */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/github">) {
  try {
    const o = await owned(ctx);
    if (!o) return notFound();
    const [row] = await o.db.select().from(githubRepos).where(eq(githubRepos.projectId, o.projectId)).limit(1);
    return NextResponse.json({ link: row ? toLink(row) : null }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

/** One tap: create a public repository in the person's GitHub and push the app to `main`. */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[id]/github">) {
  try {
    const o = await owned(ctx);
    if (!o) return notFound();
    return NextResponse.json({ link: await createAndLink(o.db, o.session.user.id, o.projectId) }, { headers });
  } catch (error) {
    if (error instanceof LinkError) return NextResponse.json({ error: error.code, message: error.message }, { status: STATUS[error.code], headers });
    return errorResponse(error);
  }
}

/** Sync now, replace what's on GitHub after a pause (`overwrite`), or switch automatic syncing. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[id]/github">) {
  try {
    const o = await owned(ctx);
    if (!o) return notFound();
    const parsed = patch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400, headers });
    if (parsed.data.autoSync !== undefined) await o.db.update(githubRepos).set({ autoSync: parsed.data.autoSync }).where(eq(githubRepos.projectId, o.projectId));
    const link = parsed.data.action ? await syncProject(o.db, o.projectId, { overwrite: parsed.data.action === "overwrite" }) : null;
    const [row] = await o.db.select().from(githubRepos).where(eq(githubRepos.projectId, o.projectId)).limit(1);
    if (!row) return notFound();
    return NextResponse.json({ link: link ?? toLink(row) }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Stop syncing. The repository stays on GitHub, untouched. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/projects/[id]/github">) {
  try {
    const o = await owned(ctx);
    if (!o) return notFound();
    await o.db.delete(githubRepos).where(eq(githubRepos.projectId, o.projectId));
    return NextResponse.json({ link: null }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
